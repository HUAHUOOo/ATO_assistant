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
  const menu = {};
  const c = vm.createContext({
    data: { pages }, PAGE_INDEX: new Map(pages.map((page, i) => [page.key, i])),
    currentCycle: 'cycle1', viewPage: 'gear-production', currentTab: 'gear-production', selectedNodeId: 'old-node',
    unlocked: new Set(['custom-progress']),
    conditionTicked: new Set(['existing-condition']),
    cycleBadge: { setAttribute: (key, value) => { attributes[key] = value; } },
    document: { getElementById: () => menu }, esc: value => value,
    nodeKey: (page, node) => `${page}:${node.id}`, isCoreNode: node => node.core,
    updateTechnologyTheme() {}, renderTabs() {}, renderTree() {}, refreshUnlockState() {},
  });
  c.saveAccounts = () => saved.push({ cycle: c.currentCycle, unlocked: [...c.unlocked], conditions: [...c.conditionTicked] });
  for (const name of ['unlockAutomaticCyclesThrough', 'renderCycleButton', 'selectTechnologyCycle']) {
    const code = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'))?.[0];
    assert.ok(code, `${name} must exist`);
    vm.runInContext(code, c);
  }
  return { c, saved, attributes, menu };
}

test('choosing a cycle persists progress and opens its tree', () => {
  const { c, saved, attributes } = setup();
  c.selectTechnologyCycle('cycle2');
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
  assert.equal(c.cycleBadge.textContent, '循环 II ▾');
  assert.match(attributes['aria-label'], /点击选择循环/);
});

test('arbitrary selections preserve accumulated unlocks and ignore the current or invalid cycle', () => {
  const { c, saved } = setup();
  for (const key of ['cycle5', 'cycle1', 'cycle1', 'invalid', 'cycle3']) c.selectTechnologyCycle(key);
  assert.deepEqual(saved.map(state => state.cycle), ['cycle5', 'cycle1', 'cycle3']);
  assert.equal(c.cycleBadge.textContent, '循环 III ▾');
  assert.ok(c.unlocked.has('cycle4:optional'));
  assert.ok(c.unlocked.has('custom-progress'));
});

test('the cycle label remains the active cycle in equipment views and ignores clicks before loading', () => {
  const { c, saved, menu } = setup();
  c.currentCycle = 'cycle5';
  c.renderCycleButton();
  assert.equal(c.cycleBadge.textContent, '循环 V ▾');
  assert.match(menu.innerHTML, /data-cycle="cycle5" aria-pressed="true"/);
  assert.equal((menu.innerHTML.match(/data-cycle=/g) || []).length, 5);
  c.data = null;
  c.selectTechnologyCycle('cycle1');
  assert.equal(saved.length, 0);
  assert.equal(c.currentCycle, 'cycle5');
});
