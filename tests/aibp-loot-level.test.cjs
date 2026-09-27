const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'aibp/index.html'), 'utf8').replace(/\r\n/g, '\n');
function harness() {
  const element = () => ({ style: {}, appendChild() {}, addEventListener() {} });
  const ctx = vm.createContext({
    console, currentApostle: 'HEKATON', apostleLevelOverrides: {}, recordApostleLevels: {},
    fixedLevelOneApostles: new Set(), maxApostleLevel: 9,
    piles: { HEKATON: { BP: {
      deck: [{ type: 'BP', level: 'III', index: 1 }], discard: [],
      damage: [{ type: 'BP', level: 'I', index: 1 }], damage1: [], damage2: [],
    } } },
    document: {
      readyState: 'complete', head: element(), body: element(), createElement: element,
      getElementById: () => null, querySelector: () => element(),
    },
    localStorage: { getItem: () => null }, cardSrc: () => '',
  });
  ctx.window = ctx;
  for (const name of ['apostleLevelFor', 'currentApostleLevel']) {
    vm.runInContext(html.match(new RegExp('^    function ' + name + '\\([^]*?^    }', 'm'))[0], ctx);
  }
  for (const file of ['aibp/ps/other/resouce/bp_resource_map.js', 'aibp/ps/other/resouce/bp_resource_map_c1_c3.js', 'aibp/bp_loot_calculator_addon.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  }
  return ctx;
}

test('loot uses selected level 1 despite III cards and a stale level 3 record (P55)', () => {
  const ctx = harness();
  ctx.apostleLevelOverrides.HEKATON = 1;
  ctx.recordApostleLevels.HEKATON = 3;
  const result = ctx.AIBP_calculateBpLoot({ recordMultiplier: 3 });
  assert.equal(result.multiplier, 1);
  assert.equal(result.multiplierSource, 'aibp');
  assert.equal(result.totals.RA, 1);
  assert.equal(result.details.levelBonus.length, 0);
});

test('loot reads current level when it comes from the record rather than an override', () => {
  const ctx = harness();
  ctx.recordApostleLevels.HEKATON = 4;
  const result = ctx.AIBP_calculateBpLoot();
  assert.equal(result.multiplier, 4);
  assert.equal(result.totals.RA, 4);
});

test('an explicit loot multiplier still overrides the selected AIBP level', () => {
  const ctx = harness();
  ctx.apostleLevelOverrides.HEKATON = 1;
  const result = ctx.AIBP_calculateBpLoot({ multiplier: 2, recordMultiplier: 3 });
  assert.equal(result.multiplier, 2);
  assert.equal(result.multiplierSource, 'manual');
  assert.equal(result.totals.RA, 2);
});

test('without AIBP level access, use record level and never infer level from BP tiers', () => {
  const ctx = harness();
  ctx.currentApostleLevel = undefined;
  assert.equal(ctx.AIBP_calculateBpLoot({ recordMultiplier: 2 }).multiplier, 2);
  const result = ctx.AIBP_calculateBpLoot();
  assert.equal(result.multiplier, 1);
  assert.equal(result.multiplierSource, 'default');
  assert.equal(result.totals.RA, 1);
});
