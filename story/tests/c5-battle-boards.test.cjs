/* C5 战斗模块的版图设置：条目 → 版图图片的映射、文件存在性与优先后备。

背景：C5 补充包的战斗条目在条目数据里自带 imageList（整页扫描页），而 c1/c3/c4 的
版图是靠 app.js 的 localBattleImages 按 id/key 匹配挂上去的。这里盯住四件事：
  1. 6 场 C5 战斗都能匹配到本机裁好的版图（不被数据里的整页扫描盖掉）；
  2. 声明的文件真的在 story/images/battles/c5/ 里，且是能读的 JPEG；
  3. 尺寸与现有 c1/c4 素材同一量级（别塞进一张几十像素的缩略图）；
  4. 没有本地版图时，数据里的 imageList（整页扫描）仍然是后备。
*/
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const storyRoot = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(storyRoot, "assets", "app.js"), "utf8");

// 故事书数据与本机版图素材都不随源码发布（见 .gitignore）：干净检出里缺任一项就整体跳过，
// 免得把「素材未安装」报成失败（矩阵内容测试用的是同一套路）。
const storybookPath = path.join(storyRoot, "data", "storybook-data.js");
const boardsPath = path.join(storyRoot, "images", "battles", "c5");
const skip = !fs.existsSync(storybookPath)
  ? "本地故事书数据未安装"
  : (!fs.existsSync(boardsPath) ? "本地战斗版图素材未安装" : false);

const arrayStart = appSource.indexOf("  const localBattleImages = [");
const functionEnd = appSource.indexOf("  function prepareSpeechText(text) {", arrayStart);
assert.notEqual(arrayStart, -1, "localBattleImages array is missing");
assert.notEqual(functionEnd, -1, "localBattleImages boundary is missing");

const block = appSource.slice(arrayStart, functionEnd);
const context = {};
vm.createContext(context);
const { localBattleImages, localBattleImageList, battleImageList } = vm.runInNewContext(`
  (() => {
    ${block}
    return { localBattleImages, localBattleImageList, battleImageList };
  })()
`, context);

const storyContext = { window: {} };
vm.createContext(storyContext);
if (!skip) {
  vm.runInContext(fs.readFileSync(storybookPath, "utf8"), storyContext);
}
const c5 = storyContext.window.STORYBOOK_DATA?.books.find((book) => book.id === "c5") || null;
if (!skip) assert.ok(c5, "C5 story book is missing");

// 条目 id → 期望的版图文件（顺序即模块里的显示顺序）
const EXPECTED = {
  "dragon-of-phobos-battle": [
    "c5/dragon-of-phobos-battle-level-1-2.jpg",
    "c5/dragon-of-phobos-battle-level-3-plus.jpg",
  ],
  "meduketos-battle": ["c5/meduketos-battle.jpg"],
  "the-devil-himself-battle": [
    "c5/the-devil-himself-battle-level-1-4.jpg",
    "c5/the-devil-himself-battle-level-5-plus.jpg",
  ],
  "thicker-than-water-battle": ["c5/thicker-than-water-battle.jpg"],
  "harsh-truth-battle": ["c5/harsh-truth-battle.jpg"],
  "white-lie-battle": ["c5/white-lie-battle.jpg"],
};

function jpegSize(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer[0], 0xff, `${file} 不是 JPEG`);
  assert.equal(buffer[1], 0xd8, `${file} 不是 JPEG`);
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error(`${file} 里找不到 SOF 段`);
}

