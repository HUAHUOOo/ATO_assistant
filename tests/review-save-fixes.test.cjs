const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const noop = () => {};
const response = (status, payload) => ({ ok: status === 200, status, json: async () => clone(payload) });
function extract(file, name) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const match = source.match(new RegExp('^( *)(?:async )?function ' + name + '\\([^]*?^\\1}', 'm'));
  assert.ok(match, name);
  return match[0];
}
function context(file, names, values = {}) {
  const scope = vm.createContext({ console: { warn: noop, error: noop }, ...values });
  vm.runInContext(names.map(name => extract(file, name)).join('\n'), scope);
  return scope;
}
const lootFile = 'aibp/bp_loot_calculator_addon.js';
test('dashboard placeholder is not editable before the first server snapshot', () => {
  const c = context('index.html', ['setCampaignSaveStatus'], {
    elements: { appShell: {}, campaignSaveStatus: { dataset: {} } }, sessionUser: { id: 'owner' },
    campaignSectionBaseline: null, ownsDashboardWriteLease: () => true,
  });
  c.setCampaignSaveStatus('connecting', 'saving');
  assert.equal(c.elements.appShell.inert, true);
  c.campaignSectionBaseline = {};
  c.setCampaignSaveStatus('saved');
  assert.equal(c.elements.appShell.inert, false);
});
const heroMerge = () => context('hero/index.html', ['mergeHeroStates']);
const heroes = ids => ({ heroes: [...ids].map(id => ({ id, notes: '' })), graveyard: [] });
test('hero remote reorder survives an unrelated local field edit', () => {
  const base = heroes('ABC'), local = clone(base), remote = heroes('CAB');
  local.heroes[0].notes = 'local note';
  const result = heroMerge().mergeHeroStates(base, local, remote);
  assert.equal(result.state.heroes.map(h => h.id).join(''), 'CAB');
  assert.equal(result.state.heroes.find(h => h.id === 'A').notes, 'local note');
  assert.equal(result.conflicts.length, 0);
});
test('hero local reorder survives remote edits and independent deletion', () => {
  const remote = heroes('AB'); remote.heroes[0].notes = 'remote';
  const result = heroMerge().mergeHeroStates(heroes('ABC'), heroes('BAC'), remote);
  assert.equal(result.state.heroes.map(h => h.id).join(''), 'BA');
  assert.equal(result.state.heroes[1].notes, 'remote');
  assert.equal(result.conflicts.length, 0);
});
test('hero incompatible reorders require a conflict decision', () => {
  const result = heroMerge().mergeHeroStates(heroes('ABC'), heroes('BAC'), heroes('ACB'));
  assert.deepEqual(clone(result.conflicts), ['heroes.order']);
  assert.equal(result.state.heroes.map(h => h.id).join(''), 'BAC');
});
test('hero reorder keeps independent additions and deletions', () => {
  const result = heroMerge().mergeHeroStates(heroes('ABC'), heroes('ABD'), heroes('BACE'));
  assert.equal(result.state.heroes.map(h => h.id).join(''), 'BDAE');
  assert.equal(result.conflicts.length, 0);
});
test('technology refuses offline profile switches without losing the pending profile', async () => {
  let mutations = 0, renders = 0, warning = '';
  const c = context('technology/index.html', ['switchAccount', 'saveAccounts', 'technologySectionState'], {
    accounts: { A: {}, B: {} }, activeAccountId: 'A', currentCycle: 'c1',
    unlocked: new Set(['new-tech']), unimportant: new Set(), conditionTicked: new Set(['new-condition']),
    campaignTechBaseState: { unlocked: [] }, treeLanguage: 'zh', hideUnknownTech: true, hideTreeImage: false,
    queueCampaignTechnologySave: noop, flushCampaignTechnologySave: async () => false,
    renderAccountSelect: () => renders++, alert: message => { warning = message; },
    mutateCampaignDashboardArchive: async () => mutations++,
  });
  await c.switchAccount('B');
  assert.equal(c.activeAccountId, 'A');
  assert.deepEqual(clone(c.accounts.A.unlocked), ['new-tech']);
  assert.deepEqual(clone(c.technologySectionState().conditions), ['new-condition']);
  assert.deepEqual(clone(c.campaignTechBaseState.unlocked), []);
  assert.equal(mutations, 0);
  assert.equal(renders, 1, 'reset dropdown to the actual active profile');
  assert.match(warning, /尚未同步/);
});
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function recordContext(extra = {}) {
  return context('record/index.html', ['loadServerState', 'recordStateFromCampaign', 'mergeRecordChanges', 'mergeLogText', 'syncRecordFromExternalUpdate'], {
    campaignSession: { changed: false, accept: x => x }, serverStorageUrl: '/api',
    serverStorageAvailable: false, serverLoadInFlight: false, serverSaveQueuedBeforeReady: false,
    serverExternalSyncInFlight: false, serverConflictMerging: false, serverSaveInFlight: false,
    serverStateBaseline: { resources: { bone: 0, meat: 0 } }, state: { resources: { bone: 0, meat: 0 } },
    defaultState: { resources: { bone: 0, meat: 0 } }, recordProfileLoaded: false, campaignUserId: 'default',
    cloneJson: clone, jsonEqual: equal, isPlainObject, normalizeState: clone, atomicMergePaths: new Set(),
    applyRequestedCycleFromUrl: noop, consumeDashboardSurveyNote: () => false, renderAll: noop,
    setSaveStatus: noop, clearDashboardSurveyNoteFromUrl: noop, queueServerSave: noop,
    requestedDashboardSurveyNote: null, window: { confirm: () => true }, ...extra,
  });
}
test('record first read preserves edits even before debounce fires', async () => {
  let resolveRead, queued = 0;
  const c = recordContext({ fetch: () => new Promise(r => { resolveRead = r; }), queueServerSave: () => queued++ });
  const loading = c.loadServerState();
  c.state.resources.bone = 5;
  resolveRead(response(200, { ok: true, campaign: { sections: {
    dashboard: { activeProfileId: 'A' }, record: { users: { A: { resources: { bone: 0, meat: 7 } } } },
  }, sectionRevisions: { record: 3 } } }));
  await loading;
  assert.deepEqual(clone(c.state.resources), { bone: 5, meat: 7 });
  assert.deepEqual(clone(c.serverStateBaseline.resources), { bone: 0, meat: 7 });
  assert.equal(queued, 1);
  assert.equal(c.campaignUserId, 'A');
});
test('record retries its failed first connection and merges offline edits', async () => {
  let available = false, reads = 0, queued = 0;
  const c = recordContext({ queueServerSave: () => queued++, fetch: async () => {
    reads++;
    return available ? response(200, { ok: true, campaign: { sections: {
      record: { resources: { bone: 0, meat: 9 } },
    }, sectionRevisions: { record: 2 } } }) : response(503, {});
  } });
  await c.loadServerState();
  c.state.resources.bone = 3;
  c.serverSaveQueuedBeforeReady = true;
  available = true;
  await c.syncRecordFromExternalUpdate();
  assert.equal(reads, 2);
  assert.equal(c.serverStorageAvailable, true);
  assert.deepEqual(clone(c.state.resources), { bone: 3, meat: 9 });
  assert.equal(queued, 1);
});
test('record reconnect polling does not overlap its pending initial read', async () => {
  let resolveRead, reads = 0;
  const c = recordContext({ fetch: () => { reads++; return new Promise(r => { resolveRead = r; }); } });
  const pending = c.loadServerState();
  await c.syncRecordFromExternalUpdate();
  await c.syncRecordFromExternalUpdate();
  assert.equal(reads, 1);
  resolveRead(response(503, {}));
  await pending;
  assert.equal(c.serverLoadInFlight, false);
});
for (const keepLocal of [true, false]) test(`dashboard first read resolves overlapping edits explicitly (${keepLocal})`, async () => {
  let resolveRead, asked = 0;
  const c = context('index.html', ['loadCampaignSection', 'mergeDashboardChanges'], {
    campaignSessionEpoch: 1, campaignStorageUrl: '/api', sessionUser: { id: 'owner' },
    campaignSectionBaseline: null, campaignSaveQueuedBeforeReady: false,
    archive: { day: 1, note: '' }, defaultArchive: { day: 1, note: '' },
    normalizeArchive: clone, cloneJson: clone, jsonEqual: equal, isPlainObject,
    clearCampaignReconnect: noop, ownsDashboardWriteLease: () => true, queueCampaignSave: noop,
    setCampaignSaveStatus: noop, loadNegotiationCards: async () => {}, renderFlow: noop,
    refreshCachedArgoRecord: noop, renderDashboardArchive: a => { c.archive = a; },
    window: { confirm: () => { asked++; return keepLocal; } },
    fetch: () => new Promise(r => { resolveRead = r; }),
  });
  const loading = c.loadCampaignSection();
  c.archive.day = 2;
  resolveRead(response(200, { ok: true, exists: true, revision: 4, user: { id: 'owner' }, state: { day: 3, note: 'remote' } }));
  await loading;
  assert.equal(asked, 1);
  assert.equal(c.archive.day, keepLocal ? 2 : 3);
  assert.equal(c.archive.note, 'remote');
  assert.equal(c.campaignSectionBaseline.day, 3);
});
function lootContext(extra = {}) {
  return context(lootFile, ['readServerRecordState', 'writeServerRecordState', 'addLootResultToRecord',
    'readLocalRecordState', 'mergeRecordStates', 'normalizeRecordCrewCounters', 'isPlainObject'], {
    CAMPAIGN_STATE_URL: '/api', RECORD_SECTION_URL: '/api?section=record', RECORD_STORAGE_KEY: 'record',
    RECORD_SYNC_CHANNEL: null, localStorage: { getItem: () => null, setItem: noop },
    applyLootResultToRecord: (record, result, cycle) => ({
      record: { ...record, resources: { bone: (record.resources?.bone || 0) + result.amount } },
      added: ['bone'], skipped: [], cycle,
    }), ...extra,
  });
}
test('loot conflict retry retains original profile, account and cycle', async () => {
  let reads = 0;
  const posts = [];
  const c = lootContext({ fetch: async (url, options) => {
    if (!options?.method) {
      const later = ++reads > 1;
      return response(200, { ok: true, user: { id: 'owner' }, campaign: {
        sectionRevisions: { record: later ? 2 : 1 }, sections: {
          dashboard: { activeProfileId: later ? 'B' : 'A', profiles: { A: { activeCycleId: later ? 'c2' : 'c1' }, B: {} } },
          record: { users: { A: { resources: { bone: later ? 20 : 10 } }, B: { resources: { bone: 99 } } } },
        },
      } });
    }
    posts.push(JSON.parse(options.body));
    return posts.length === 1 ? response(409, { code: 'SAVE_CONFLICT' }) : response(200, { ok: true, revision: 3 });
  } });
  const result = await c.addLootResultToRecord({ amount: 2 });
  assert.equal(result.syncedToServer, true);
  assert.equal(result.cycle, 'c1');
  assert.equal(posts[1].userId, 'A');
  assert.equal(posts[1].expectedAccountId, 'owner');
  assert.equal(posts[1].state.resources.bone, 22);
});
test('loot pinned reads refuse a changed login or removed profile', async () => {
  for (const payload of [
    { user: { id: 'other' }, campaign: {} },
    { user: { id: 'owner' }, campaign: { sections: { dashboard: { profiles: { B: {} } } } } },
  ]) {
    const c = lootContext({ fetch: async () => response(200, { ok: true, ...payload }) });
    await assert.rejects(c.readServerRecordState({ userId: 'A', accountId: 'owner' }));
  }
});
test('offline loot never reports a local-only result as recorded', async () => {
  let cached = false, applied = false;
  const c = lootContext({
    fetch: async () => { throw new Error('offline'); },
    localStorage: { getItem: () => null, setItem: () => { cached = true; } },
    applyLootResultToRecord: () => { applied = true; },
  });
  await assert.rejects(c.addLootResultToRecord({ amount: 2 }), /offline/);
  assert.equal(cached, false);
  assert.equal(applied, false);
});
test('loot retry after a lost success response does not double-add resources', async () => {
  let record = { resources: { bone: 10 } }, posts = 0;
  const c = lootContext({ fetch: async (url, options) => {
    if (!options?.method) return response(200, { ok: true, user: { id: 'owner' }, campaign: {
      sectionRevisions: { record: 1 + posts }, sections: {
        dashboard: { activeProfileId: 'A', profiles: { A: { activeCycleId: 'c1' } } },
        record: { users: { A: record } },
      },
    } });
    posts++;
    record = JSON.parse(options.body).state;
    throw new Error('response lost after commit');
  } });
  const result = { amount: 2 };
  await assert.rejects(c.addLootResultToRecord(result), /response lost/);
  assert.equal(record.resources.bone, 12);
  const retry = await c.addLootResultToRecord(result);
  assert.equal(retry.syncedToServer, true);
  assert.equal(posts, 1);
  assert.equal(record.resources.bone, 12);
});
for (const [file, fn] of [[lootFile, 'mergeRecordStates'], ['index.html', 'mergeArgoRecords']]) {
  test(`${fn}: server deletions survive stale browser caches`, () => {
    const c = context(file, [fn, 'isPlainObject', 'normalizeRecordCrewCounters']);
    const server = { titans: [], nymphCards: [], godforms: [], nymphUsedCards: [], godformUsedCards: [], resources: {} };
    const local = { titans: [{ id: 'old' }], nymphCards: ['old'], resources: { bone: 9 }, adventures: { old: true } };
    const merged = c[fn](server, local);
    assert.deepEqual(clone(merged.titans), []);
    assert.deepEqual(clone(merged.nymphCards), []);
    assert.deepEqual(clone(merged.resources), {});
    assert.equal(merged.adventures, undefined);
    assert.equal(server.cycleStats, undefined, 'normalization must not mutate the input');
  });
}
