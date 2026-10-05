'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, escape } = require('./helpers/mixed-media-dom.cjs');
const { rendererSource, rendererWithSyntheticRegistries, appHelper } = require('./helpers/mixed-media-source.cjs');
const { context, row, resourceRow, mapping, fingerprint, tick, ready, cleanup } = require('./helpers/mixed-media-fixtures.cjs');

const nativePath = 'story/images/battles/c1/synthetic-board.png';
const nativeRegistry = [{ path: nativePath, width: 64, height: 48, crop: null, aliases: [] }];
const source = 'Bring [spark] to [board].';
function nativeSetup() {
  const h = harness(), { create } = rendererWithSyntheticRegistries({ native: nativeRegistry }), updates = [];
  const map = mapping([], {
    resourceSchema: 1, resourceRows: [resourceRow(source)], requestedSchema: 1,
    requestedRows: [row(source, { kind: 'battle-map', path: nativePath, anchor: '[board]', semanticLabel: 'Invented board', layout: 'block' })],
  });
  const api = create(map, h.env), result = api.renderInto(h.container, context, source, { onChange: update => updates.push(update) });
  return { ...h, api, result, updates };
}
function beginNative(image, width = 64, height = 48) {
  image.naturalWidth = width; image.naturalHeight = height; image.complete = true; image.dispatch('load');
}
const readyPaths = h => Array.from(h.updates.at(-1)?.readyNativePaths || []);

test('native gallery readiness excludes pending/decoded tokens and returns only committed exact paths', async () => {
  const h = nativeSetup(), [resource, native] = h.document.imageRequests;
  assert.equal(h.result.count, 2); assert.deepEqual(readyPaths(h), []);
  await ready(h, resource); assert.deepEqual(readyPaths(h), []);
  beginNative(native); native.decodeResolve(); await tick();
  assert.deepEqual(readyPaths(h), [], 'decode alone does not hide the gallery');
  h.frames(); assert.deepEqual(readyPaths(h), [nativePath]);
  assert.deepEqual(Array.from(h.api.nativeBattlePaths(context, source)), [nativePath]);
  native.dispatch('error'); assert.deepEqual(readyPaths(h), []);
  assert.equal(h.container.querySelectorAll('.ato-mm-battle-map').length, 0);
  assert.equal(h.updates.at(-1).readyCount, 1, 'unrelated ready resource stays available');
  cleanup(h);
});

test('native intrinsic-size mismatch and a disposed decoder never publish ready paths', async () => {
  for (const dimensions of [[63, 48], [64, 49], [0, 0]]) {
    const h = nativeSetup(), [resource, native] = h.document.imageRequests;
    await ready(h, resource); beginNative(native, ...dimensions); await tick(); h.frames();
    assert.deepEqual(readyPaths(h), []); assert.equal(h.container.querySelectorAll('.ato-mm-battle-map').length, 0); cleanup(h);
  }
  const h = nativeSetup(), native = h.document.imageRequests[1]; beginNative(native);
  h.api.dispose(h.container); const before = h.updates.length;
  native.decodeResolve(); await tick(); h.frames();
  assert.equal(h.updates.length, before); assert.equal(h.container.textContent, source); cleanup(h);
});

test('gallery helper hides only ready same-origin counterparts and restores only its own state', () => {
  for (const base of ['https://example.invalid/nested/app/', 'file:///android_asset/web/']) {
    const h = harness(); h.env.location.href = `${base}story/index.html`;
    const gallery = h.document.createElement('div'); gallery.className = 'battle-gallery'; h.container.append(gallery);
    const add = (path, hidden = false, parent = gallery) => {
      const image = h.document.createElement('img'); image.setAttribute('src', path); image.hidden = hidden; parent.append(image); return image;
    };
    const exact = add(base + nativePath), encoded = add(base + nativePath.replace('synthetic', '%73ynthetic'));
    const unrelated = add(base + nativePath.replace('synthetic-board', 'other-board'));
    const remote = add('https://remote.invalid/' + nativePath), preHidden = add(base + nativePath, true);
    const outsideGallery = add(base + nativePath, false, h.container), malformed = add('http://[invalid');
    const refresh = appHelper('story/assets/app.js', 'refreshMixedMediaBattleGallery', { storyText: h.container, window: h.env });
    refresh([]); assert.equal(exact.hidden, false);
    refresh([nativePath]); assert.equal(exact.hidden, true); assert.equal(encoded.hidden, true);
    for (const image of [unrelated, remote, outsideGallery, malformed]) assert.equal(image.hidden, false);
    assert.equal(preHidden.hidden, true); assert.equal(preHidden.hasAttribute('data-ato-mm-native-duplicate'), false);
    refresh(null); assert.equal(exact.hidden, false); assert.equal(encoded.hidden, false); assert.equal(preHidden.hidden, true);
    assert.equal(exact.hasAttribute('data-ato-mm-native-duplicate'), false);
  }
});

