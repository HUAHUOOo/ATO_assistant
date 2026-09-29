/*
 * 英雄记录表「窄英雄框」布局回归。
 *
 * 四个英雄并排时每个英雄框只有 ~272px 宽（1201px 窗口），身份区里还要放下 64px 头像，
 * 三幅节那一行就只剩 ~175px。原来的写法是：
 *   .hero-column .skill-number { grid-template-columns: 22px 30px 22px; }  // 固定 78px
 * 三组「− 数值 +」和重置按钮加起来 272px，格子只有 175px，于是相邻两组互相压住、
 * 第三组还压到重置按钮上（截图见 release 说明）。技能卡更惨：名字被挤成一列一个字，
 * 还盖在加减按钮上。
 *
 * 这里钉住修法本身——凡是「固定宽度、放不下就往外压」的写法都不许回来：
 *   - 三幅节的每组按钮列写成 minmax(0, 24px)：放得下就是 24px，放不下就继续缩；
 *   - 身份区允许换行：三幅节行放不下时整行挪到头像下面，占满整个英雄框；
 *   - 技能名放不下时截断显示省略号，不换行、不压按钮；
 *   - 技能栅格用 auto-fit，宽度不够就一行一张卡。
 * 真机验证（无头 Chrome，430–1920px 共 10 个宽度）见 tmp/hero-drag-check/measure-triskelion.cjs。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const heroSource = fs.readFileSync(path.join(root, 'hero/index.html'), 'utf8').replace(/\r\n/g, '\n');

// 取出某条 CSS 规则的声明体（选择器必须写在行首，取到第一个右花括号为止）。
function ruleBody(selector) {
  const pattern = new RegExp('^\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  const match = heroSource.match(pattern);
  assert.ok(match, `hero/index.html 缺少 CSS 规则 ${selector}`);
  return match[1];
}

test('三幅节每一组的加减按钮列可以收缩，不再是写死的 22+30+22', () => {
  const group = ruleBody('.hero-column .triskelion-item .skill-number');
  assert.match(group, /minmax\(\s*0\s*,\s*24px\s*\)/, '按钮列要写成 minmax(0, 24px)：够宽时 24px，不够时继续缩');
  assert.doesNotMatch(group, /22px\s+30px\s+22px/, '不能再写死 78px 宽——正是它把相邻两组挤到重叠');
  assert.match(ruleBody('.hero-column .triskelion-item .skill-number button'), /min-width:\s*0/, '按钮的 min-width 必须是 0，否则撑住不缩');
  assert.match(ruleBody('.hero-column .triskelion-item .skill-value'), /min-width:\s*0/, '数值列也要能缩');
});

test('身份区放不下时三幅节整行挪到头像下面，占满整个英雄框', () => {
  const identity = ruleBody('.hero-column .identity-grid');
  assert.match(identity, /display:\s*flex/, '身份区要用 flex 才能按宽度换行');
  assert.match(identity, /flex-wrap:\s*wrap/, '缺少 flex-wrap: wrap 就永远不会换行');
  const row = ruleBody('.hero-column .identity-grid .triskelion-row');
  assert.match(row, /flex:\s*1 1 \d+px/, '三幅节行要有 flex-basis，窄到放不下就整行换到下一行');
  assert.match(row, /min-width:\s*0/, '窄到极限时还得能继续缩，不能把英雄框撑破');
});

test('技能卡在窄英雄框里也不重叠：名字截断、栅格自动减列', () => {
  assert.match(ruleBody('.hero-column .skill-grid'), /repeat\(\s*auto-fit\s*,\s*minmax\(/, '技能栅格用 auto-fit，宽度不够自己减列');
  assert.match(ruleBody('.hero-column .skill-name'), /flex:\s*1 1 auto/, '技能名要占据剩余空间');
  const nameText = heroSource.match(/\.hero-column \.skill-card \.skill-name-zh,\s*\n\s*\.hero-column \.skill-card \.skill-name-en \{([^}]*)\}/);
  assert.ok(nameText, '缺少技能名截断规则');
  assert.match(nameText[1], /white-space:\s*nowrap/, '名字不能换行——以前会被挤成一列一个字');
  assert.match(nameText[1], /text-overflow:\s*ellipsis/, '放不下要显示省略号，而不是压到加减按钮上');
  assert.match(nameText[1], /overflow:\s*hidden/, '要裁剪，不能让文字溢出去');
});
