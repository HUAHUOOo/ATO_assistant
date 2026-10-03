// C4 主控制台：日期轨没有上限，而且每一天都算战斗日。
// 1) battleEveryDay 让日期轨和「今日战斗」提醒对 C4 的任意一天都成立，包括时间表
//    最后一行（Day 96）之后的续推日；
// 2) nextDay() 走到最后一行后继续按数字 +1，不停在 96；
// 3) trackEntriesForRender() 给时间表之外的当天补一行，否则日期轨里没有「当前」。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

function extractFunction(name) {
  const match = source.match(new RegExp('^    (?:async )?function ' + name + '\\([^]*?^    }', 'm'));
  assert.ok(match, `missing ${name}`);
  return match[0];
}

function extractConstObject(name) {
  const match = source.match(new RegExp('^    const ' + name + ' = (\\{[^]*?^    \\};)', 'm'));
  assert.ok(match, `missing ${name}`);
  return match[1];
}

function setup(extra = {}) {
  const ctx = vm.createContext({
    state: {day: 96, completed: {}, events: [], notes: ''},
    currentCycleConfig: () => ({id: 'c4'}),
    ...extra,
  });
  vm.runInContext(`dateTrackData = ${extractConstObject('dateTrackData')};`, ctx);
  vm.runInContext(`dateIconTypes = ${extractConstObject('dateIconTypes')};`, ctx);
  vm.runInContext([
    extractFunction('isTrackBattleDay'),
    extractFunction('dateTrackIcons'),
    extractFunction('trackEntriesForRender'),
    extractFunction('todayTrackIcons'),
    extractFunction('getStepTrackReminders'),
    extractFunction('nextDay'),
  ].join('\n'), ctx);
  // nextDay() 里的存档与重绘：只记录有没有被调用。
  ctx.rendered = [];
  ctx.syncInputs = () => {};
  ctx.saveState = () => {};
  ctx.renderFlow = () => {};
  ctx.renderDateTrack = options => ctx.rendered.push(options || null);
  ctx.getExploreMapReminders = () => [];
  ctx.getSurveyMapReminders = () => [];
  ctx.getStoryMapReminders = () => [];
  ctx.getDoomMapReminders = () => [];
  ctx.getNextBattleTerrainReminder = () => [];
  return ctx;
}

const battleIcon = icon => icon.className === 'battle';
// vm 里造出来的对象原型和测试进程不同，比较前先变成普通对象。
const plain = value => JSON.parse(JSON.stringify(value));

// 只够 renderDateTrack() 用的最小 DOM：记录日期轨最终画出来的行。
function setupRender(day) {
  const rows = [];
  const element = tag => ({
    tag, className: '', title: '', innerHTML: '', children: [],
    setAttribute() {}, addEventListener() {}, appendChild(child) { this.children.push(child); },
  });
  const ctx = vm.createContext({
    state: {day, completed: {}, events: [], notes: '', dateNotes: {}},
    currentCycleConfig: () => ({id: 'c4'}),
    elements: {
      dateTrackList: {innerHTML: '', appendChild(node) { rows.push(...node.children); }},
      dateTrackMeta: {innerHTML: '', textContent: ''},
    },
    document: {
      createElement: element,
      createDocumentFragment: () => ({children: [], appendChild(child) { this.children.push(child); }}),
    },
    escapeHtml: value => String(value),
    getAcclimationRule: () => null,
    renderCurrentDateNote: () => {},
    keepCurrentDateVisible: () => {},
  });
  vm.runInContext(`dateTrackData = ${extractConstObject('dateTrackData')};`, ctx);
  vm.runInContext(`dateIconTypes = ${extractConstObject('dateIconTypes')};`, ctx);
  vm.runInContext([
    extractFunction('formatTrackDay'),
    extractFunction('dateNoteKey'),
    extractFunction('isTrackBattleDay'),
    extractFunction('dateTrackIcons'),
    extractFunction('trackEntriesForRender'),
    extractFunction('renderDateTrack'),
  ].join('\n'), ctx);
  ctx.renderDateTrack();
  return {ctx, rows};
}

test('C4 每天都有战斗，时间表之外的日子也算', () => {
  const ctx = setup();
  const track = ctx.dateTrackData.c4;
  assert.equal(track.battleEveryDay, true);
  assert.equal(track.battleDays, undefined);
  assert.equal(track.entries.at(-1).day, 96);
  for (const day of [0, 1, 2, 6, 17, 18, 50, 78, 79, 80, 96, 97, 120, 999]) {
    assert.equal(ctx.isTrackBattleDay(day, track), true, `C4 Day ${day} 应该是战斗日`);
    assert.ok(ctx.dateTrackIcons({day}, track).some(battleIcon), `C4 Day ${day} 日期轨缺少战斗标记`);
  }
});

