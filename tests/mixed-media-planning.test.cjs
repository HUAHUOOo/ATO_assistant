'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { create, createC5BattleHeadings } = require('../story/assets/mixed-media/renderer.js');
const { harness, escape } = require('./helpers/mixed-media-dom.cjs');
const { context, text, pngPath, trustedVector, row, resourceRow, mapping, vectorMapping, fingerprint } = require('./helpers/mixed-media-fixtures.cjs');
const apiFor = map => create(map, harness().env);
const reconstruct = plan => plan.tokens.map(token => token.type === 'text' ? token.text : token.original).join('');

test('absent, incompatible and malformed maps leave the exact source untouched', () => {
  for (const map of [undefined, null, false, 1, 'not a map', [], {}, { schema: 2, rows: [row()] }, { schema: 1, rows: {} }]) {
    const plan = apiFor(map).plan(context, text);
    assert.equal(plan.count, 0); assert.equal(reconstruct(plan), text);
  }
  const api = apiFor(mapping());
  for (const ctx of [null, {}, { ...context, schema: 2 }, { ...context, bookId: 'c6' }, { ...context, variant: 'other' }, { ...context, entryKey: 'another-room' }]) {
    assert.equal(api.plan(ctx, text).count, 0);
  }
  assert.equal(api.plan(context, null).source, '');
  assert.equal(api.fingerprint(text), fingerprint(text));
  for (const changes of [{ bookId: ['c1'] }, { variant: ['fan'] }]) {
    assert.equal(api.plan({ ...context, ...changes }, text).count, 0);
  }
  for (const changes of [{ book: ['c1'] }, { variant: ['fan'] }]) {
    assert.equal(apiFor(mapping([row(text, changes)])).plan(context, text).count, 0);
  }
});

test('optional ledgers require their own version and valid kind-specific metadata', () => {
  const resource = resourceRow();
  for (const additions of [
    { resourceRows: [resource] }, { resourceSchema: 2, resourceRows: [resource] },
    { resourceSchema: 1, resourceRows: [{ ...resource, layout: 'block' }] },
    { resourceSchema: 1, resourceRows: [{ ...resource, resourceLabel: ' ' }] },
    { requestedSchema: 1, requestedRows: [{ ...row(), kind: 'user-token', semanticLabel: '' }] },
    { battleSchema: 1, battleRows: [{ ...row(), kind: 'unknown', semanticLabel: 'spark' }] },
  ]) assert.equal(apiFor(mapping([], additions)).plan(context, text).count, 0);
  const plan = apiFor(mapping([], { resourceSchema: 1, resourceRows: [resource] })).plan(context, text);
  assert.equal(plan.count, 1); assert.equal(plan.resourceCount, 1);
  for (const changes of [
    { anchor: '' }, { position: 'around' }, { replaceText: '' }, { anchorOccurrence: 0 },
    { anchorCount: 0 }, { textLength: -1 }, { textFingerprint: 'invalid' }, { contextBefore: null }, { layout: 'grid' },
  ]) assert.equal(apiFor(mapping([row(text, changes)])).plan(context, text).count, 0);
});

test('source, fingerprint, occurrence and context mismatches fail the whole entry closed', () => {
  for (const changes of [
    { textLength: text.length + 1 }, { textFingerprint: '00000000' }, { anchor: 'absent', anchorCount: 1 },
    { anchorCount: 2 }, { contextBefore: 'wrong' }, { contextAfter: 'wrong' },
    { replaceText: 'missing' },
  ]) {
    const plan = apiFor(mapping([row(), row(text, changes)])).plan(context, text);
    assert.equal(plan.count, 0, JSON.stringify(changes));
    assert.deepEqual(plan.issues, ['anchor-or-source-mismatch']);
    assert.equal(reconstruct(plan), text);
  }
  const repeated = 'Token xx then xx.';
  const repeatedRow = row(repeated, { anchor: 'xx then xx', replaceText: 'xx' });
  assert.equal(apiFor(mapping([repeatedRow])).plan(context, repeated).count, 0);
  const second = row(repeated, { anchor: 'xx', anchorOccurrence: 2 });
  const plan = apiFor(mapping([second])).plan(context, repeated);
  assert.equal(plan.count, 1); assert.equal(plan.tokens.find(token => token.type === 'image').start, repeated.lastIndexOf('xx'));
});

