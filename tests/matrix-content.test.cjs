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
