/* Inline icons are SVG now: paper-white removed, scalable with the text.
 *
 * The converter turns every inline icon into an .svg file (the paper background becomes
 * alpha). Ink glyphs are traced into vector paths; tile/component/user artwork keeps its
 * pixels inside the SVG. Block artwork (diagrams, photos, banners) stays PNG. These
 * tests freeze that split and the renderer's acceptance of both extensions.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { create } = require('../assets/mixed-media/renderer.js');
const root = path.resolve(__dirname, '../..');
const files = ['story/data/storybook-data.js', 'story/data/storybook-official-data.js',
  'story/assets/mixed-media/mapping.js'];
const local = files.every(file => fs.existsSync(path.join(root, file)));
const parse = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')
  .split('=').slice(1).join('=').trim().replace(/;\s*$/, ''));
const [fan, official, mapping] = local ? files.map(parse) : [null, null, null];
const ledgers = ['rows', 'resourceRows', 'battleRows', 'requestedRows'];
const rows = () => ledgers.flatMap(name => mapping[name] || []);

/* 20261005-apk-icons1: 10 个图标换成 APK 母版后自带白色"墨层"。
 *
 * 这些母版直接取原 APK 资源的分层描摹：山羊 / 笨重 / 火焰 / 作战行动用 preserve 调色板
 * （黑底 + 白的图案本体），反应 / 移动行动用 invert（白的高光细节），借机时段用 color。
 * 白是图案的一部分（山羊的白脸、拳头的白高光、菱形里的白色感叹号），不是纸白底板——
 * 底色仍是 alpha 透明（对照图见 tmp/patch-compare/preview/white-fill-check.png）。
 * 其余 265 个行内 SVG 依旧不允许出现任何纯白填充，这条守卫保持原样。
 */
const WHITE_INK_ALLOWED = new Set([
  'story/assets/mixed-media/images/c1/icon-goat.svg',
  'story/assets/mixed-media/images/c3/icon-goat.svg',
  'story/assets/mixed-media/images/c4/icon-goat.svg',
  'story/assets/mixed-media/images/c2/icon-c2-escalation.svg',
  'story/assets/mixed-media/images/c1/icon-flame.svg',
  'story/assets/mixed-media/images/c2/icon-c2-combat-action.svg',
  'story/assets/mixed-media/images/c3/icon-opportunity.svg',
  'story/assets/mixed-media/images/c5/icon-reaction.svg',
  'story/assets/mixed-media/images/c5/icon-move-action.svg',
  'story/assets/mixed-media/images/c5/icon-move-action-barefoot.svg',
]);

test('every inline icon is an SVG with a viewBox, every block image stays PNG', { skip: !local }, () => {
  const inline = rows().filter(r => r.layout === 'inline');
  const block = rows().filter(r => r.layout !== 'inline');
  assert.ok(inline.length > 8000, `unexpected inline row count ${inline.length}`);
  const seen = new Set();
  for (const row of inline) {
    assert.match(row.path, /\.svg$/, row.path);
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    const file = path.join(root, row.path);
    assert.ok(fs.existsSync(file), `${row.path} missing`);
    const svg = fs.readFileSync(file, 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+"/, row.path);
    assert.ok(/<(path|image) /.test(svg), `${row.path} has no artwork`);
    assert.ok(WHITE_INK_ALLOWED.has(row.path) || (!/fill="#ffffff"/i.test(svg) && !/fill="white"/i.test(svg)),
      `${row.path} still paints paper white`);
  }
  for (const row of block) assert.match(row.path, /\.png$/, row.path);
  assert.equal(seen.size, 275, 'inline icon file count changed');
});

test('the declared icon size matches the SVG viewBox', { skip: !local }, () => {
  const seen = new Set();
  for (const row of rows().filter(r => r.layout === 'inline')) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    const svg = fs.readFileSync(path.join(root, row.path), 'utf8');
    const view = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    const width = /width="([\d.]+)"/.exec(svg);
    const height = /height="([\d.]+)"/.exec(svg);
    assert.ok(view && width && height, row.path);
    // intrinsic size must exist, otherwise the renderer drops the image after load
    assert.ok(Number(width[1]) > 0 && Number(height[1]) > 0, row.path);
    assert.equal(Number(width[1]), Number(view[1]), row.path);
    assert.equal(Number(height[1]), Number(view[2]), row.path);
  }
});

test('inline icons paint no background of their own', () => {
  const css = fs.readFileSync(path.join(root, 'story/assets/mixed-media/styles.css'), 'utf8');
  // block scans keep their paper frame ...
  assert.match(css, /\.ato-mm-button\s*\{[^}]*background:\s*#f8f2e6/s);
  // ... but an inline icon must sit straight on the page surface
  assert.match(css, /\.ato-mm-inline \.ato-mm-button,\s*\.ato-mm-resource \.ato-mm-button\s*\{\s*background:\s*transparent;\s*\}/);
  // both screens must load the stylesheet through a cache-busting parameter
  for (const file of ['story/index.html', 'ss/index.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /mixed-media\/styles\.css\?v=[\w.-]+/, file);
  }
});

test('the renderer accepts .svg icons and still rejects other extensions', () => {
  const text = '获得 +2［进展］。';
  const api = create(undefined, { location: { href: 'https://qa.invalid/story/index.html' } });
  const row = (file) => ({
    book: 'c4', key: 'test', variant: 'fan', kind: 'resource-icon', resourceLabel: '进展',
    path: `story/assets/mixed-media/images/c4/${file}`, layout: 'inline', position: 'replace',
    replaceText: '［进展］', anchor: '［进展］', anchorOccurrence: 1, anchorCount: 1,
    contextBefore: '获得 +2', contextAfter: '。', textLength: text.length,
    textFingerprint: api.fingerprint(text), width: 40, height: 40,
  });
  const map = (file) => ({ schema: 1, resourceSchema: 1, resourceRows: [row(file)] });
  for (const file of ['icon-progress.svg', 'icon-progress.png']) {
    const result = create(map(file), { location: { href: 'https://qa.invalid/story/index.html' } })
      .plan({ schema: 1, bookId: 'c4', entryKey: 'test', variant: 'fan' }, text);
    assert.deepEqual(result.issues, [], file);
    assert.equal(result.count, 1, file);
  }
  for (const file of ['icon-progress.jpg', 'icon-progress.svg.exe', '../icon-progress.svg']) {
    const result = create(map(file), { location: { href: 'https://qa.invalid/story/index.html' } })
      .plan({ schema: 1, bookId: 'c4', entryKey: 'test', variant: 'fan' }, text);
    assert.equal(result.count, 0, file);
  }
});
