const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../aibp/index.html'), 'utf8').replace(/\r\n/g, '\n');
const context = vm.createContext({ nietzscheName: 'THE_NIETZSCJEAN' });
for (const name of ['traitFileName', 'traitSrc', 'traitKey', 'syncNietzscheAllForOneTrait', 'isNietzscheAllForOneLegacyTrait']) {
  const match = source.match(new RegExp(`^    function ${name}\\([^]*?^    }`, 'm'));
  assert.ok(match, `${name} exists`);
  vm.runInContext(match[0], context);
}

test('All For One is Trait O but keeps the existing card image path', () => {
  assert.equal(context.traitSrc('THE_NIETZSCJEAN', 'O', 2),
    'ps/THE_NIETZSCJEAN/THE_NIETZSCJEAN_TR_II_002.jpg');
  assert.equal(context.isNietzscheAllForOneLegacyTrait('THE_NIETZSCJEAN', 'II', 2), true);
  assert.equal(context.isNietzscheAllForOneLegacyTrait('THE_NIETZSCJEAN', 'II', 1), false);
  assert.equal(context.isNietzscheAllForOneLegacyTrait('OTHER', 'II', 2), false);
});

test('What Are You? adds Trait O once, regardless of apostle level', () => {
  const state = { traits: [] };
  assert.equal(context.syncNietzscheAllForOneTrait(state, 'the-cruel-lesson'), false);
  assert.equal(state.traits.length, 0);
  assert.equal(context.syncNietzscheAllForOneTrait(state, 'what-are-you'), true);
  assert.equal(state.traits.length, 1);
  assert.equal(state.traits[0].level, 'O');
  assert.equal(state.traits[0].index, 2);
  assert.equal(context.syncNietzscheAllForOneTrait(state, 'what-are-you'), false);
  assert.equal(state.traits.length, 1);
});

test('a cancelled default trait is not added back by the setup sync', () => {
  const key = context.traitKey('O', 2, 'jpg', '');
  const state = { traits: [], hiddenTraits: [key] };
  assert.equal(context.syncNietzscheAllForOneTrait(state, 'what-are-you'), false);
  assert.equal(state.traits.length, 0);
  // 重新勾选后（hiddenTraits 里去掉这条）setup 同步恢复原来的行为。
  state.hiddenTraits = [];
  assert.equal(context.syncNietzscheAllForOneTrait(state, 'what-are-you'), true);
  assert.equal(state.traits.length, 1);
});
