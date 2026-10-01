const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../technology/index.html'), 'utf8').replace(/\r\n/g, '\n');

function setup() {
  const pages = Array.from({ length: 5 }, (_, index) => ({
    key: `cycle${index + 1}`, label: `循环 ${['I', 'II', 'III', 'IV', 'V'][index]}`,
    nodes: [{ id: 'core', core: true }, { id: 'optional' }],
  }));
  const saved = [];
  const attributes = {};
  const c = vm.createContext({
    data: { pages }, PAGE_INDEX: new Map(pages.map((page, i) => [page.key, i])),
    currentCycle: 'cycle1', viewPage: 'gear-production', currentTab: 'gear-production', selectedNodeId: 'old-node',
    unlocked: new Set(['custom-progress']),
    conditionTicked: new Set(['existing-condition']),
    cycleBadge: { setAttribute: (key, value) => { attributes[key] = value; } },
    nodeKey: (page, node) => `${page}:${node.id}`, isCoreNode: node => node.core,
    updateTechnologyTheme() {}, renderTabs() {}, renderTree() {}, refreshUnlockState() {},
  });
  c.saveAccounts = () => saved.push({ cycle: c.currentCycle, unlocked: [...c.unlocked], conditions: [...c.conditionTicked] });
  for (const name of ['unlockAutomaticCyclesThrough', 'renderCycleButton', 'advanceTechnologyCycle']) {
    const code = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'))?.[0];
    assert.ok(code, `${name} must exist`);
    vm.runInContext(code, c);
  }
  return { c, saved, attributes };
}

test('clicking advances the active cycle, persists progress and opens its tree', () => {
  const { c, saved, attributes } = setup();
  c.advanceTechnologyCycle();
  assert.equal(c.currentCycle, 'cycle2');
  assert.equal(c.viewPage, 'cycle2');
  assert.equal(c.currentTab, 'cycle2');
  assert.equal(c.selectedNodeId, null);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].cycle, 'cycle2');
  assert.ok(saved[0].unlocked.includes('custom-progress'));
  assert.ok(saved[0].unlocked.includes('cycle1:optional'));
  assert.ok(saved[0].unlocked.includes('cycle2:core'));
  assert.deepEqual(saved[0].conditions, ['existing-condition']);
  assert.equal(c.cycleBadge.textContent, '循环 II');
  assert.match(attributes['aria-label'], /点击切换为循环 III/);
});

test('cycle V wraps to I without erasing accumulated unlocks', () => {
  const { c, saved } = setup();
  for (let i = 0; i < 5; i++) c.advanceTechnologyCycle();
  assert.deepEqual(saved.map(state => state.cycle), ['cycle2', 'cycle3', 'cycle4', 'cycle5', 'cycle1']);
  assert.equal(c.cycleBadge.textContent, '循环 I');
  assert.ok(c.unlocked.has('cycle4:optional'));
  assert.ok(c.unlocked.has('custom-progress'));
});

test('the cycle label remains the active cycle in equipment views and ignores clicks before loading', () => {
  const { c, saved } = setup();
  c.currentCycle = 'cycle5';
  c.renderCycleButton();
  assert.equal(c.cycleBadge.textContent, '循环 V');
  assert.match(c.cycleBadge.title, /点击切换为循环 I/);
  c.data = null;
  c.advanceTechnologyCycle();
  assert.equal(saved.length, 0);
  assert.equal(c.currentCycle, 'cycle5');
});