test('application context activates only audited book/variant narrative combinations', () => {
  const entry = { key: 'synthetic-room', chapterKey: 'battle' };
  for (const bookId of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) {
    for (const official of [false, true]) {
      const mixedMediaContext = appHelper('story/assets/app.js', 'mixedMediaContext', {
        currentBook: () => ({ id: bookId }), storyVersion: official ? '官方版' : 'fan', supportsOfficialVersion: () => official,
      });
      const expected = /^c[1-3]$/.test(bookId) ? official : /^c[45]$/.test(bookId) && !official;
      const value = mixedMediaContext(entry);
      assert.equal(Boolean(value), expected);
      if (expected) {
        assert.deepEqual(JSON.parse(JSON.stringify(value)), { schema: 1, bookId, entryKey: entry.key, variant: official ? 'official' : 'fan' });
        for (const chapterKey of ['story-card', 'doom-card', 'rule', 'rules']) assert.equal(mixedMediaContext({ ...entry, chapterKey }), null);
      }
    }
  }
});

const headingText = 'Battle: Paper Kite\nSetup:\nPlace two counters.';
const headingContext = { schema: 1, bookId: 'c5', variant: 'fan', entryKey: 'synthetic-paper-kite' };
const headingRecord = {
  entryKey: headingContext.entryKey, sourceKind: 'translation', textLength: headingText.length, textFingerprint: fingerprint(headingText),
  ranges: [
    { start: 0, end: headingText.indexOf('\n'), kind: 'battle-title', titleFingerprint: fingerprint('Battle: Paper Kite') },
    { start: headingText.indexOf('Setup:'), end: headingText.indexOf('Setup:') + 6, kind: 'section', titleFingerprint: fingerprint('Setup:') },
  ],
};

test('published heading metadata contains fingerprints and ranges rather than title text', () => {
  const declaration = rendererSource.match(/const records = (\[[^\n]*\]);/);
  assert.ok(declaration);
  const records = JSON.parse(declaration[1]); assert.ok(records.length > 0);
  for (const record of records) for (const range of record.ranges) {
    assert.equal(Object.hasOwn(range, 'title'), false);
    assert.match(range.titleFingerprint, /^[a-f0-9]{8}$/);
  }
});

test('invented exact-fingerprint headings enhance display without changing source or existing title nodes', () => {
  const h = harness(), { createC5BattleHeadings } = rendererWithSyntheticRegistries({ headings: [headingRecord] });
  const headings = createC5BattleHeadings(h.env);
  h.container.textContent = headingText;
  assert.equal(headings.enhanceHTML(h.container, headingContext, headingText), 2);
  assert.equal(h.container.textContent, headingText); assert.equal(h.container.querySelectorAll('.ato-c5-battle-heading').length, 2);
  const title = h.container.querySelector('strong'); headings.enhanceHTML(h.container, headingContext, headingText);
  assert.equal(h.container.querySelector('strong'), title); assert.equal(h.container.querySelectorAll('strong').length, 2);
  const html = '<h2>Battle: Paper Kite</h2>\n<strong>Setup:</strong>\nPlace two counters.';
  h.container.innerHTML = html; const original = [...h.container.children];
  headings.enhanceHTML(h.container, headingContext, headingText);
  assert.equal(h.container.innerHTML, html); assert.deepEqual(h.container.children, original);
  assert.ok(headings.formatHTML(headingContext, headingText, escape(headingText)).includes('ato-c5-battle-heading'));
});

test('heading source/hash/range mismatches and forbidden DOM regions fail without partial mutation', () => {
  for (const change of [
    { textLength: headingText.length + 1 }, { textFingerprint: '00000000' },
    { ranges: [{ ...headingRecord.ranges[0], titleFingerprint: '00000000' }] },
    { ranges: [headingRecord.ranges[0], { ...headingRecord.ranges[0] }] },
  ]) {
    const h = harness(), { createC5BattleHeadings } = rendererWithSyntheticRegistries({ headings: [{ ...headingRecord, ...change }] });
    const headings = createC5BattleHeadings(h.env); h.container.textContent = headingText;
    assert.equal(headings.enhanceHTML(h.container, headingContext, headingText), 0); assert.equal(h.container.textContent, headingText);
  }
  const h = harness(), { createC5BattleHeadings } = rendererWithSyntheticRegistries({ headings: [headingRecord] });
  const headings = createC5BattleHeadings(h.env);
  h.container.innerHTML = '<span>Battle: Paper Kite</span>\n<textarea>Setup:</textarea>\nPlace two counters.';
  const before = h.container.innerHTML;
  assert.equal(headings.enhanceHTML(h.container, headingContext, headingText), 0); assert.equal(h.container.innerHTML, before);
  assert.equal(headings.plan(headingContext, headingText.replace('Battle', 'Rattle')).length, 0);
});
