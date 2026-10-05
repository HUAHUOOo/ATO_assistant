/* 战斗版图与条目图片引用的现状契约（2026-10-05 之后：本机战斗版图全部退场）。
 *
 * 背景：
 *   1. C1–C5 的战斗版图现在都由混合媒体的行内混排图提供（`story/assets/mixed-media/`
 *      的 mapping.js + 裁图，两者随同一个 .atopack 下发）；混排裁图与原先 story/images/battles/
 *      下的文件本来就是同一批版图的不同裁切（C4 六张曾逐像素核对相等）。
 *   2. 因此 story/images/battles/ 下的 29 张（c1 8 / c2 23）与 C5 版图、C5 补充页扫描
 *      全部删除，素材库登记与引用同步清理，备份在 tmp/image-audit/removed-20261005/。
 *   3. story/images/ 已整棵退场（2026-10-05）：c1.5 / c2.5 的两张「导言」配图仍在用，但已从
 *      story/images/OO/ 搬到 story/assets/OO/（DY1P5.png、DY2P5.png），不再有 story/images/ 目录。
 *
 * 这里盯住五件事：
 *   a. localBattleImages 已清空，story/images/battles/ 目录不存在；
 *   b. story/images/ 里只剩在用的导言图；
 *   c. 条目数据里不再有任何 imageList 引用（有的话必须指向真实存在的文件）；
 *   d. battleImageList 的后备契约仍然成立（没有本机版图时回落条目数据，并标成可放大）；
 *   e. 战斗 AIBP 入口的解析函数仍在（供渲染路径使用）。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const storyRoot = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(storyRoot, "assets", "app.js"), "utf8");

// 故事书数据不随源码发布（见 .gitignore）：干净检出里缺它就整体跳过。
const storybookPath = path.join(storyRoot, "data", "storybook-data.js");
const skip = !fs.existsSync(storybookPath) ? "本地故事书数据未安装" : false;

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
if (!skip) vm.runInContext(fs.readFileSync(storybookPath, "utf8"), storyContext);
const storyData = storyContext.window.STORYBOOK_DATA || null;
if (!skip) assert.ok(storyData, "STORYBOOK_DATA 没有解析出来");

test("本机战斗版图名单已清空，story/images/battles 目录不存在", () => {
  assert.ok(Array.isArray(localBattleImages), "localBattleImages 还在");
  assert.equal(localBattleImages.length, 0, `名单里仍有条目：${localBattleImages.map((i) => i.test.source).join(", ")}`);
  assert.equal(fs.existsSync(path.join(storyRoot, "images", "battles")), false, "story/images/battles 仍存在");
});

test("story/images 整棵退场，导言配图已搬到 story/assets/OO", () => {
  assert.equal(fs.existsSync(path.join(storyRoot, "images")), false, "story/images 目录又出现了");
  const ooDir = path.join(storyRoot, "assets", "OO");
  assert.ok(fs.existsSync(ooDir), "story/assets/OO 不存在");
  const files = fs.readdirSync(ooDir).sort();
  assert.deepEqual(files, ["DY1P5.png", "DY2P5.png"], `story/assets/OO 内容不符：${files.join(", ")}`);
  // 两张图都要能被 c1.5 / c2.5 的导言条目按新路径取到。
  for (const bookId of ["c1.5", "c2.5"]) {
    const book = storyData?.books.find((candidate) => candidate.id === bookId);
    if (!book) continue;
    const preface = book.entries.find((entry) => entry.id === "preface");
    assert.ok(preface?.image, `${bookId} 导言条目没有 image 字段`);
    assert.match(preface.image, /^\.\/assets\/OO\/DY[12]P5\.png$/, `${bookId} 导言配图路径不对：${preface.image}`);
    assert.ok(fs.existsSync(path.join(storyRoot, preface.image.replace(/^\.\//, ""))), `${bookId} 导言配图文件缺失：${preface.image}`);
  }
});

test("条目数据里没有残留的 imageList 引用", { skip }, () => {
  let found = 0;
  for (const book of storyData.books) {
    for (const entry of book.entries) {
      for (const src of entry.imageList || []) {
        found += 1;
        assert.ok(
          fs.existsSync(path.join(storyRoot, String(src).replace(/^\.\//, ""))),
          `${book.id}/${entry.key} 引用了不存在的图：${src}`
        );
      }
    }
  }
  assert.equal(found, 0, `应当已清空所有 imageList 引用，仍有 ${found} 条`);
});

test("没有本机版图时回落到条目数据里的 imageList", () => {
  const orphan = {
    id: "some-new-battle",
    key: "c9-supplement-some-new-battle",
    // 用一个真实存在的图片路径来验证回落契约（战斗版图本身已全部退场）。
    imageList: ["./assets/OO/DY1P5.png"],
    supplementSource: "五循环故事书OCR.pdf",
    originalText: "--- Storybook page 174 ---",
  };
  assert.equal(Array.from(localBattleImageList(orphan)).length, 0, "空名单不该匹配到任何条目");
  const fallback = battleImageList(orphan);
  assert.deepEqual(Array.from(fallback.images, (value) => String(value)), orphan.imageList);
  assert.equal(Boolean(fallback.zoomablePages), true, "条目数据里的图像仍应可放大查看");
});

test("战斗 AIBP 入口的解析函数仍在", () => {
  assert.match(appSource, /function battleAibpLink\(entry\)/, "battleAibpLink 不见了");
  assert.match(appSource, /function renderBattleImages\(entry, options = \{\}\)/, "renderBattleImages 不见了");
  // 行内混排已挂出版图时去重的判断仍在（依赖渲染器的计划结果，而不是另抄一套规则）。
  assert.match(appSource, /function mixedMediaBoardCount\(entry\)/, "mixedMediaBoardCount 不见了");
  assert.match(appSource, /if \(mixedMediaBoardCount\(entry\)\) return aibpLink;/, "去重分支不见了");
});
