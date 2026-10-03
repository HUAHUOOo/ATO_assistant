"""Exercise the real dictionary API against disposable cards and a test session."""
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import unittest
import urllib.error
import urllib.request
import uuid


class TechCardTypesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        php = shutil.which('php')
        if not php:
            raise unittest.SkipTest('PHP is not installed')
        source = Path(__file__).resolve().parents[1]
        cls.temp_parent = source / 'tmp'
        cls.root = cls.temp_parent / ('tech-types-test-' + uuid.uuid4().hex)
        (cls.root / 'api').mkdir(parents=True)
        (cls.root / 'technology').mkdir()
        (cls.root / 'data' / 'sessions').mkdir(parents=True)
        shutil.copyfile(source / 'api' / 'tech-card-dictionary.php', cls.root / 'api' / 'tech-card-dictionary.php')
        cls.dictionary = cls.root / 'technology' / 'tech_card_dictionary.min.json'
        (cls.root / 'login.php').write_text(
            "<?php session_save_path(__DIR__.'/data/sessions'); session_start(); "
            "$_SESSION['ato_user_id']='fixture'; echo '{}';", encoding='utf-8')
        cls.addClassCleanup(cls.cleanup_files)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'
        cls.log = (cls.root / 'server.log').open('w')
        cls.addClassCleanup(cls.log.close)
        cls.process = subprocess.Popen(
            [php, '-S', f'127.0.0.1:{port}', '-t', str(cls.root)], stdout=cls.log, stderr=cls.log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        cls.addClassCleanup(cls.stop_server)
        cls.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        for _ in range(50):
            try:
                with cls.client.open(cls.base + '/login.php', timeout=2) as response:
                    json.load(response)
                break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError('Isolated PHP server did not start')

    @classmethod
    def cleanup_files(cls):
        resolved = cls.root.resolve()
        if resolved.parent != cls.temp_parent.resolve() or not resolved.name.startswith('tech-types-test-'):
            raise RuntimeError('Unexpected fixture cleanup target')
        shutil.rmtree(resolved)

    @classmethod
    def stop_server(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)

    def setUp(self):
        self.dictionary.write_text(json.dumps({'cards': [
            {'key': 'hybrid', 'category': 'structure', 'core': True,
             'type': {'structure_card_types': ['save', 'active'], 'loop_limited': False},
             'nodes': [{'category': 'structure', 'core': True}]},
            {'key': 'legacy', 'category': 'structure', 'type': {'negotiation': True, 'loop_limited': True}},
            {'key': 'battle', 'category': 'battle', 'type': {'battle_card_type': 'skill'}},
        ]}), encoding='utf-8')

    def request(self, payload=None, authenticated=True):
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(self.base + '/api/tech-card-dictionary.php', data=data,
                                         headers={'Content-Type': 'application/json'})
        client = self.client if authenticated else urllib.request.build_opener()
        try:
            response = client.open(request, timeout=4)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def cards(self):
        status, payload = self.request()
        self.assertEqual(status, 200)
        return {card['key']: card for card in payload['data']['cards']}

    def test_types_round_trip_and_partial_update_preserves_core_and_scope(self):
        status, _ = self.request({'cardUpdates': [
            {'key': 'hybrid', 'structureCardTypes': ['reference', 'negotiation', 'save', 'permanent', 'save', 'invalid']},
        ]})
        self.assertEqual(status, 200)
        card = self.cards()['hybrid']
        self.assertEqual(card['type']['structure_card_types'], ['save', 'negotiation', 'reference', 'permanent'])
        self.assertTrue(card['type']['negotiation'])
        self.assertFalse(card['type']['loop_limited'])
        self.assertTrue(card['core'])
        self.assertTrue(card['nodes'][0]['core'])

    def test_legacy_negotiation_editor_preserves_other_types_and_can_clear_negotiation(self):
        self.assertEqual(self.request({'negotiationKeys': ['hybrid', 'legacy']})[0], 200)
        self.assertEqual(self.cards()['hybrid']['type']['structure_card_types'], ['save', 'negotiation', 'active'])
        self.assertEqual(self.request({'negotiationKeys': []})[0], 200)
        card = self.cards()['hybrid']
        self.assertEqual(card['type']['structure_card_types'], ['save', 'active'])
        self.assertNotIn('negotiation', card['type'])

    def test_old_property_updates_preserve_types_and_untouched_negotiation(self):
        self.assertEqual(self.request({'cardUpdates': [{'key': 'hybrid', 'category': 'structure', 'core': False}]})[0], 200)
        cards = self.cards()
        self.assertEqual(cards['hybrid']['type']['structure_card_types'], ['save', 'active'])
        self.assertNotIn('core', cards['hybrid'])
        self.assertTrue(cards['legacy']['type']['negotiation'])

    def test_battle_conversion_clears_structure_types_and_empty_selection_is_saved(self):
        self.assertEqual(self.request({'cardUpdates': [
            {'key': 'hybrid', 'category': 'battle', 'core': False, 'structureCardTypes': ['save', 'negotiation']},
            {'key': 'legacy', 'structureCardTypes': []},
        ]})[0], 200)
        cards = self.cards()
        self.assertEqual(cards['hybrid']['nodes'][0]['category'], 'battle')
        self.assertNotIn('structure_card_types', cards['hybrid']['type'])
        self.assertNotIn('negotiation', cards['hybrid']['type'])
        self.assertEqual(cards['legacy']['type']['structure_card_types'], [])
        self.assertNotIn('negotiation', cards['legacy']['type'])
        self.assertEqual(cards['battle']['type']['battle_card_type'], 'skill')

    def test_invalid_types_and_unauthenticated_writes_do_not_change_dictionary(self):
        before = self.dictionary.read_bytes()
        self.assertEqual(self.request({'cardUpdates': [{'key': 'hybrid', 'structureCardTypes': 'save'}]})[0], 400)
        self.assertEqual(self.request({'negotiationKeys': 'legacy'})[0], 400)
        self.assertEqual(self.request({'cardUpdates': []}, authenticated=False)[0], 401)
        self.assertEqual(self.dictionary.read_bytes(), before)

    def test_large_battle_cards_cannot_receive_structural_types(self):
        data = json.loads(self.dictionary.read_text(encoding='utf-8'))
        data['cards'][2]['image'] = {'crop': [0, 0, 820, 1410]}
        self.dictionary.write_text(json.dumps(data), encoding='utf-8')
        self.assertEqual(self.request({'cardUpdates': [
            {'key': 'battle', 'structureCardTypes': ['one_time', 'active', 'permanent']},
        ]})[0], 200)
        battle = self.cards()['battle']
        self.assertEqual(battle['category'], 'battle')
        self.assertEqual(battle['type'], {'battle_card_type': 'skill'})


if __name__ == '__main__':
    unittest.main()
