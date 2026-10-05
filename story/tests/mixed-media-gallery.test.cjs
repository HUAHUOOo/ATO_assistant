const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const marker = 'data-ato-mm-native-duplicate';
const nativePath = 'story/images/battles/c5/meduketos-battle.jpg';
const localSource = './images/battles/c5/meduketos-battle.jpg';

function galleryImage(src, hidden = false) {
  const attributes = new Map([['src', src]]);
  return {
    hidden,
    getAttribute: name => attributes.get(name) ?? null,
    hasAttribute: name => attributes.has(name),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
  };
}

function setup(images, href = 'https://example.test/app/story/index.html') {
  const match = source.match(/^  function refreshMixedMediaBattleGallery\([^]*?^  }/m);
  assert.ok(match, 'gallery readiness helper must be present');
  const context = vm.createContext({
    URL,
    window: { location: { href } },
    storyText: {
      querySelectorAll(selector) {
        assert.equal(selector, '.battle-gallery img', 'only native gallery images may be changed');
        return images;
      },
    },
  });
  vm.runInContext(match[0], context);
  return context.refreshMixedMediaBattleGallery;
}

test('native galleries stay visible until the exact same-origin in-text map is ready', () => {
  const images = [
    galleryImage(localSource),
    galleryImage('https://example.test/app/' + nativePath),
    galleryImage('./images/battles/c5/white-lie-battle.jpg'),
    galleryImage('https://other.test/app/' + nativePath),
    galleryImage('https://example.test/outside/' + nativePath),
  ];
  const refresh = setup(images);
  refresh();
  assert.deepEqual(images.map(image => image.hidden), [false, false, false, false, false]);
  refresh([nativePath]);
  assert.deepEqual(images.map(image => image.hidden), [true, true, false, false, false]);
  assert.equal(images[0].hasAttribute(marker), true);
  refresh([nativePath]);
  assert.equal(images[0].hidden, true, 'repeat callbacks preserve the duplicate state');
});

test('fallback restores only visibility owned by mixed media, including older callback payloads', () => {
  const owned = galleryImage(localSource);
  const preHidden = galleryImage(localSource, true);
  const unrelated = galleryImage('./images/battles/c5/white-lie-battle.jpg', true);
  const refresh = setup([owned, preHidden, unrelated]);
  refresh([nativePath]);
  assert.equal(preHidden.hasAttribute(marker), false, 'already hidden images are not owned');
  refresh();
  assert.equal(owned.hidden, false);
  assert.equal(owned.hasAttribute(marker), false);
  assert.equal(preHidden.hidden, true);
  assert.equal(unrelated.hidden, true);
});

test('encoded native paths normalize exactly and malformed paths remain visible', () => {
  const encodedPath = 'story/images/battles/c3/与日竞赛战斗.jpg';
  const encoded = galleryImage('./images/battles/c3/' + encodeURIComponent('与日竞赛战斗.jpg'));
  const malformed = galleryImage('./images/battles/c3/%xx.jpg');
  const refresh = setup([encoded, malformed]);
  refresh([encodedPath]);
  assert.equal(encoded.hidden, true);
  assert.equal(malformed.hidden, false);
  refresh([]);
  assert.equal(encoded.hidden, false);
});

test('upstream local battle priority and removed-source-page safeguards remain intact', () => {
  const start = source.indexOf('  const localBattleImages = [');
  const end = source.indexOf('  function prepareSpeechText(text) {', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context);
  const entry = {
    id: 'meduketos-battle',
    key: 'c5-supplement-meduketos-battle',
    originalText: 'Synthetic source',
    imageList: ['./images/c5/supplement-pages/page-176.jpg'],
  };
  assert.deepEqual(Array.from(context.battleImageList(entry).images), [localSource]);
  assert.equal(context.battleImageList(entry).zoomablePages, false);
  assert.equal(context.declaredBattlePages(entry).length, 0);
  const fallback = context.battleImageList({ ...entry, id: 'unmapped-battle', key: 'unmapped-battle' });
  assert.deepEqual(Array.from(fallback.images), entry.imageList);
  assert.equal(fallback.zoomablePages, true);
});
