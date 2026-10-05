'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../story/assets/mixed-media/renderer.js');
const { harness, escape } = require('./helpers/mixed-media-dom.cjs');
const { context, text, row, resourceRow, mapping, vectorMapping, start, tick, beginDecode, ready, copy, assertPlain, cleanup } = require('./helpers/mixed-media-fixtures.cjs');

// Only this reviewed standalone renderer is executed. Image events and decode
// promises are synthetic; no asset pack or application/server entrypoint runs.
test('pending and failed images preserve exact text, markup, layout and native copy/TTS', async () => {
  for (const position of ['replace', 'before', 'after']) {
    const h = start(mapping([row(text, { position, layout: 'block' })]));
    assertPlain(h); assert.equal(copy(h).prevented, false);
    assert.equal(h.container.classList.contains('ato-mm-layout'), false);
    const pending = h.container.innerHTML;
    h.document.imageRequests[0].dispatch('error'); await tick(); h.frames();
    assertPlain(h); assert.equal(h.container.innerHTML, pending); assert.equal(h.document.imageRequests.length, 1);
    cleanup(h);
  }
});

test('a decoded image commits once on a frame; a late error restores the original source', async () => {
  const h = harness(), updates = [], api = create(mapping([row(text, { layout: 'block' })]), h.env);
  const result = api.renderInto(h.container, context, text, { onChange: update => updates.push(update) });
  Object.assign(h, { api, result, source: text, ctx: context });
  const image = h.document.imageRequests[0], pending = h.container.innerHTML;
  beginDecode(image); image.dispatch('load');
  assert.equal(h.document.decodeCalls.length, 1); assertPlain(h);
  image.decodeResolve(); await tick();
  assertPlain(h); assert.equal(h.raf.size, 1);
  h.frames();
  assert.equal(h.container.querySelector('img'), image); assert.equal(h.document.imageRequests.length, 1);
  assert.equal(image.width, 72); assert.equal(image.height, 72);
  assert.equal(h.container.classList.contains('ato-mm-layout'), true);
  assert.equal(updates.at(-1).readyCount, 1);
  image.dispatch('error');
  assertPlain(h); assert.equal(h.container.innerHTML, pending); assert.equal(updates.at(-1).readyCount, 0);
  cleanup(h);
});

const failures = ['error', 'abort', 'zero-size', 'decode-throw', 'decode-reject', 'timeout', 'timeout-decode', 'decoded-before-frame', 'ready-error'];
for (const failure of failures) {
  test(`SVG ${failure} retries one PNG, ignores stale callbacks, then falls back to source text`, async () => {
    const h = start(vectorMapping()), svg = h.document.imageRequests[0];
    assert.ok(svg.src.endsWith('.svg')); assertPlain(h);
    const staleLoad = svg.listeners.load[0], staleFail = svg.listeners.error[0];
    if (failure === 'zero-size') svg.dispatch('load');
    else if (failure === 'decode-throw') { svg.decode = () => { throw Error('Synthetic decode failure'); }; beginDecode(svg); }
    else if (failure === 'decode-reject') { beginDecode(svg); svg.decodeReject(Error('Synthetic rejection')); await tick(); }
    else if (failure === 'timeout') h.advance(h.api.assetTimeoutMs + 1);
    else if (failure === 'timeout-decode') { beginDecode(svg); h.advance(h.api.assetTimeoutMs + 1); }
    else if (failure === 'decoded-before-frame') { beginDecode(svg); svg.decodeResolve(); await tick(); svg.dispatch('error'); }
    else if (failure === 'ready-error') { await ready(h, svg); svg.dispatch('error'); }
    else svg.dispatch(failure);
    assert.equal(h.document.imageRequests.length, 2);
    const png = h.document.imageRequests[1]; assert.ok(png.src.endsWith('.png')); assertPlain(h);
    await ready(h, png);
    assert.equal(h.container.querySelector('img'), png);
    assert.equal(png.style.objectFit, 'contain'); assert.equal(png.style.height, '1.15em');
    svg.decodeResolve?.(); staleLoad(); staleFail(); await tick(); h.frames();
    assert.equal(h.document.imageRequests.length, 2); assert.equal(h.container.querySelector('img'), png);
    png.dispatch('error'); await tick(); h.frames();
    assertPlain(h); assert.equal(h.document.imageRequests.length, 2);
    cleanup(h);
  });
}

test('PNG decode rejection or timeout restores text without reserving layout space', async () => {
  for (const failure of ['decode-reject', 'timeout']) {
    const h = start(vectorMapping()); h.document.imageRequests[0].dispatch('error');
    const png = h.document.imageRequests[1]; beginDecode(png);
    if (failure === 'decode-reject') png.decodeReject(Error('Synthetic PNG failure'));
    else h.advance(h.api.assetTimeoutMs + 1);
    await tick(); png.decodeResolve?.(); await tick(); h.frames();
    assertPlain(h); assert.equal(h.document.imageRequests.length, 2); cleanup(h);
  }
});