test('overlaps and duplicate insertions fail closed; before/after anchors remain intact', () => {
  for (const rows of [
    [row(), row()],
    [row(), row(text, { anchor: 'key [spark] waits', replaceText: 'key [spark]' })],
    [row(text, { position: 'after' }), row(text, { position: 'after' })],
  ]) {
    const plan = apiFor(mapping(rows)).plan(context, text);
    assert.equal(plan.count, 0); assert.deepEqual(plan.issues, ['overlapping-mappings']); assert.equal(reconstruct(plan), text);
  }
  for (const position of ['before', 'after']) {
    const plan = apiFor(mapping([row(text, { position })])).plan(context, text);
    const image = plan.tokens.find(token => token.type === 'image');
    assert.equal(plan.count, 1); assert.equal(image.start, image.end); assert.equal(image.original, ''); assert.equal(reconstruct(plan), text);
  }
});

test('retained semantic names and resource exclusions are enforced before rendering', () => {
  const source = 'Carry spark home.';
  const named = resourceRow(source, { anchor: 'spark', position: 'after', textAlreadyNamesResource: true, retainedNameText: 'spark', retainedNameStart: 6, retainedNameEnd: 11 });
  const map = mapping([], { resourceSchema: 1, resourceRows: [named] });
  assert.equal(apiFor(map).plan(context, source).count, 1);
  const conflict = apiFor({ ...map, rows: [row(source, { anchor: 'spark' })] }).plan(context, source);
  assert.equal(conflict.count, 0); assert.deepEqual(conflict.issues, ['retained-name-overlap']);
  const badName = apiFor({ ...map, resourceRows: [{ ...named, retainedNameStart: 0 }] }).plan(context, source);
  assert.deepEqual(badName.issues, ['anchor-or-source-mismatch']);
  for (const exclusion of [{ scope: 'entry' }, { scope: 'range', start: 10, end: 12 }]) {
    const plan = apiFor({ ...map, resourceScopeExclusions: [{ book: 'c1', variant: 'fan', key: context.entryKey, ...exclusion }] }).plan(context, source);
    assert.equal(plan.count, 0); assert.deepEqual(plan.issues, ['resource-out-of-scope']);
  }
});

test('a late compatible map can replace an absent or incompatible map', () => {
  let current;
  const api = apiFor(() => current);
  assert.equal(api.plan(context, text).count, 0);
  current = mapping(); assert.equal(api.plan(context, text).count, 1);
  current = { schema: 2, rows: [row()] }; assert.equal(api.plan(context, text).count, 0);
  current = mapping(); assert.equal(api.plan(context, text).count, 1);
});

test('local paths resolve exactly under nested HTTP and Android file story/second-screen bases', () => {
  for (const base of ['https://example.invalid/nested/app/', 'file:///android_asset/web/']) {
    for (const screen of ['story', 'ss']) {
      const h = harness(); h.env.location.href = `${base}${screen}/index.html?entry=42#section`;
      const api = create(vectorMapping(), h.env);
      assert.equal(api.localURL(pngPath), base + pngPath);
      assert.equal(api.localURL(trustedVector.vectorPath), base + trustedVector.vectorPath);
      assert.equal(api.plan(context, text).tokens.find(token => token.type === 'image').vectorURL, base + trustedVector.vectorPath);
    }
  }
});

test('path admission rejects traversal, remote URLs, suffixes and all surrounding whitespace', () => {
  const api = apiFor(mapping());
  const bad = [
    'https://example.invalid/remote.png', '//example.invalid/remote.png', 'data:image/png,x', 'javascript:alert(1)',
    '/' + pngPath, pngPath.replace('images/c1/', 'images/c1/../c1/'), pngPath.replace('images/c1/', 'images/c1/%2e%2e/c1/'),
    pngPath.replaceAll('/', '\\'), pngPath + '?query=1', pngPath + '#fragment', pngPath + '/extra',
    pngPath.replace('.png', '.PNG'), pngPath.replace('/c1/', '/c6/'), pngPath.replace('/c1/', '//c1/'),
    'assets/icons/unregistered.svg', 'assets/icons/../unregistered.svg',
  ];
  for (const whitespace of [' ', '\t', '\r', '\n', '\r\n', '\u2028', '\u2029', '\u0000']) {
    for (const path of [pngPath, trustedVector.vectorPath]) bad.push(whitespace + path, path + whitespace);
  }
  for (const path of bad) {
    assert.equal(api.localURL(path), null, JSON.stringify(path));
    assert.equal(apiFor(mapping([row(text, { path })])).plan(context, text).count, 0, JSON.stringify(path));
  }
});

