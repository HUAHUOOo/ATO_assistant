/*
 * 英雄记录表「拖动排序」回归。
 *
 * 四个英雄框的显示顺序就是 state.heroes 的数组顺序（顺序跟着存档同步到 NAS），
 * 拖动只做两件事：先算插入位置（heroLayoutIsHorizontal / heroDropIndex），
 * 再按 DOM 里的新顺序重排数组（moveHeroInOrder / reorderHeroesByIds）。
 *
 * 这几个纯函数直接从 hero/index.html 抽出来跑，布局用合成矩形代替真实 DOM：
 * 宽屏四列一排、两列两排、手机单列都覆盖一遍。
 * 页面原先没有任何重排入口（顺序只能由添加英雄的先后决定），所以这里同时钉住
 * 「入口还在」「插入位置算得对」「重排不丢英雄」三件事。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const heroSource = fs.readFileSync(path.join(root, 'hero/index.html'), 'utf8').replace(/\r\n/g, '\n');

function extractFunction(name) {
  const pattern = new RegExp('^( *)(?:async )?function ' + name + '\\([^]*?^\\1}', 'm');
  const match = heroSource.match(pattern);
  assert.ok(match, `hero/index.html 缺少函数 ${name}`);
  return match[0];
}

const FUNCTIONS = ['heroLayoutIsHorizontal', 'heroDropIndex', 'moveHeroInOrder', 'reorderHeroesByIds'];
const sandbox = vm.createContext({});
FUNCTIONS.forEach(name => {
  vm.runInContext(extractFunction(name), sandbox, { filename: `hero/index.html#${name}` });
});
const { heroLayoutIsHorizontal, heroDropIndex, moveHeroInOrder, reorderHeroesByIds } = sandbox;

// 合成布局：columns 列一排，列宽 width、列高 height、间距 gap。
function layout(ids, { columns, width = 320, height = 700, gap = 14 }) {
  return ids.map((id, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return { id, left: column * (width + gap), top: row * (height + gap), width, height };
  });
}

// 走一遍松手时发生的事：指针位置 → 插入位置 → 新的英雄顺序。
function drag(order, draggedId, others, pointerX, pointerY) {
  return moveHeroInOrder(order, draggedId, heroDropIndex(others, pointerX, pointerY));
}

const FOUR = ['a', 'b', 'c', 'd'];

test('宽屏四列一排：拖到最右边就落到最后一格', () => {
  const others = layout(['b', 'c', 'd'], { columns: 3 });
  assert.equal(heroLayoutIsHorizontal(others), true, '一排三列应判成横排');
  const last = others[2];
  assert.deepEqual(drag(FOUR, 'a', others, last.left + last.width - 5, last.top + 20), ['b', 'c', 'd', 'a']);
});

test('宽屏四列一排：拖回最左边仍是第一格', () => {
  const others = layout(['b', 'c', 'd'], { columns: 3 });
  const first = others[0];
  assert.deepEqual(drag(FOUR, 'a', others, first.left + 5, first.top + 20), ['a', 'b', 'c', 'd']);
});

test('拖到某个框的左半边插到它前面，右半边插到它后面', () => {
  const others = layout(['b', 'c', 'd'], { columns: 3 });
  const middle = others[1]; // c
  assert.deepEqual(drag(FOUR, 'a', others, middle.left + 10, middle.top + 20), ['b', 'a', 'c', 'd']);
  assert.deepEqual(drag(FOUR, 'a', others, middle.left + middle.width - 10, middle.top + 20), ['b', 'c', 'a', 'd']);
});

test('从后往前拖：d 拖到 b 的右半边就落在 b、c 之间', () => {
  const others = layout(['a', 'b', 'c'], { columns: 3 });
  const b = others[1];
  assert.deepEqual(drag(FOUR, 'd', others, b.left + b.width - 10, b.top + 20), ['a', 'b', 'd', 'c']);
});

test('手机单列：改成按上下判断，往上拖插到前面、往下拖插到后面', () => {
  const others = layout(['b', 'c', 'd'], { columns: 1 });
  assert.equal(heroLayoutIsHorizontal(others), false, '单列应判成竖排');
  const c = others[1];
  assert.deepEqual(drag(FOUR, 'a', others, 10, c.top + 20), ['b', 'a', 'c', 'd'], '落在 c 上半 → 插到 c 前');
  assert.deepEqual(drag(FOUR, 'a', others, 10, c.top + c.height - 20), ['b', 'c', 'a', 'd'], '落在 c 下半 → 插到 c 后');
});

test('两列两排：同一行的两个框按左右判断，拖到第二行仍能排到正确位置', () => {
  const others = layout(['b', 'c', 'd'], { columns: 2 });
  const second = others[2]; // d：第二行左侧
  assert.equal(heroLayoutIsHorizontal(others), true, '前两个框在同一行，按横向判断');
  assert.deepEqual(drag(FOUR, 'a', others, second.left + 10, second.top + 20), ['b', 'c', 'a', 'd']);
  assert.deepEqual(drag(FOUR, 'a', others, second.left + second.width - 10, second.top + 20), ['b', 'c', 'd', 'a']);
});

test('只剩两个英雄时看不出布局方向，按指针偏离更大的那一轴判断', () => {
  const others = layout(['b'], { columns: 1 });
  // 单列、唯一的目标框：纵向拖过一半就换位，没拖过就保持原位。
  assert.deepEqual(drag(['a', 'b'], 'a', others, 160, others[0].top + 600), ['b', 'a']);
  assert.deepEqual(drag(['a', 'b'], 'a', others, 160, others[0].top + 50), ['a', 'b']);
});

test('reorderHeroesByIds 按新顺序取英雄，没提到的补在末尾，不丢记录', () => {
  const heroes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  // 函数在 vm 沙箱里跑，返回值是沙箱那个 realm 的数组；用展开运算符换成当前 realm 的数组再比。
  const ids = ordered => [...reorderHeroesByIds(heroes, ordered)].map(h => h.id);
  assert.deepEqual(ids(['c', 'a', 'b']), ['c', 'a', 'b']);
  // DOM 里少了一个（拖动途中正好被删）：补到末尾，其余仍按新顺序。
  assert.deepEqual(ids(['c', 'a']), ['c', 'a', 'b']);
  // 顺序里的陌生 id 直接忽略。
  assert.deepEqual(ids(['x', 'b', 'a', 'c']), ['b', 'a', 'c']);
  // 不修改传进来的数组。
  assert.deepEqual(heroes.map(h => h.id), ['a', 'b', 'c']);
});

test('moveHeroInOrder 不修改原数组，越界下标夹到合法范围', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveHeroInOrder(order, 'd', 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveHeroInOrder(order, 'a', 99), ['b', 'c', 'd', 'a']);
  assert.deepEqual(moveHeroInOrder(order, 'a', -5), ['a', 'b', 'c', 'd']);
  assert.deepEqual(order, ['a', 'b', 'c', 'd']);
});

test('页面里确实有拖动入口：把手、样式、每次重绘后重新绑定', () => {
  assert.match(heroSource, /hero-heading-tools/, '标题右侧要有一块放把手的容器');
  assert.match(heroSource, /data-hero-drag="\$\{escHtml\(hid\)\}"/, 'renderHeroColumn 应输出拖动把手');
  assert.match(heroSource, /setupHeroDragAndDrop\(\);\n\s*\}/, 'renderHeroContent 重绘后要重新绑定拖动');
  assert.match(heroSource, /\.hero-drag-handle \{/, '缺少把手样式');
  assert.match(heroSource, /touch-action: none/, '触屏从把手拖动时不应滚动页面');
  assert.match(heroSource, /addEventListener\("pointerdown"/, '应监听 pointerdown');
  assert.match(heroSource, /queueSave\(\);\n\s*renderAll\(\);/m, '换位后要保存并重绘');
});
