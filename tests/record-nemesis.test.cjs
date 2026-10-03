const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const source = read('record/index.html');
const aibpSource = read('aibp/index.html');
const lootSource = read('aibp/bp_loot_calculator_addon.js');
const clone = value => JSON.parse(JSON.stringify(value));
function fn(text, name) {
  const match = text.match(new RegExp('^( *)function ' + name + '\\([^]*?^\\1}', 'm'));
  assert.ok(match, name);
  return match[0];
}
function element() {
  return {
    children: [], style: {}, attributes: {}, listeners: {},
    set innerHTML(value) { this.children = []; },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
  };
}
function harness(saved = {}) {
  const ctx = vm.createContext({
    state: null, document: { createElement: element }, elements: { enemyTracks: element() },
    makeTrackTitle: (zh, en) => ({ zh, en }), queueSave() {}, renderResources() {},
    atomicMergePaths: new Set(['crewBoxes', 'maxUnlocked']),
  });
  vm.runInContext(source.slice(source.indexOf('    const cycleData = '), source.indexOf('    const elements = ')), ctx);
  const functions = [
    'isPlainObject', 'cloneJson', 'jsonEqual', 'normalizeState', 'migrateEnemyStages',
    'normalizeNemesisSelections', 'migrateNemesisProgress', 'normalizeNemesisResourceHistory',
    'normalizeResources', 'migrateSharedResourceKey', 'normalizeCycleStats', 'normalizeCrewCounters',
    'normalizeCount', 'normalizeTitanList', 'normalizeTitanLimit', 'migrateTitanLimit',
    'normalizeSummonSelection', 'normalizeMatrix', 'normalizeMatrixKey', 'normalizeCycleDay', 'defaultDayForCycle',
    'currentCycle', 'currentNemesis', 'selectNemesis', 'currentResources', 'resourceStorageKey',
    'getEvolutionStage', 'evolutionStages', 'getEvolutionStageKey', 'isEvolutionStageActive',
    'toggleEvolutionStage', 'clearEvolutionTrack', 'hasEvolutionProgress', 'renderObjectTrack',
    'makeNemesisTrackTitle', 'renderEnemyTracks', 'mergeRecordChanges', 'mergeLogText',
  ];
  vm.runInContext(functions.map(name => fn(source, name)).join('\n'), ctx);
  ctx.state = ctx.normalizeState(clone(saved));
  ctx.renderAll = () => ctx.renderEnemyTracks();
  return ctx;
}
const row = ctx => ctx.elements.enemyTracks.children.at(-1);
const chips = ctx => row(ctx).children[1].children;
const select = ctx => row(ctx).children[0].children[0].children[1];
const keys = ctx => Array.from(ctx.currentResources(), resource => resource.key);
const choose = (ctx, key) => {
  select(ctx).value = key;
  select(ctx).listeners.change();
};

test('each cycle exposes only its allowed nemeses and uses the requested default', () => {
  const expected = {
    c1: ['pursuer'], c2: ['adversary', 'pursuer', 'dahaka'], c3: ['adversary', 'dahaka'],
    c4: ['dahaka'], c5: ['titanX'],
  };
  for (const [cycle, options] of Object.entries(expected)) {
    const ctx = harness({ cycle });
    ctx.renderEnemyTracks();
    assert.equal(ctx.elements.enemyTracks.children.length, 4);
    assert.deepEqual(select(ctx).children.map(item => item.value), options);
    assert.equal(select(ctx).value, options[0]);
    assert.equal(select(ctx).disabled, options.length === 1);
    assert.equal(ctx.selectNemesis('invalid'), false);
    assert.equal(ctx.currentNemesis().key, options[0]);
  }
  const ctx = harness({ cycle: 'c1', nemesisSelections: { c1: 'dahaka', c3: 'pursuer' } });
  assert.equal(ctx.currentNemesis().zh, '赫尔墨斯追击者');
  assert.equal(ctx.state.nemesisSelections.c3, 'adversary');
});

