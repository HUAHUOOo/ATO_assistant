const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'aibp/index.html'), 'utf8');
const tokenDir = path.join(root, 'aibp/ps/other/token');

// Token 名单写死在页面的 tokenFileNames 数组里，测试直接从源码里取出来，保证测的就是页面用的那份。
function builtInTokenFileNames() {
  const match = source.match(/    const tokenFileNames = (\[[\s\S]*?\n    \]);/);
  assert.ok(match, 'index.html 里找不到写死的 tokenFileNames 名单');
  return Array.from(vm.runInNewContext(`(${match[1]})`));
}

const tokenFileNames = builtInTokenFileNames();

function fakeElement() {
  return {
    children: [], dataset: {}, classList: { add() {} },
    append(...nodes) { this.children.push(...nodes); },
    addEventListener() {},
  };
}

function harness(files) {
  const requests = [];
  const grid = {
    children: [],
    replaceChildren() { this.children = []; },
    appendChild(node) { this.children.push(node); },
  };
  const context = {
    tokenFileNames: files,
    tokenBasePath: 'ps/other/token',
    currentApostle: 'HEKATON',
    ensurePiles() {},
    selectedTokenStacksMap() { return new Map(); },
    tokenDialogTitle: {},
    tokenFolderHint: {},
    tokenDialogGrid: grid,
    document: { createElement() { return fakeElement(); } },
    Image: class {
      constructor() { this.classList = { add() {} }; }
      set src(value) { requests.push(value); }
      addEventListener() {}
    },
  };
  vm.createContext(context);
  const names = [
    'isTokenImageFileName', 'naturalCompareTokenFile', 'normalizeTokenFileName',
    'tokenListFileNames', 'tokenSrc', 'appendTokenOption', 'renderTokenCandidates',
  ];
  for (const name of names) {
    const match = source.match(new RegExp(`    (?:async )?function ${name}\\([\\s\\S]*?\\n    }`));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  return { context, grid, requests };
}

test('页面自带的 token 名单格式正确', () => {
  assert.ok(tokenFileNames.length > 0, '名单不能是空的');
  assert.equal(new Set(tokenFileNames).size, tokenFileNames.length, '名单里有重复项');
  tokenFileNames.forEach((name) => assert.match(name, /\.(?:png|jpe?g)$/i, name));
});

// 自备素材体检：只在本地真的有 token 图片时跑（公开克隆里没有这个目录）。
// 名单里的图在本机缺失才算缺陷——选项会挂一张空图；本地多出来的图只提醒，
// 因为那既可能是刚放进来的个人素材，也可能是还没加进名单的官方图，
// 需要人来判断，不该让整个测试套件因此变红。
test('本地素材体检：名单里的图都在，多出来的图只提醒', (t) => {
  const onDisk = fs.existsSync(tokenDir)
    ? fs.readdirSync(tokenDir).filter((name) => /\.(?:png|jpe?g)$/i.test(name))
    : [];
  if (onDisk.length === 0) {
    t.skip('本地没有 aibp/ps/other/token/ 图片，跳过自备素材体检');
    return;
  }
  const onDiskSet = new Set(onDisk);
  const missing = tokenFileNames.filter((name) => !onDiskSet.has(name));
  assert.deepEqual(missing, [], '名单里的图在本机不存在，页面上会显示成占位图');
  const extra = onDisk.filter((name) => !tokenFileNames.includes(name));
  if (extra.length) {
    console.warn(
      `提示：aibp/ps/other/token/ 里多出 ${extra.length} 张不在内置名单里的图：${extra.join('、')}。\n`
      + '      它们不会出现在页面的 token 选项里；如果本来要用，请把文件名加进 aibp/index.html 的 tokenFileNames。'
    );
  }
});

test('弹窗按名单整份渲染，不列举目录、也不探测文件名', () => {
  const h = harness(tokenFileNames);
  h.context.renderTokenCandidates();

  assert.equal(h.grid.children.length, tokenFileNames.length, '每个名单项都要出一个选项');
  assert.deepEqual(
    h.requests.slice().sort(),
    tokenFileNames.map((name) => `ps/other/token/${name}`).sort(),
  );
});

test('名单里的图缺失时仍然保留该选项，只把图换成占位', () => {
  const h = harness(['不存在的图.png']);
  h.context.renderTokenCandidates();
  assert.equal(h.grid.children.length, 1);
  assert.deepEqual(h.requests, ['ps/other/token/不存在的图.png']);
});

test('名单为空时给出提示，而不是静默空白', () => {
  const h = harness([]);
  h.context.renderTokenCandidates();
  assert.equal(h.grid.children.length, 1);
  assert.match(h.grid.children[0].textContent, /名单是空的/);
});

test('页面里不再残留目录列举与文件名探测的老代码', () => {
  ['loadTokenFileNamesFromDirectoryIndex', 'tokenProbeFileNames', 'tokenProbeMaxIndex',
   'tokenProbeExtensions', 'AIBP_TOKEN_FILES'].forEach((token) => {
    assert.ok(!source.includes(token), `index.html 里还留着 ${token}`);
  });
});
