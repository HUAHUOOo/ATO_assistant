const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../technology/index.html'), 'utf8').replace(/\r\n/g, '\n');
const pages = Array.from({ length: 5 }, (_, i) => ({ key: `cycle${i + 1}`, label: `循环 ${i + 1}`, nodes: [] }));
const noop = () => {};

function setup(storage = new Map(), blocked = false) {
  const keys = [...pages.map(page => page.key), 'unlocked', 'gear-production', 'arsenal'];
  const buttons = keys.map(key => ({ dataset: { page: key }, addEventListener(_type, fn) { this.click = fn; } }));
  const c = vm.createContext({
    data: null, currentTab: null, lastTechnologyTab: null, currentCycle: null, viewPage: null,
    URLSearchParams, TECH_CYCLE_BY_MAIN_CYCLE: { c1: 'cycle1', c2: 'cycle2', c3: 'cycle3' },
    window: { location: { search: '' }, localStorage: {
      getItem: key => { if (blocked) throw new Error('blocked'); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (blocked) throw new Error('blocked'); storage.set(key, value); },
    } },
    tabs: { innerHTML: '', querySelectorAll: () => buttons }, search: {}, esc: String,
    isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value),
    computeDisambiguatedTechNames: () => new Set(), unlockAutomaticCyclesThrough: noop,
    updateLanguageToggle: noop, syncHideUnknownToggle: noop, renderAccountSelect: noop,
    renderCycleButton: noop, updateTechnologyTheme: noop, loadCampaignTechnologySection: noop,
    technologySectionState: () => ({}), loadGearRecordState: noop,
  });
  c.renderTree = () => { c.rendered = c.viewPage; };
  c.renderUnlockedPage = () => { c.rendered = 'unlocked'; };
  c.renderGearProductionPage = () => { c.rendered = 'gear-production'; };
  c.renderArsenalPage = () => { c.rendered = 'arsenal'; };
  c.renderGearInventoryView = () => { c.rendered = c.currentTab; };
  vm.runInContext(source.match(/^function validPageKey[^\n]+/m)[0], c);
  for (const name of ['viewPageFor', 'restoreTechnologyTab', 'renderTabs', 'refreshUnlockState',
    'defaultAccounts', 'loadAccounts', 'boot', 'techAccountFromUser',
    'applyCampaignUsersToTechnology', 'applyTechnologyAccountState']) {
    const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], c);
  }
  c.chooseTab = key => buttons.find(button => button.dataset.page === key).click();
  return c;
}

function campaign(cycle = 'cycle2') {
  return { sections: {
    dashboard: { activeProfileId: 'A', profiles: { A: { name: '战役 A' } } },
    technology: { users: { A: { currentCycle: cycle, unlocked: ['saved-tech'] } } },
  } };
}

test('refresh restores each selected option through boot, campaign loading and later sync', () => {
  for (const tab of ['gear-production', 'arsenal', 'unlocked', 'cycle4']) {
    const storage = new Map();
    const first = setup(storage);
    first.boot({ pages });
    first.chooseTab(tab);
    assert.equal(first.rendered, tab);
    const refreshed = setup(storage);
    refreshed.boot({ pages });
    assert.equal(refreshed.currentTab, tab);
    assert.equal(refreshed.rendered, tab);
    assert.equal(refreshed.applyCampaignUsersToTechnology(campaign()), true);
    assert.equal(refreshed.currentCycle, 'cycle2', 'last viewed tab must not overwrite campaign progress');
    assert.equal(refreshed.currentTab, tab);
    assert.equal(refreshed.rendered, tab);
    refreshed.applyTechnologyAccountState({ currentCycle: 'cycle3', unlocked: ['remote-tech'] });
    assert.equal(refreshed.currentTab, tab);
    assert.equal(refreshed.rendered, tab);
    assert.ok(refreshed.unlocked.has('remote-tech'));
    assert.ok(refreshed.tabs.innerHTML.includes(`class="tab active" data-page="${tab}"`));
  }
});

test('the first visit follows the saved campaign cycle without persisting the temporary boot tree', () => {
  const storage = new Map();
  const c = setup(storage);
  c.boot({ pages });
  assert.equal(storage.size, 0);
  c.applyCampaignUsersToTechnology(campaign('cycle3'));
  assert.equal(c.currentTab, 'cycle3');
  assert.equal(c.rendered, 'cycle3');
  assert.equal(storage.size, 0);
});

test('invalid preferences fall back safely and blocked storage preserves navigation during sync', () => {
  const invalid = setup(new Map([['ato-technology-last-tab', 'removed-tab']]));
  invalid.boot({ pages });
  assert.equal(invalid.currentTab, 'cycle1');
  invalid.applyCampaignUsersToTechnology(campaign('cycle3'));
  assert.equal(invalid.currentTab, 'cycle3');
  const blocked = setup(new Map(), true);
  blocked.boot({ pages });
  blocked.chooseTab('gear-production');
  blocked.applyCampaignUsersToTechnology(campaign());
  assert.equal(blocked.currentTab, 'gear-production');
  assert.equal(blocked.rendered, 'gear-production');
});