for (const [entryId, expected] of Object.entries(EXPECTED)) {
  test(`C5 ${entryId} 使用本机裁好的版图`, { skip }, () => {
    const entry = c5.entries.find((candidate) => candidate.id === entryId);
    assert.ok(entry, `C5 battle entry is missing: ${entryId}`);

    // 条目数据里确实带整页扫描：这正是「本地优先」需要挡住的那条路径。
    assert.ok(
      Array.isArray(entry.imageList) && entry.imageList.length > 0,
      `${entryId} 的条目数据里应当仍有整页扫描（作为后备）`
    );

    const picked = battleImageList(entry);
    // vm 里造出来的数组是另一个 realm 的对象，deepStrictEqual 会因为原型不同而失败，
    // 这里统一摊平成普通字符串数组再比。
    const pickedImages = Array.from(picked.images, (value) => String(value));
    assert.deepEqual(
      pickedImages,
      expected.map((name) => `./images/battles/${name}`),
      `${entryId} 的版图列表与期望不一致`
    );
    assert.equal(Boolean(picked.zoomablePages), false, "本机版图不应该挂原书页放大查看器");

    for (const name of expected) {
      const file = path.join(storyRoot, "images", "battles", name);
      assert.ok(fs.existsSync(file), `缺少版图文件：${name}`);
      const { width, height } = jpegSize(file);
      assert.ok(width >= 850 && height >= 550, `${name} 太小（${width}x${height}）：源页只有 1500px 宽，至少放大到 850px 以上`);
      assert.ok(width < 4000 && height < 4000, `${name} 尺寸异常（${width}x${height}）`);
      const ratio = width / height;
      assert.ok(ratio > 0.6 && ratio < 3, `${name} 长宽比异常（${width}x${height}）`);
    }
  });
}

test("没有本机版图时回落到条目数据里的 imageList", { skip }, () => {
  const orphan = {
    id: "some-new-battle",
    key: "c9-supplement-some-new-battle",
    imageList: ["./images/c5/supplement-pages/page-174.jpg"],
    supplementSource: "五循环故事书OCR.pdf",
    originalText: "--- Storybook page 174 ---",
  };
  assert.equal(Array.from(localBattleImageList(orphan)).length, 0, "不该匹配到任何本机版图");
  const fallback = battleImageList(orphan);
  assert.deepEqual(Array.from(fallback.images, (value) => String(value)), orphan.imageList);
  assert.equal(Boolean(fallback.zoomablePages), true, "整页扫描仍应可放大查看");
});

test("本地版图路径都在 story/images/battles 下且被 c5 目录收拢", { skip }, () => {
  const c5Entries = localBattleImages.filter((item) => item.test.source.includes("-battle"));
  assert.ok(c5Entries.length >= 6, "C5 版图条目少于 6 条");
  for (const item of localBattleImages) {
    for (const src of item.images) {
      assert.match(src, /^\.\/images\/battles\/c\d\//, `路径不符合目录约定：${src}`);
      const file = path.join(storyRoot, src.replace(/^\.\//, ""));
      assert.ok(fs.existsSync(file), `localBattleImages 指向了不存在的文件：${src}`);
    }
  }
});

test("C1 的条目数据 imageList 仍按原书页处理（可放大查看）", { skip }, () => {
  const c1 = storyContext.window.STORYBOOK_DATA.books.find((book) => book.id === "c1");
  const hekaton = c1.entries.find((entry) => entry.id === "百臂巨人之战-hekaton-battle");
  assert.ok(hekaton, "C1 百臂巨人之战条目缺失");
  const picked = battleImageList(hekaton);
  // C1 数据里的 imageList 指的就是 images/battles/c1/ 下同一批文件，本机列表命中后
  // 仍然返回同一批路径；差别只在「整页扫描页」的放大标记上：C1 这些是版图块，不挂放大。
  assert.equal(Array.from(picked.images).length, (hekaton.imageList || []).length);
  for (const src of Array.from(picked.images, (value) => String(value))) {
    assert.ok((hekaton.imageList || []).includes(src), `C1 命中结果混进了别的图：${src}`);
    assert.ok(fs.existsSync(path.join(storyRoot, src.replace(/^\.\//, ""))), `C1 版图缺失：${src}`);
  }
});

test("C5 战斗条目数据里已删除的原页不会再被引用", { skip }, () => {
  // 六场 C5 战斗的原页扫描（174-185）已删除，条目数据（本地生成物）里仍写着它们；
  // battleImageList 必须把它们过滤掉，否则模块会挂出指向已删文件的碎图。
  for (const [entryId] of Object.entries(EXPECTED)) {
    const entry = c5.entries.find((candidate) => candidate.id === entryId);
    const picked = Array.from(battleImageList(entry).images, (value) => String(value));
    for (const src of picked) {
      assert.ok(
        fs.existsSync(path.join(storyRoot, src.replace(/^\.\//, ""))),
        `${entryId} 引用了不存在的图：${src}`
      );
      assert.ok(
        !/c5\/supplement-pages\/page-1[78][4-9]|page-18[0-5]/.test(src),
        `${entryId} 仍引用已删除的战斗原页：${src}`
      );
    }
  }
});