test('missing decode API uses a resolved fallback, while zero dimensions never commit', async () => {
  const h = start(); const image = h.document.imageRequests[0]; image.decode = undefined;
  await ready(h, image); assert.equal(h.container.querySelector('img'), image); cleanup(h);
  const zero = start(); zero.document.imageRequests[0].dispatch('load'); await tick(); zero.frames();
  assertPlain(zero); cleanup(zero);
});

for (const stage of ['loading', 'decoding', 'decoded', 'ready']) {
  test(`navigation/dispose while ${stage} rejects late load, error and decode events`, async () => {
    const h = start(vectorMapping()), image = h.document.imageRequests[0];
    const staleLoad = image.listeners.load[0], staleFail = image.listeners.error[0];
    if (stage !== 'loading') beginDecode(image);
    if (stage === 'decoded' || stage === 'ready') { image.decodeResolve(); await tick(); }
    if (stage === 'ready') h.frames();
    h.api.renderInto(h.container, null, 'The next invented room.');
    image.decodeResolve?.(); staleLoad(); staleFail(); await tick(); h.frames(); h.advance(10000);
    assertPlain(h, 'The next invented room.'); assert.equal(h.document.imageRequests.length, 1);
    assert.equal(image.src, ''); cleanup(h);
  });
}

test('same-entry remount owns a fresh image and restores exact source nodes on dispose', async () => {
  const h = start(vectorMapping()), old = h.document.imageRequests[0]; beginDecode(old);
  const staleFail = old.listeners.error[0];
  h.api.renderInto(h.container, context, text); const fresh = h.document.imageRequests.at(-1);
  assert.notEqual(fresh, old); await ready(h, fresh);
  old.decodeReject(Error('Old decoder settled late')); staleFail(); await tick(); h.frames();
  assert.equal(h.container.querySelector('img'), fresh); assert.equal(h.document.imageRequests.length, 2);
  cleanup(h); assertPlain(h);
});

test('a removed pending source cannot commit a late image', async () => {
  const h = start(), image = h.document.imageRequests[0]; beginDecode(image);
  h.container.replaceChildren(h.document.createTextNode('External navigation.'));
  image.decodeResolve(); await tick(); h.frames();
  assert.equal(h.container.textContent, 'External navigation.'); assert.equal(h.container.querySelector('img'), null);
  cleanup(h);
});

test('formatted HTML keeps existing link identity and exact fallback on error and remount', async () => {
  for (const mode of ['renderHTML', 'enhanceHTML', 'sectionRenderer']) {
    const h = harness(), api = create(mapping(), h.env);
    let result;
    const format = source => `<p><a href="#room-42">${escape(source)}</a></p>`;
    if (mode === 'renderHTML') { result = api.renderHTML(context, text, format); h.container.innerHTML = result.html; }
    else if (mode === 'sectionRenderer') {
      const section = api.sectionRenderer(context, text); result = section.result;
      h.container.innerHTML = section.blocks.map((_, index) => section.renderBlock(index, format)).join('');
    } else { h.container.innerHTML = format(text); result = api.enhanceHTML(h.container, context, text); }
    Object.assign(h, { api, source: text, ctx: context });
    const link = h.container.querySelector('a'); api.mount(h.container, result);
    const pending = h.container.innerHTML; assert.equal(h.document.imageRequests.length, 1);
    await ready(h); assert.equal(h.container.querySelector('a'), link);
    api.mount(h.container, result); assert.equal(h.container.innerHTML, pending);
    h.document.imageRequests.at(-1).dispatch('error'); await tick(); h.frames();
    assert.equal(h.container.innerHTML, pending); assert.equal(h.container.querySelector('a'), link);
    cleanup(h); assert.equal(h.container.textContent, text);
  }
});

test('HTML source/boundary mismatches never schedule image requests or mutate markup', () => {
  for (const html of ['<p>Different source</p>', 'A copper key <p>[spa</p><p>rk]</p> waits.\nTurn to room 42.']) {
    const h = harness(), api = create(mapping(), h.env); h.container.innerHTML = html;
    const before = h.container.innerHTML, result = api.enhanceHTML(h.container, context, text);
    assert.equal(result.count, 0); assert.deepEqual(result.issues, ['html-source-or-boundary-mismatch']);
    api.mount(h.container, result); assert.equal(h.container.innerHTML, before); assert.equal(h.document.imageRequests.length, 0);
  }
});

