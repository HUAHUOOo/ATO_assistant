'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const rendererSource = fs.readFileSync(path.join(__dirname, '../../story/assets/mixed-media/renderer.js'), 'utf8');

// Replace data-only registries in an isolated copy, never implementation logic.
// This exercises positive native/heading paths without republishing game data.
function rendererWithSyntheticRegistries({ native, headings } = {}) {
  let source = rendererSource;
  for (const [name, value] of [['nativeBattleRegistry', native], ['records', headings]]) {
    if (value === undefined) continue;
    const declaration = new RegExp(`const ${name} = \\[[^\\n]*\\];`);
    assert.equal((source.match(new RegExp(declaration.source, 'g')) || []).length, 1);
    source = source.replace(declaration, () => `const ${name} = ${JSON.stringify(value)};`);
  }
  const scope = { module: { exports: {} }, URL };
  vm.runInNewContext(source, scope, { filename: 'synthetic-mixed-media-renderer.js' });
  return scope.module.exports;
}

// Inspect and evaluate only named pure/DOM helper declarations, never bootstrap,
// PHP, BAT, complete application bundles, network code or storybook scripts.
function appHelper(relativePath, name, scope) {
  const source = fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
  const declaration = source.match(new RegExp(`^  function ${name}\\([^]*?^  }`, 'm'));
  assert.ok(declaration, `Missing helper: ${name}`);
  return vm.runInNewContext(`(${declaration[0]})`, { URL, ...scope });
}

module.exports = { rendererSource, rendererWithSyntheticRegistries, appHelper };