test('SVG metadata requires an exact trusted tuple and duplicates disable the optional vector', () => {
  const accepted = apiFor(vectorMapping()).plan(context, text).tokens.find(token => token.type === 'image');
  assert.ok(accepted.vectorURL); assert.deepEqual(accepted.vectorBox, [72, 72]);
  for (const changes of [
    { vectorPath: 'assets/icons/unregistered.svg' }, { width: 73 }, { height: 0 },
    { sourcePngSha256: 'a'.repeat(64) }, { svgSha256: 'b'.repeat(64) },
  ]) {
    const plan = apiFor(vectorMapping({ vectorAssets: [{ ...trustedVector, ...changes }] })).plan(context, text);
    assert.equal(plan.count, 1); assert.equal(plan.tokens.find(token => token.type === 'image').vectorURL, null);
  }
  for (const changes of [{ vectorSchema: 2 }, { vectorAssets: [trustedVector, { ...trustedVector }] }]) {
    const plan = apiFor(vectorMapping(changes)).plan(context, text);
    assert.equal(plan.count, 1); assert.equal(plan.tokens.find(token => token.type === 'image').vectorURL, null);
  }
});

test('renderHTML escapes text and calls the formatter once with the whole original source', () => {
  const source = '<script>example</script> [spark] & "quoted"';
  const api = apiFor(mapping([row(source)]));
  const plain = api.renderHTML(context, source);
  assert.ok(plain.html.includes('&lt;script&gt;example&lt;/script&gt;')); assert.ok(!plain.html.includes('<img'));
  const calls = [];
  const formatted = api.renderHTML(context, source, value => { calls.push(value); return `<p>${escape(value)}</p>`; });
  assert.deepEqual(calls, [source]); assert.equal(formatted.regions.length, 1); assert.equal(formatted.regions[0].text, source);
  assert.equal(reconstruct(formatted), source);
});

test('section rendering associates only single-block placements and preserves source ranges', () => {
  const source = '  First [spark].\n\nSecond room.  ';
  const api = apiFor(mapping([row(source)])), section = api.sectionRenderer(context, source);
  assert.deepEqual(section.blocks, ['First [spark].', 'Second room.']);
  assert.equal(section.hasImages(0), true); assert.equal(section.hasImages(1), false);
  section.ranges.forEach((range, index) => assert.equal(source.slice(range.start, range.end), section.blocks[index]));
  assert.ok(section.renderBlock(0).includes('data-ato-mm-source')); assert.equal(section.renderBlock(1), 'Second room.');
  const spanning = row(source, { anchor: '[spark].\n\nSecond', replaceText: '[spark].\n\nSecond' });
  const rejected = apiFor(mapping([spanning])).sectionRenderer(context, source);
  assert.equal(rejected.result.count, 0); assert.deepEqual(rejected.result.issues, ['section-boundary-mismatch']);
});

test('generic headings remain inactive and leave existing native markup untouched', () => {
  const h = harness(), headings = createC5BattleHeadings(h.env);
  const source = 'Battle: Paper Kite\nSetup:\nPlace two counters.';
  const html = `<h2>Battle: Paper Kite</h2><p>Setup:</p><p>Place two counters.</p>`;
  h.container.innerHTML = html;
  const before = h.container.innerHTML, title = h.container.firstChild;
  for (const ctx of [null, context, { ...context, bookId: 'c5' }, { ...context, bookId: 'c5', variant: 'official' }]) {
    assert.deepEqual(headings.plan(ctx, source), []);
    assert.equal(headings.enhanceHTML(h.container, ctx, source), 0);
    assert.equal(headings.formatHTML(ctx, source, html), html);
  }
  assert.equal(h.container.innerHTML, before); assert.equal(h.container.firstChild, title);
});
