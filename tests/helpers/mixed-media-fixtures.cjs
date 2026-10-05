'use strict';

const assert = require('node:assert/strict');
const { create } = require('../../story/assets/mixed-media/renderer.js');
const { harness } = require('./mixed-media-dom.cjs');

// All prose, entry keys, placements and labels below are invented. No material
// ledger, game paragraphs, image bytes or installed asset packs are needed.
const context = Object.freeze({ schema: 1, bookId: 'c1', variant: 'fan', entryKey: 'synthetic-room' });
const text = 'A copper key [spark] waits.\nTurn to room 42.';
const pngPath = 'story/assets/mixed-media/images/c1/synthetic-spark.png';
// This one explicit renderer allowlist tuple is used only to admit an optional
// SVG representation. It authenticates metadata, not asset bytes in this test.
const trustedVector = Object.freeze({
  path: 'story/assets/mixed-media/images/c1/icon-fate.png',
  vectorPath: 'assets/icons/ato-apk-fate.svg',
  width: 72,
  height: 72,
  sourcePngSha256: 'd51c4598439d7bcc3b631bba7bf825ce997dabd09d5bf93acf3949cce7c09c3b',
  svgSha256: '9b2587dd1485546c9b79138d76567ef19dceb9b40c2e50b788c173a7fc1d799b',
});

function fingerprint(source) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
function row(source = text, changes = {}) {
  const anchor = changes.anchor ?? '[spark]', position = changes.position ?? 'replace';
  const replacement = changes.replaceText ?? anchor;
  const occurrence = changes.anchorOccurrence ?? 1;
  let found = -1;
  for (let index = 0; index < occurrence; index++) found = source.indexOf(anchor, found + 1);
  const start = found + (position === 'after' ? anchor.length : position === 'replace' ? anchor.indexOf(replacement) : 0);
  const end = start + (position === 'replace' ? replacement.length : 0);
  return {
    book: context.bookId, variant: context.variant, key: context.entryKey,
    kind: 'narrative', path: pngPath, anchor, anchorOccurrence: occurrence,
    anchorCount: source.split(anchor).length - 1, position, replaceText: replacement,
    contextBefore: source.slice(Math.max(0, start - 8), start), contextAfter: source.slice(end, end + 8),
    textLength: source.length, textFingerprint: fingerprint(source), layout: 'inline', alt: 'Invented spark',
    ...changes,
  };
}
function resourceRow(source = text, changes = {}) {
  return row(source, { kind: 'resource-icon', resourceLabel: 'spark', ...changes });
}
function mapping(rows = [row()], additions = {}) { return { schema: 1, rows, ...additions }; }
function vectorMapping(changes = {}) {
  return mapping([], {
    resourceSchema: 1, resourceRows: [resourceRow(text, { path: trustedVector.path })],
    vectorSchema: 1, vectorAssets: [{ ...trustedVector }], ...changes,
  });
}
function start(map = mapping(), source = text, ctx = context) {
  const h = harness(), api = create(map, h.env);
  const result = api.renderInto(h.container, ctx, source);
  return { ...h, api, result, source, ctx };
}
async function tick() { for (let index = 0; index < 4; index++) await Promise.resolve(); }
function beginDecode(image) {
  image.naturalWidth = 72; image.naturalHeight = 72; image.complete = true;
  image.dispatch('load');
}
async function ready(h, image = h.document.imageRequests.at(-1)) {
  beginDecode(image); image.decodeResolve?.(); await tick(); h.frames(); return image;
}
function copy(h, node = h.container) {
  const range = h.document.createRange(); range.selectNodeContents(node);
  h.env.selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => range };
  let value;
  const event = h.container.dispatch('copy', { clipboardData: { setData(type, copied) { assert.equal(type, 'text/plain'); value = copied; } } });
  return { value, prevented: Boolean(event.defaultPrevented) };
}
function assertPlain(h, source = h.source) {
  assert.equal(h.container.textContent, source);
  assert.equal(h.container.querySelectorAll('.ato-mm-item').length, 0);
  assert.equal(h.container.classList.contains('ato-mm-active'), false);
  assert.equal(h.api.speechText(h.ctx, source, h.container), source);
}
function cleanup(h) {
  h.api.dispose(h.container);
  assert.equal(h.timers.size, 0, 'dispose releases timers');
  assert.equal(h.raf.size, 0, 'dispose releases animation frames');
  assert.equal(h.document.body.style.overflow, 'auto');
  assert.equal(h.container.listeners.copy?.length || 0, 0);
  assert.equal(h.container.listeners.click?.length || 0, 0);
}

module.exports = { context, text, pngPath, trustedVector, fingerprint, row, resourceRow, mapping, vectorMapping, start, tick, beginDecode, ready, copy, assertPlain, cleanup };