test('switching changes the whole track and restores marks for each nemesis across cycles', () => {
  const ctx = harness({ cycle: 'c2' });
  ctx.renderEnemyTracks();
  chips(ctx)[1].listeners.click(); // Burden I
  chips(ctx)[0].listeners.click(); // Triangle
  choose(ctx, 'dahaka');
  assert.equal(chips(ctx).length, 9);
  assert.ok(chips(ctx).every(item => !item.className.includes('active')));
  chips(ctx)[8].listeners.click(); // Dahaka VIII
  choose(ctx, 'pursuer');
  assert.equal(chips(ctx).length, 6);
  chips(ctx)[5].listeners.click(); // Pursuer V
  choose(ctx, 'adversary');
  assert.ok(chips(ctx)[0].className.includes('active'));
  assert.ok(chips(ctx)[1].className.includes('active'));
  assert.ok(!chips(ctx)[5].className.includes('active'));

  ctx.state.cycle = 'c3';
  ctx.renderEnemyTracks();
  assert.equal(select(ctx).value, 'adversary');
  assert.ok(chips(ctx)[1].className.includes('active'));
  choose(ctx, 'dahaka');
  assert.ok(chips(ctx)[8].className.includes('active'));
  ctx.state.cycle = 'c4';
  ctx.renderEnemyTracks();
  assert.ok(chips(ctx)[8].className.includes('active'));
  ctx.state.cycle = 'c1';
  ctx.renderEnemyTracks();
  assert.ok(chips(ctx)[5].className.includes('active'));
  ctx.state.cycle = 'c2';
  ctx.renderEnemyTracks();
  assert.equal(select(ctx).value, 'adversary', 'selection is remembered separately for each cycle');
});

test('legacy cycle marks and scalar tracks migrate without losing progress or reviving cleared marks', () => {
  const saved = {
    cycle: 'c3', enemies: {
      'c1:pursuer:5-4': true, 'c1:pursuer:triangle': true,
      'c2:adversary:1-0': true, 'c3:adversary:1-0': false, 'c3:adversary:4-3': true,
      'c4:dahaka:8-7': true, 'c5:titanX:9-8': true, 'c3:sunDescendant:2-1': true,
      'c2:adversary:3-2': true, 'nemesis:adversary:3-2': false,
    },
  };
  const before = clone(saved);
  const ctx = harness(saved);
  for (const key of ['pursuer:5-4', 'pursuer:triangle', 'adversary:1-0', 'adversary:4-3', 'dahaka:8-7', 'titanX:9-8']) {
    assert.equal(ctx.state.enemies[`nemesis:${key}`], true, key);
  }
  assert.equal(ctx.state.enemies['nemesis:adversary:3-2'], false);
  assert.equal(ctx.state.enemies['c3:sunDescendant:2-1'], true);
  assert.equal(ctx.state.enemies['c2:adversary:1-0'], undefined);
  assert.deepEqual(clone(ctx.normalizeState(ctx.state)), clone(ctx.state));
  assert.deepEqual(saved, before, 'migration does not mutate the supplied save');
  const scalar = harness({ enemies: { pursuer: '5', adversary: '2' } });
  assert.equal(scalar.state.enemies['nemesis:pursuer:5-4'], true);
  assert.equal(scalar.state.enemies['nemesis:adversary:2-1'], true);
});

test('resources and their quantities remain after switching away, saving, and reloading', () => {
  const ctx = harness({ cycle: 'c2', resources: { 'c2-core-adversary': 3, grotesqueBeak: 8 } });
  ctx.renderEnemyTracks();
  const original = keys(ctx);
  choose(ctx, 'dahaka');
  for (const key of ['core-dahaka', 'onyxDust', 'ireEssence']) assert.ok(keys(ctx).includes(key));
  ctx.state.resources['c2-onyxDust'] = 5;
  ctx.state.resources['c2-core-dahaka'] = 2;
  choose(ctx, 'pursuer');
  assert.ok(keys(ctx).includes('core-pursuer'));
  choose(ctx, 'adversary');
  for (const key of [...original, 'core-dahaka', 'onyxDust', 'ireEssence', 'core-pursuer']) assert.ok(keys(ctx).includes(key));
  assert.equal(new Set(keys(ctx)).size, keys(ctx).length, 'no duplicate resources');
  assert.equal(ctx.state.resources['c2-core-adversary'], 3);
  assert.equal(ctx.state.resources.grotesqueBeak, 8);
  assert.equal(ctx.state.resources['c2-onyxDust'], 5);
  assert.equal(ctx.state.resources['c2-core-dahaka'], 2);
  const restored = harness(clone(ctx.state));
  assert.deepEqual(keys(restored), keys(ctx));
  assert.deepEqual(clone(restored.state.resources), clone(ctx.state.resources));
});

test('an added resource with zero quantity remains visible and history is scoped to its cycle', () => {
  const ctx = harness({ cycle: 'c3' });
  ctx.selectNemesis('dahaka');
  ctx.selectNemesis('adversary');
  const restored = harness(clone(ctx.state));
  assert.ok(keys(restored).includes('onyxDust'));
  restored.state.cycle = 'c2';
  assert.ok(!keys(restored).includes('onyxDust'));
  assert.equal(restored.state.nemesisSelections.c3, 'adversary');
});

test('old saved nemesis resources remain accessible and legacy pursuer core uses the visible key', () => {
  const ctx = harness({ cycle: 'c2', resources: { 'c2-onyxDust': 0, 'c2-core-hermesian-pursuer': 4 } });
  assert.ok(keys(ctx).includes('onyxDust'));
  assert.ok(keys(ctx).includes('ireEssence'));
  assert.ok(keys(ctx).includes('core-pursuer'));
  assert.equal(ctx.state.resources['c2-core-pursuer'], 4);
  assert.equal(ctx.state.resources['c2-core-hermesian-pursuer'], undefined);
});