test('其它循环仍按各自的 battleDays 标记', () => {
  const ctx = setup();
  const c2 = ctx.dateTrackData.c2;
  assert.ok(!ctx.dateTrackIcons({day: 2}, c2).some(battleIcon), 'C2 Day 2 不该是战斗日');
  assert.ok(ctx.dateTrackIcons({day: 7}, c2).some(battleIcon), 'C2 Day 7 应该是战斗日');
  assert.equal(ctx.isTrackBattleDay(null, c2), false);
});

test('今日战斗提醒在 C4 的每一天都会出现，包括 96 之后', () => {
  const ctx = setup();
  for (const day of [3, 96, 97, 150]) {
    ctx.state.day = day;
    const reminders = ctx.getStepTrackReminders('encounter');
    assert.ok(reminders.some(reminder => reminder.title === '今日战斗'), `C4 Day ${day} 缺少今日战斗提醒`);
  }
  ctx.currentCycleConfig = () => ({id: 'c2'});
  ctx.state.day = 2;
  assert.ok(!ctx.getStepTrackReminders('encounter').some(reminder => reminder.title === '今日战斗'));
});

test('nextDay 走到 Day 96 后继续往后推，没有上限', () => {
  const ctx = setup();
  ctx.state.day = 17;
  ctx.nextDay();
  assert.equal(ctx.state.day, 18, '时间表内仍然跟着下一行走');
  ctx.state.day = 96;
  ctx.rendered.length = 0;
  const days = [];
  for (let index = 0; index < 5; index += 1) {
    ctx.nextDay();
    days.push(ctx.state.day);
  }
  assert.deepEqual(days, [97, 98, 99, 100, 101]);
  assert.equal(ctx.rendered.length, 5);
  assert.deepEqual(plain(ctx.rendered[0]), {focusCurrentDay: true});
});

test('时间表之外的日子会在日期轨里补出当天一行', () => {
  const ctx = setup();
  const track = ctx.dateTrackData.c4;
  ctx.state.day = 96;
  assert.equal(ctx.trackEntriesForRender(track).length, 97);
  assert.ok(!ctx.trackEntriesForRender(track).some(entry => entry.beyondTrack));

  ctx.state.day = 97;
  const extended = ctx.trackEntriesForRender(track);
  assert.equal(extended.length, 98);
  assert.deepEqual(plain(extended.at(-1)), {day: 97, beyondTrack: true});
  assert.equal(extended[0].day, 0, '原有的时间表行不能被改动');

  ctx.state.day = 5000;
  assert.equal(ctx.trackEntriesForRender(track).length, 98, '补行只加当天一行，不铺满中间的日子');

  ctx.state.day = 50;
  assert.equal(ctx.trackEntriesForRender(track).length, 97, '时间表内的日子不补行');
});

test('补出来的当天行也带战斗标记，顶部 day 输入框接受任意数字', () => {
  const ctx = setup();
  ctx.state.day = 97;
  const entry = ctx.trackEntriesForRender(ctx.dateTrackData.c4).at(-1);
  assert.ok(ctx.dateTrackIcons(entry, ctx.dateTrackData.c4).some(battleIcon));
  assert.ok(source.includes('state.day = normalizeCampaignDay(elements.dayInput.value, currentCycleConfig().id)'));

  vm.runInContext([extractFunction('defaultDayForCycle'), extractFunction('normalizeCampaignDay')].join('\n'), ctx);
  assert.equal(ctx.normalizeCampaignDay('97', 'c4'), 97);
  assert.equal(ctx.normalizeCampaignDay('5000', 'c4'), 5000, '手填大数字不能被截断');
  assert.equal(ctx.normalizeCampaignDay('T6/00', 'c1'), 'T6/00');
});

test('日期轨画出当天那一行：96 停在时间表末尾，97 之后补一行', () => {
  const last = setupRender(96);
  assert.equal(last.rows.length, 97);
  assert.ok(last.rows.at(-1).className.includes('date-track-item'));
  assert.ok(last.rows.at(-1).className.includes('current'));
  assert.ok(!last.rows.at(-1).className.includes('beyond-track'));
  assert.ok(last.rows.at(-1).innerHTML.includes('战斗'));

  const beyond = setupRender(97);
  assert.equal(beyond.rows.length, 98);
  assert.ok(beyond.rows.at(-1).className.includes('beyond-track'));
  assert.ok(beyond.rows.at(-1).className.includes('current'));
  assert.ok(beyond.rows.at(-1).innerHTML.includes('战斗'), '续推日也要有战斗标记');
  assert.match(beyond.rows.at(-1).title, /时间表之外/);
  assert.equal(beyond.rows.filter(row => row.className.includes('current')).length, 1);
});

test('all inline dashboard scripts parse', () => {
  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
});
