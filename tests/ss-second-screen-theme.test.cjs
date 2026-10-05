/* 第二屏主题同步回归测试（run: node tests/ss-second-screen-theme.test.cjs）。
 *
 * 第二屏通常在另一台设备上（手机/电视），那边读不到主控台浏览器的 localStorage
 * （assets/theme.js 的 ato-theme-v1），所以外观只能走服务端：
 *   - 主控台改主题 → POST ?action=second-screen-status 带 theme；
 *   - 服务端存进第二屏条目，public_second_screen_payload() 每次轮询带回来；
 *   - ss/app.js 的 applySecondScreenTheme() 应用它，顺带把战役的活动循环写到
 *     body[data-cycle]（auto 模式靠它取色，否则 theme.js 一直退回默认 c1）。
 * 这里跑 ss/app.js 里的真实函数，并按源码核对两端的接线。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SS_SOURCE = fs.readFileSync(path.join(ROOT, 'ss', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const PHP_SOURCE = fs.readFileSync(path.join(ROOT, 'api', 'campaign-state.php'), 'utf8').replace(/\r\n/g, '\n');
const CONSOLE_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

function slice(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `找不到函数 ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function themeScope({ themeApi = true } = {}) {
  const applied = [];
  const body = { dataset: {}, style: {} };
  const window = {};
  if (themeApi) window.ATO_THEME = { set: (value) => applied.push(value), get: () => ({ mode: 'auto', rgb: [127, 75, 38] }) };
  const scope = vm.createContext({ document: { body }, window, JSON });
  vm.runInContext('let appliedThemeKey = "";', scope);
  vm.runInContext(slice(SS_SOURCE, 'applySecondScreenTheme'), scope);
  scope.apply = (screen) => vm.runInContext(`applySecondScreenTheme(${JSON.stringify(screen)})`, scope);
  // vm 上下文里造出来的对象原型不同，比较前先过一遍 JSON。
  scope.appliedJson = () => JSON.parse(JSON.stringify(applied));
  return { scope, body, applied, appliedJson: scope.appliedJson };
}

test('快照里的 theme 会应用到第二屏，并跟着战役循环取色', () => {
  const page = themeScope();
  page.scope.apply({ cycleId: 'c4', theme: { mode: 'custom', rgb: [200, 30, 30] } });
  assert.equal(page.body.dataset.cycle, 'c4');
  assert.deepEqual(page.appliedJson(), [{ mode: 'custom', rgb: [200, 30, 30] }]);

  page.scope.apply({ cycleId: 'c5', theme: { mode: 'auto', rgb: [127, 75, 38] } });
  assert.equal(page.body.dataset.cycle, 'c5');
  assert.equal(page.applied.length, 2);
  assert.deepEqual(page.appliedJson()[1], { mode: 'auto', rgb: [127, 75, 38] });
});

test('轮询拿到的还是同一份主题时不重复应用（1.5 秒一次不能每次都重写）', () => {
  const page = themeScope();
  const screen = { cycleId: 'c2', theme: { mode: 'c3', rgb: [127, 75, 38] } };
  page.scope.apply(screen);
  page.scope.apply({ ...screen });
  page.scope.apply({ ...screen, day: 7 });
  assert.equal(page.applied.length, 1);
  page.scope.apply({ cycleId: 'c2', theme: { mode: 'c3', rgb: [10, 20, 30] } });
  assert.equal(page.applied.length, 2, '主题变了要重新应用');
});

test('旧快照（没有 theme 字段）只同步循环，不该清掉设备上的选择', () => {
  const page = themeScope();
  page.scope.apply({ cycleId: 'c1' });
  assert.equal(page.body.dataset.cycle, 'c1');
  assert.deepEqual(page.applied, []);
});

test('没有 theme.js（老页面/被裁掉的资源）时不报错', () => {
  const page = themeScope({ themeApi: false });
  page.scope.apply({ cycleId: 'c3', theme: { mode: 'custom', rgb: [1, 2, 3] } });
  assert.equal(page.body.dataset.cycle, 'c3');
});

test('第一次轮询赶在 theme.js 前头时，下一次轮询要接着应用', () => {
  const page = themeScope({ themeApi: false });
  const screen = { cycleId: 'c2', theme: { mode: 'custom', rgb: [9, 9, 9] } };
  page.scope.apply(screen);
  assert.equal(page.applied.length, 0);
  // theme.js 是 defer 的：它跑起来以后，下一次轮询不能再被「已应用」挡住。
  page.scope.window.ATO_THEME = { set: (value) => page.applied.push(value) };
  page.scope.apply(screen);
  assert.equal(page.applied.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(page.applied[0])), { mode: 'custom', rgb: [9, 9, 9] });
  page.scope.apply(screen);
  assert.equal(page.applied.length, 1, '应用过以后就不再重复');
});

test('轮询里确实接上了主题应用，且循环只在变化时才写 body', () => {
  assert.match(SS_SOURCE, /applySecondScreenTheme\(payload\.screen\)/);
  assert.match(slice(SS_SOURCE, 'applySecondScreenTheme'), /document\.body\.dataset\.cycle !== cycleId/);
});

test('服务端：主题存在第二屏条目里，并随轮询返回', () => {
  assert.match(PHP_SOURCE, /function normalize_theme_setting\(\$value\): array/);
  assert.match(PHP_SOURCE, /'theme' => second_screen_theme\(\$screenEntry\)/);
  assert.match(PHP_SOURCE, /if \(array_key_exists\('theme', \$payload\)\) \{\s*\$theme = normalize_theme_setting\(\$payload\['theme'\]\);/);
  // 局部更新（改显示大小、转版图）没带 theme 时不能把已存的清掉。
  const branch = PHP_SOURCE.slice(PHP_SOURCE.indexOf("if ($action === 'second-screen-status')"));
  assert.match(branch, /\$theme = second_screen_theme\(\$entry\);/);
  assert.match(branch, /\$store\['screens'\]\[\$userToken\]\['theme'\] = \$theme;/);
  // 坏模式值退回 auto，颜色夹在 0-255。
  assert.match(PHP_SOURCE, /\$modes = \['auto', 'c1', 'c2', 'c3', 'c4', 'c5', 'custom'\]/);
  assert.match(PHP_SOURCE, /max\(0, min\(255, \(int\) round\(\(float\) \$channel\)\)\)/);
});

test('主控台：改主题、开第二屏、读状态时都会把外观带过去', () => {
  assert.match(CONSOLE_HTML, /window\.addEventListener\("ato-theme-changed", \(\) => pushSecondScreenTheme\(\)\)/);
  assert.match(CONSOLE_HTML, /body: JSON\.stringify\(\{ enabled: true, theme \}\)/);
  assert.match(CONSOLE_HTML, /const theme = enabled \? currentThemeSetting\(\) : null;/);
  assert.match(CONSOLE_HTML, /window\.ATO_THEME\?\.get\?\.\(\)/);
});