test('rendering selections, tracks, and resource lists leaves normalized merge values unchanged', () => {
  const ctx = harness({ cycle: 'c2', nemesisSelections: { c2: 'dahaka' }, enemies: { 'c4:dahaka:8-7': true } });
  const before = clone(ctx.state);
  ctx.renderEnemyTracks();
  ctx.currentResources();
  assert.deepEqual(clone(ctx.state), before);
});

test('concurrent changes to different cycles and resource history merge without dropping added resources', () => {
  const ctx = harness({ cycle: 'c2' });
  const base = clone(ctx.state);
  ctx.selectNemesis('dahaka');
  const local = clone(ctx.state);
  const remote = clone(base);
  remote.nemesisSelections.c3 = 'dahaka';
  remote.nemesisResourceHistory['c3:dahaka'] = true;
  const result = ctx.mergeRecordChanges(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.value.nemesisSelections.c2, 'dahaka');
  assert.equal(result.value.nemesisSelections.c3, 'dahaka');
  assert.equal(result.value.nemesisResourceHistory['c2:dahaka'], true);
  assert.equal(result.value.nemesisResourceHistory['c3:dahaka'], true);
});

function aibpContext() {
  const ctx = vm.createContext({});
  vm.runInContext([
    lootSource.slice(lootSource.indexOf('  const APOSTLE_RECORD_CORE_KEY = '), lootSource.indexOf('  const LEVEL_ORDER = ')),
    'const BURDEN_APOSTLE = "THE_BURDEN"; const RECORD_DEFAULT_CYCLE = "c2";',
    fn(lootSource, 'isPlainObject'), fn(lootSource, 'recordStageLevel'), fn(lootSource, 'recordEnemyLevel'),
    fn(lootSource, 'recordCycleForLoot'), fn(aibpSource, 'parseApostleLevel'), fn(aibpSource, 'recordLevelForTrack'),
  ].join('\n'), ctx);
  return ctx;
}

test('both AIBP level readers use shared nemesis progress and respect explicit clears over old marks', () => {
  const ctx = aibpContext();
  const tracks = [
    ['HERMESIAN_PURSUER', 'pursuer', 'c1', '5-4', 5], ['THE_BURDEN', 'adversary', 'c2', '4-3', 4],
    ['DAHAKA', 'dahaka', 'c4', '8-7', 8], ['TITAN_X', 'titanX', 'c5', '9-8', 9],
  ];
  for (const [apostle, key, cycle, stage, expected] of tracks) {
    const record = { cycle: 'c2', enemies: { [`nemesis:${key}:${stage}`]: true, [`nemesis:${key}:triangle`]: true } };
    assert.equal(ctx.recordLevelForTrack(record, { cycle, key }), expected);
    assert.equal(ctx.recordEnemyLevel(record, apostle), expected);
    record.enemies[`nemesis:${key}:${stage}`] = false;
    record.enemies[`${cycle}:${key}:${stage}`] = true;
    record.enemies[key] = expected;
    assert.equal(ctx.recordLevelForTrack(record, { cycle, key }), 0);
    assert.equal(ctx.recordEnemyLevel(record, apostle), 0);
  }
  const legacy = { cycle: 'c2', enemies: { 'c3:adversary:4-3': true, 'c4:dahaka:8-7': true } };
  assert.equal(ctx.recordLevelForTrack(legacy, { cycle: 'c2', key: 'adversary' }), 4);
  assert.equal(ctx.recordEnemyLevel(legacy, 'THE_BURDEN'), 4);
  assert.equal(ctx.recordEnemyLevel(legacy, 'DAHAKA'), 8);
});

test('nemesis loot writes to the active allowed cycle and uses the displayed pursuer core key', () => {
  const ctx = aibpContext();
  for (const [apostle, cycles] of [
    ['HERMESIAN_PURSUER', ['c1', 'c2']], ['THE_BURDEN', ['c2', 'c3']],
    ['DAHAKA', ['c2', 'c3', 'c4']], ['TITAN_X', ['c5']],
  ]) {
    for (const cycle of cycles) assert.equal(ctx.recordCycleForLoot(apostle, { cycle }), cycle);
  }
  assert.equal(ctx.recordCycleForLoot('DAHAKA', { cycle: 'c5' }), 'c4');
  assert.equal(ctx.recordCycleForLoot('DAHAKA', { cycle: 'c4' }, 'c2'), 'c2');
  assert.equal(vm.runInContext('APOSTLE_RECORD_CORE_KEY.HERMESIAN_PURSUER', ctx), 'core-pursuer');
});