test('copy preserves original resource text while TTS uses semantics only for this ready mount', async () => {
  const map = mapping([], { resourceSchema: 1, resourceRows: [resourceRow()] }), h = start(map);
  assert.equal(h.api.speechText(context, text), text); assert.equal(copy(h).prevented, false);
  await ready(h);
  assert.deepEqual(copy(h), { value: text, prevented: true });
  assert.equal(h.api.speechText(context, text, h.container), text.replace('[spark]', 'spark'));
  assert.equal(h.api.speechText({ ...context, entryKey: 'other' }, text, h.container), text);
  assert.equal(h.api.speechText(context, 'Different text', h.container), 'Different text');
  const outside = h.document.createElement('div'); outside.textContent = 'Outside'; h.document.body.append(outside);
  assert.equal(copy(h, outside).prevented, false);
  copy(h);
  const throwing = h.container.dispatch('copy', { clipboardData: { setData() { throw Error('Clipboard unavailable'); } } });
  assert.equal(Boolean(throwing.defaultPrevented), false);
  h.document.imageRequests[0].dispatch('error'); assertPlain(h); assert.equal(copy(h).prevented, false); cleanup(h);
});

test('retained names are not duplicated in copied or spoken text', async () => {
  const source = 'Carry spark home.';
  const named = resourceRow(source, { anchor: 'spark', position: 'after', textAlreadyNamesResource: true, retainedNameText: 'spark', retainedNameStart: 6, retainedNameEnd: 11 });
  const h = start(mapping([], { resourceSchema: 1, resourceRows: [named] }), source);
  await ready(h); assert.equal(copy(h).value, source); assert.equal(h.api.speechText(context, source, h.container), source); cleanup(h);
});

test('copy keeps table rows and cells separated without including script text', async () => {
  const h = harness(), api = create(mapping([], { resourceSchema: 1, resourceRows: [resourceRow()] }), h.env);
  const result = api.renderHTML(context, text, source => `<table><tr><td>${escape(source)}</td><td>Second cell</td></tr></table>`);
  // Format only the original source region; additional content outside it is
  // selected too and must retain table separators in the copy result.
  h.container.innerHTML = result.html.replace('<td>Second cell</td>', '') + '<table><tr><td>Second cell</td><td>Third cell</td></tr></table><script>ignored</script>';
  Object.assign(h, { api }); api.mount(h.container, result); await ready(h);
  assert.equal(copy(h).value, text + '\nSecond cell\tThird cell'); cleanup(h);
});

for (const action of ['close', 'escape', 'backdrop', 'navigate', 'reopen', 'double-click']) {
  test(`modal ${action} cancels attempts and ignores stale completion`, async () => {
    const h = start(vectorMapping()); await ready(h);
    const button = h.container.querySelector('button'); button.dispatch('click');
    const modal = h.document.body.querySelector('.ato-mm-modal'), first = h.document.imageRequests.at(-1);
    const staleLoad = first.listeners.load[0], staleFail = first.listeners.error[0];
    assert.equal(modal.hidden, false); assert.equal(h.document.body.style.overflow, 'hidden');
    assert.equal(modal.getAttribute('role'), 'dialog'); assert.equal(modal.getAttribute('aria-modal'), 'true');
    beginDecode(first);
    if (action === 'close') h.api.close();
    else if (action === 'escape') modal.dispatch('keydown', { key: 'Escape' });
    else if (action === 'backdrop') modal.dispatch('click');
    else if (action === 'navigate') h.api.renderInto(h.container, null, 'A new room.');
    else {
      if (action === 'reopen') h.api.close();
      button.dispatch('click'); const fresh = h.document.imageRequests.at(-1); assert.notEqual(fresh, first);
      await ready(h, fresh);
      first.decodeReject(Error('Late modal decode rejection')); staleFail(); await tick();
      assert.equal(fresh.hidden, false); assert.equal(modal.hidden, false);
      const tab = modal.dispatch('keydown', { key: 'Tab' }); assert.equal(tab.defaultPrevented, true);
      assert.equal(h.document.activeElement, h.document.body.querySelector('.ato-mm-close'));
      h.api.close();
    }
    first.decodeResolve?.(); staleLoad(); staleFail(); await tick(); h.frames();
    assert.equal(modal.hidden, true); assert.equal(first.src, ''); assert.equal(h.document.body.style.overflow, 'auto');
    if (action !== 'navigate') assert.equal(h.document.activeElement, button);
    else assert.equal(h.container.textContent, 'A new room.');
    cleanup(h);
  });
}

test('modal SVG timeout falls back to PNG; final failure stays hidden and close cleans everything', async () => {
  const h = start(vectorMapping()); await ready(h); h.container.querySelector('button').dispatch('click');
  const svg = h.document.imageRequests.at(-1); beginDecode(svg); h.advance(h.api.assetTimeoutMs + 1);
  const png = h.document.imageRequests.at(-1); assert.notEqual(png, svg); assert.ok(png.src.endsWith('.png'));
  svg.decodeResolve(); await tick(); assert.equal(png.hidden, true);
  h.advance(h.api.assetTimeoutMs + 1);
  assert.equal(png.src, ''); assert.equal(png.hidden, true);
  assert.equal(h.document.body.querySelector('.ato-mm-modal').hidden, false);
  h.document.body.querySelector('.ato-mm-close').dispatch('click'); cleanup(h);
});
