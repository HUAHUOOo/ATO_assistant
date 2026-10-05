/* 第二屏正文的栏数与字号：两栏 / 三栏按「字号能给到多大」挑。
 *
 * 运行：node story/tests/second-screen-story-columns.test.cjs
 *
 * 只跑 ss/app.js 里的真实函数，配一个最小 DOM：
 *   - 含块状媒体（战斗模块）的条目：目标是整屏放得下（view.scrollHeight <= clientHeight），
 *     字号一样大时优先三栏；
 *   - 纯文字条目：仍是容器内纵向横向都放得下，字号一样大时保持两栏（阅读节奏不变）；
 *   - 三栏只有在够宽时才试（窄屏三栏每栏不到两百像素，字和图都没法看）；
 *   - 两张栏数都跑一遍二分，谁的字号大用谁。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const SS_SOURCE = fs.readFileSync(path.join(__dirname, '../../ss/app.js'), 'utf8');
const SS_STYLES = fs.readFileSync(path.join(__dirname, '../../ss/styles.css'), 'utf8');
const MM_STYLES = fs.readFileSync(path.join(__dirname, '../assets/mixed-media/styles.css'), 'utf8');

function slice(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `找不到函数 ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function classList(names = []) {
  const set = new Set(names);
  return {
    contains: (name) => set.has(name),
    add(...list) { list.forEach(name => set.add(name)); },
    remove(...list) { list.forEach(name => set.delete(name)); },
    toggle(name, on) {
      const next = on === undefined ? !set.has(name) : Boolean(on);
      if (next) set.add(name); else set.delete(name);
      return next;
    },
  };
}

function styleObject() {
  return {
    setProperty(key, value) { this[key] = value; },
    removeProperty(key) { delete this[key]; },
  };
}

// heightFor(字号, 栏数) → 内容高度：测试用它模拟「三栏把同样的内容摊得更开」。
// board=true 时正文里有一张版图（战斗模块），tie 时优先三栏；否则只有块状小图或没有媒体。
function ssContext({ mixedMedia = false, board = false, wide = true, heightFor = (size) => size * 30 } = {}) {
  const boardItem = { classList: classList(['ato-mm-item', 'ato-mm-block', 'ato-mm-battle', 'ato-mm-terrain-diagram']) };
  const glyphItem = { classList: classList(['ato-mm-item', 'ato-mm-block']) };
  const storyBody = {
    classList: classList(mixedMedia ? ['ato-mm-layout'] : []),
    style: styleObject(),
    hidden: false,
    offsetHeight: 500,
    scrollTop: 0,
    scrollLeft: 0,
    clientWidth: wide ? 1200 : 320,
    clientHeight: 500,
    scrollWidth: wide ? 1200 : 320,
    querySelectorAll: () => (mixedMedia ? [board ? boardItem : glyphItem] : []),
  };
  const storyView = {
    classList: classList(),
    style: styleObject(),
    hidden: false,
    scrollTop: 0,
    clientWidth: wide ? 1200 : 320,
    clientHeight: 500,
  };
  const size = () => Number.parseInt(storyBody.style['font-size'] || '18', 10);
  const columns = () => Number(storyView.style['--story-columns'] || 2);
  Object.defineProperty(storyView, 'scrollHeight', { get: () => heightFor(size(), columns()) });
  Object.defineProperty(storyBody, 'scrollHeight', { get: () => heightFor(size(), columns()) });

  const context = vm.createContext({
    elements: { storyBody, storyView },
    activeMode: 'story',
    window: { requestAnimationFrame: (callback) => { callback(); return 1; } },
    console,
  });
  ['mixedStoryLayout', 'isStoryBoardItem', 'storyBoardLayout', 'storyColumnChoices', 'setStoryColumnCount',
    'searchStoryFontSize', 'fitStoryTextToViewport']
    .forEach(name => vm.runInContext(slice(SS_SOURCE, name), context));
  const minWidth = /const storyThreeColumnMinWidth = (\d+);/.exec(SS_SOURCE);
  assert.ok(minWidth, '找不到 storyThreeColumnMinWidth');
  vm.runInContext(`const storyThreeColumnMinWidth = ${minWidth[1]};`, context);
  return { context, storyBody, storyView, size, columns };
}

const columnsCase = (count, size) => (fontSize, columnCount) => (columnCount >= count ? fontSize * 20 : fontSize * 30);

test('战斗模块（挂了版图）：三栏能把字号做大就用三栏', () => {
  const page = ssContext({ mixedMedia: true, board: true, heightFor: (size, count) => size * (count === 3 ? 20 : 30) });
  page.context.fitStoryTextToViewport();

  assert.equal(page.storyView.classList.contains('story-scroll'), true);
  assert.equal(page.columns(), 3);
  assert.equal(page.size(), 22); // 三栏 22×20=440 放得下；两栏最多 16px
  assert.equal(page.storyBody.style['font-size'], '22px');
});

test('战斗模块（挂了版图）：字号一样大时也用三栏', () => {
  const page = ssContext({ mixedMedia: true, board: true, heightFor: (size) => size * 10 });
  page.context.fitStoryTextToViewport();
  assert.equal(page.columns(), 3);
  assert.equal(page.size(), 22);
});

test('只有块状小图（铭文、字形）：字号一样大时保持两栏', () => {
  const page = ssContext({ mixedMedia: true, board: false, heightFor: (size) => size * 10 });
  page.context.fitStoryTextToViewport();
  assert.equal(page.columns(), 2);
  assert.equal(page.size(), 22);
});

test('纯文字：三栏能换到更大字号时才切成三栏', () => {
  const page = ssContext({ mixedMedia: false, heightFor: (size, count) => size * (count === 3 ? 20 : 30) });
  page.context.fitStoryTextToViewport();
  assert.equal(page.storyView.classList.contains('story-scroll'), false);
  assert.equal(page.columns(), 3);
  assert.equal(page.size(), 22);
});

test('纯文字：字号一样大时保持两栏', () => {
  const page = ssContext({ mixedMedia: false, heightFor: (size) => size * 10 });
  page.context.fitStoryTextToViewport();
  assert.equal(page.columns(), 2);
  assert.equal(page.size(), 22);
});

test('窄屏不试三栏（手机竖屏三栏没法看）', () => {
  const mixed = ssContext({ mixedMedia: true, board: true, wide: false, heightFor: (size, count) => size * (count === 3 ? 20 : 30) });
  mixed.context.fitStoryTextToViewport();
  assert.equal(mixed.columns(), 2);
  assert.equal(mixed.size(), 16); // 只有两栏：30×16=480 放得下，17 就 510 了

  const text = ssContext({ mixedMedia: false, wide: false, heightFor: (size, count) => size * (count === 3 ? 20 : 30) });
  text.context.fitStoryTextToViewport();
  assert.equal(text.columns(), 2);
});

test('保留滚动位置时不动，重算时回到顶部', () => {
  const page = ssContext({ mixedMedia: true, board: true, heightFor: (size) => size * 10 });
  page.storyView.scrollTop = 240;
  page.context.fitStoryTextToViewport(true);
  assert.equal(page.storyView.scrollTop, 240);
  page.context.fitStoryTextToViewport();
  assert.equal(page.storyView.scrollTop, 0);
});

test('二分用的是当前栏数：每个栏数各量一遍，赢家再写回字号', () => {
  const seen = [];
  const page = ssContext({ mixedMedia: true, board: true, heightFor: (size, count) => { seen.push(count); return size * 10; } });
  page.context.fitStoryTextToViewport();
  assert.ok(seen.includes(2) && seen.includes(3), `两个栏数都要量：${[...new Set(seen)]}`);
  assert.equal(page.columns(), 3);
});

test('样式表：栏数走 --story-columns 变量，默认两栏', () => {
  assert.match(SS_STYLES, /\.story-body \{[^}]*column-count: var\(--story-columns, 2\)/s);
  assert.match(SS_STYLES, /\.story-view\.story-scroll \.story-body\.ato-mm-layout\s*\{[^}]*column-count: var\(--story-columns, 2\)/s);
  assert.match(SS_STYLES, /\.story-view\.story-scroll \.story-body\.ato-mm-layout\s*\{[^}]*overflow: visible/s);
  assert.match(SS_STYLES, /\.story-view\.story-scroll \.story-card\s*\{[^}]*height: auto/s);
  assert.match(SS_STYLES, /\.story-view\.story-scroll \.story-card-head\s*\{[^}]*position: sticky/s);
  assert.match(SS_STYLES, /\.story-view\.story-scroll \.story-body \.ato-mm-block img\s*\{[^}]*max-height: 13em/s);
  // 被压过的那条：块状媒体出现时混排样式表原本把多栏整个退掉。
  assert.match(MM_STYLES, /\.story-body\.ato-mm-layout\s*\{[^}]*column-count: auto/s);
});
