'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const record = read('record/index.html');
const viewer = read('tools/matrix.html');
const embedded = id => JSON.parse(viewer.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)</script>`))[1]);
const summaries = { window: {} };
vm.runInNewContext(read('record/matrix-summaries.js'), summaries);

test('记录表和矩阵检索页的总结及来源一致，所有格号合法', () => {
  const prose = JSON.parse(JSON.stringify(summaries.window.MATRIX_SUMMARIES));
  assert.deepEqual(prose, embedded('matrix-summaries-data'));
  const notesSource = record.match(/const choiceMatrixNotes\s*=\s*([\s\S]*?);\s*let matrixClickTimer/)[1];
  const notes = JSON.parse(notesSource.replace(/;+$/, ''));
  assert.deepEqual(notes, embedded('matrix-notes-data'));
  for (const [code, summary] of Object.entries(prose)) {
    assert.match(code, /^(?:[A-Z]|AA|BB|CC|DD|EE|FF)(?:[1-9]|1[0-2])$/);
    assert.ok(summary.trim(), code);
    assert.ok(notes[code]?.length, `missing source annotation: ${code}`);
  }
});

test('没有可解析故事书位置的矩阵格不显示无效跳转入口', () => {
  const begin = record.indexOf('    function allMatrixSourceTargets(');
  const end = record.indexOf('    function pickMatrixTarget(', begin);
  const context = vm.createContext({});
  vm.runInContext(record.slice(begin, end), context);
  const notes = embedded('matrix-notes-data');
  assert.equal(context.allMatrixSourceTargets(notes.A10).length, 0);
  assert.ok(context.allMatrixSourceTargets(notes.A7).length > 0);
  const summary = record.slice(record.indexOf('    function showMatrixSummary('), record.indexOf('    function jumpToMatrixSource('));
  assert.match(summary, /if \(allMatrixSourceTargets\(notes\)\.length\)/);
});

function cellModes(notes) {
  const begin = record.indexOf('    const matrixCellModes = {}');
  const end = record.indexOf('    function matrixDisplayLabel(', begin);
  const context = vm.createContext({ choiceMatrixNotes: notes });
  vm.runInContext(record.slice(begin, end) + '\nthis.modes = matrixCellModes;', context);
  return JSON.parse(JSON.stringify(context.modes));
}

test('X10、BB2、DD1 的来源支持 T/L 菜单，普通格保持普通标记', () => {
  const modes = cellModes(embedded('matrix-notes-data'));
  for (const code of ['X10', 'BB2', 'DD1']) {
    assert.ok(modes[code].includes('T'), `${code}: missing T`);
    assert.ok(modes[code].includes('L'), `${code}: missing L`);
  }
  assert.equal(modes.A1, undefined);
  // BB6 的同一来源段落还标记 BB8 为 L，不能把 BB8 的字母给 BB6。
  assert.deepEqual(modes.BB6, ['circle']);
  // BB9 是「将BB9标记为L，但圈起来」——圈的是本格，存档里就是 circleL。
  assert.ok(modes.BB9.includes('circle'), 'BB9: missing circle');
  // 反过来，0063 那段的圈是 BB6 的，不能因为同一条注记也标记 BB8 就给 BB8 加圈出。
  assert.ok(!modes.BB8.includes('circle'), 'BB8: 圈出来自别的格子');
  // W11 的第三取值是 N（「将W11标为N（N？没错）」），不能只留 T/L。
  assert.ok(modes.W11.includes('N'), 'W11: missing N');
  assert.deepEqual(cellModes({ X10: ['将X10标记改为T'] }).X10, ['T', 'L']);
  assert.deepEqual(cellModes({ DD1: ['标记 DD1。用 T 标记；用 L 标记'] }).DD1, ['T', 'L']);
  assert.deepEqual(cellModes({ X10: ['将X10标注为N'] }).X10, ['N']);
  assert.deepEqual(cellModes({ W11: ['将 W11 标记为 L（另一选项：让花园保持原样、远离凡人，则标记为 N）'] }).W11, ['L', 'N', 'T']);
  assert.deepEqual(
    cellModes({ BB8: ['C5 | 不惜一切代价 (Whatever the Cost) > 0063 line 70: 现在，你站在墙壁永恒的光芒中，沉浸在这一刻 / 圈出抉择矩阵 (Matrix) 代码BB6。将BB8标记为L'] }).BB8,
    ['L', 'T'],
  );
  assert.deepEqual(
    cellModes({ BB9: ['C5 | 血肉之躯的软弱 (THE FLESH IS WEAK) > 0015 line 22: 你们不知道西狄佩还有其他孩子 / 将BB9标记为L，但圈起来'] }).BB9,
    ['L', 'circle', 'T'],
  );
});

const storybookPath = path.join(__dirname, '..', 'story/data/storybook-data.js');

// 正文里的矩阵赋值有几种写法：
//   「将 X10 标记为 T」「将R10标注为T」「将W11标为L」（更正后的译文大量改用「标注为／标为」），
//   以及「标记 BB2：……标记为 T；……标记为 L」这种先点名格号、再逐支给字母的写法。
// 取值除 T／L 外还有 N（W11 的另一支），但记录表菜单只有 T/L/圈出/划掉，所以 N 只校验来源注记。
const MATRIX_CODE = /^(?:[A-Z]|AA|BB|CC|DD|EE|FF)(?:[1-9]|1[0-2])$/;
const MATRIX_MARK = /([A-Z]{1,2}\s*\d{1,2})\s*(?:标记|标注|标)(?:改|作|记)?为\s*([TLN])\b|(?:标记|标注)\s*([A-Z]{1,2}\s*\d{1,2})[^。\n]{0,40}?(?:标记|标注|标)(?:改|作|记)?为\s*([TLN])\b/g;

test('故事书正文中的字母标记均有对应菜单，遗漏格的来源指向可核验', {
  skip: !fs.existsSync(storybookPath) && '本地故事书数据未安装',
}, () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(storybookPath, 'utf8'), context);
  const books = context.window.STORYBOOK_DATA.books;
  const notes = embedded('matrix-notes-data');
  const modes = cellModes(notes);
  let checked = 0;
  for (const book of books) {
    for (const entry of book.entries) {
      for (const match of entry.text.matchAll(MATRIX_MARK)) {
        const code = (match[1] || match[3]).replace(/\s/g, '');
        const letter = match[2] || match[4];
        if (!MATRIX_CODE.test(code)) continue;
        if (letter === 'N') {
          assert.ok(notes[code]?.length, `${book.id}/${entry.chapterKey}/${entry.id}: ${code} 标为 N，但注记里没有这一格`);
        } else {
          assert.ok(modes[code]?.includes(letter), `${book.id}/${entry.chapterKey}/${entry.id}: ${code} ${letter}`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 50, '应核对整本故事书而非仅个别段落');
  for (const [code, chapterKey, entryId, evidence] of [
    ['X10', 'hub-04-the-greater-good', '0001', /将X10标记改为T/],
    ['BB2', 'hub-03-the-one-you-dont', '0072', /标记 BB2[：:][\s\S]*标记为 T[\s\S]*标记为 L/],
    ['T11', 'mnemos-breakthroughs', 'M026', /将T11标注为L/],
    ['DD1', 'main', '0022', /标记 DD1。.*用 T 标记.*用 L 标记/],
  ]) {
    const entry = books.find(book => book.id === 'c5').entries.find(entry => entry.chapterKey === chapterKey && entry.id === entryId);
    assert.ok(entry, code);
    assert.match(entry.text, evidence);
    assert.ok(notes[code].some(note => note.includes(`C5 | ${entry.chapter} > ${entry.id} line ${entry.line}:`)), `${code}: source target`);
  }
});
