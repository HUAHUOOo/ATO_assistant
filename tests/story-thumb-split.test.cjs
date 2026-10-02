const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const modulePath = pathToFileURL(path.join(__dirname, '../tools/apply-bgstorybook-books.mjs')).href;

test('来源页把拇指段落并进上一段时，重建数据要把它切出来', async () => {
  const { splitThumbSections } = await import(modulePath);
  const carrier = {
    id: '1354',
    title: '1354',
    text: ['塔倒下了。', '(拇指) 1355 盐海珍珠 (Pearls of the sea of salt)', '这一片荒地曾经是海洋的一部分。'].join('\n'),
  };

  const parts = splitThumbSections(carrier);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].id, '1354');
  assert.equal(parts[0].text, '塔倒下了。');
  assert.equal(parts[1].id, '1355');
  assert.equal(parts[1].title, '1355');
  assert.match(parts[1].text, /^\(拇指\) 1355 盐海珍珠/);
  assert.match(parts[1].text, /这一片荒地曾经是海洋的一部分。/);
  assert.doesNotMatch(parts[0].text, /拇指/);
});

test('半角标记、没有标题的编号同样切成新段', async () => {
  const { splitThumbSections } = await import(modulePath);
  const parts = splitThumbSections({ id: '1358', title: '1358', text: '前一段。\n(拇指)1359\n有一个非常具体的方法。' });
  assert.deepEqual(parts.map((part) => part.id), ['1358', '1359']);
  assert.match(parts[1].text, /^\(拇指\)1359/);
});

test('标记后面不是编号、或标记已在段首时不动正文', async () => {
  const { splitThumbSections } = await import(modulePath);
  const prose = { id: '0001', title: '0001', text: '他竖起拇指。\n（拇指）这不是编号行。' };
  assert.deepEqual(splitThumbSections(prose), [prose]);
  const alreadySplit = { id: '1355', title: '1355', text: '(拇指) 1355 盐海珍珠 (Pearls of the sea of salt)\n正文。' };
  assert.deepEqual(splitThumbSections(alreadySplit), [alreadySplit]);
});

test('重建故事书时切出来的段落按位置拿新键，编号仍是自己的编号', async () => {
  const { toLocalBook } = await import(modulePath);
  const book = toLocalBook({
    id: 'c4',
    title: '测试故事书',
    source: 'fixture',
    chapters: [{
      key: 'main',
      title: '主线故事',
      entries: [
        { id: '1353', title: '1353', text: '前一段。' },
        { id: '1354', title: '1354', text: '塔倒下了。\n(拇指) 1355 盐海珍珠 (Pearls of the sea of salt)\n发现珍珠。' },
        { id: '1356', title: '1356', text: '后一段。' },
      ],
    }],
  });

  assert.deepEqual(book.entries.map((entry) => entry.id), ['1353', '1354', '1355', '1356']);
  assert.deepEqual(book.entries.map((entry) => entry.key), ['c4-0-0', 'c4-0-1', 'c4-0-2', 'c4-0-3']);
  assert.deepEqual(book.entries.map((entry) => entry.order), [0, 1, 2, 3]);
  assert.deepEqual(book.entries.map((entry) => entry.line), [1, 2, 3, 4]);
  assert.equal(book.entries[2].entryType, 'number');
  assert.equal(book.entryCount, 4);
  assert.match(book.entries[2].text, /^\(拇指\) 1355/);
});
