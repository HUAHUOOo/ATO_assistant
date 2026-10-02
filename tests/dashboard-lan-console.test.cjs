// 局域网浏览入口：安卓版把整个应用（主控台 + 各模块 + 第二屏）都开在同一个端口上，
// 所以主控台里除了第二屏地址，还要给出「主控台地址」——它就是第二屏地址去掉 /ss/。
// 便携版 / Docker 的局域网入口本来就是完整站点（别的设备登录后可用），安卓则是和这台手机
// 共用同一个登录态（可读可写，登录/退出只在本机），两种提示必须分开，所以由
// payload.lanSharedAccount 决定措辞。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractBalanced(text, start, openChar, closeChar) {
  const open = text.indexOf(openChar, start);
  if (open < 0) throw new Error(`Missing ${openChar} after offset ${start}.`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) depth -= 1;
    if (depth === 0) return text.slice(open, index + 1);
  }
  throw new Error(`Unclosed ${openChar} after offset ${start}.`);
}

function extractFunction(text, name) {
  const marker = `function ${name}(`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Missing function ${name}.`);
  // 参数表里可能就有 {}（例如 payload = {}），所以先配对到参数表的右括号，再找函数体。
  const params = extractBalanced(text, start + marker.length - 1, "(", ")");
  const paramsEnd = start + marker.length - 1 + params.length;
  const body = extractBalanced(text, paramsEnd, "{", "}");
  return text.slice(start, paramsEnd) + body;
}

function lanConsoleUrlFrom() {
  const context = { window: { location: { href: "http://127.0.0.1:8899/index.html" } } };
  vm.createContext(context);
  vm.runInContext(extractFunction(source, "lanConsoleUrlFrom"), context);
  return context.lanConsoleUrlFrom;
}

test("主控台地址由第二屏地址去掉 /ss/ 得到", () => {
  const derive = lanConsoleUrlFrom();
  // 安卓：第二屏地址是 http://<ip>:<随机端口>/ss/
  assert.equal(derive("http://192.168.1.5:41234/ss/"), "http://192.168.1.5:41234/");
  // 便携版 / Docker：第二屏地址带 token，主控台地址不带（主控台不认 token）
  assert.equal(derive("http://192.168.1.5:8899/ss/?token=abc123"), "http://192.168.1.5:8899/");
  // 部署在子路径时只去掉 /ss/，前缀保留
  assert.equal(derive("http://nas.local/ato/ss/"), "http://nas.local/ato/");
  // 认不出 /ss/ 就给空串，调用方据此隐藏整行
  assert.equal(derive("http://192.168.1.5:8899/index.html"), "");
  assert.equal(derive(""), "");
  assert.equal(derive(null), "");
});

test("主控台里给出局域网主控台地址这一行", () => {
  assert.match(source, /id="lanConsoleRow"/, "缺少主控台地址行");
  assert.match(source, /id="lanConsoleUrl"[^>]*readonly aria-label="局域网主控台网址"/, "地址要只读");
  assert.match(source, /id="copyLanConsoleButton"/, "缺少复制按钮");
  assert.match(source, /id="openLanConsoleLink"[^>]*target="_blank"/, "缺少打开链接");

  const row = source.slice(source.indexOf('id="lanConsoleRow"'), source.indexOf('id="lanConsoleRow"') + 600);
  assert.match(row, /class="second-screen-address"/, "主控台地址行沿用第二屏地址行的网格样式");
  assert.match(row, /class="secondary"/, "复制按钮用次要按钮样式");
  assert.match(row, /data-dashboard-readonly-allowed/, "复制按钮属于只读模式下也允许的操作");

  // 这一行必须和第二屏地址、第二屏提示在同一张卡里（顺序：地址 → 主控台地址 → 提示）。
  const address = source.indexOf('id="secondScreenAddress"');
  const consoleRow = source.indexOf('id="lanConsoleRow"');
  const hint = source.indexOf('id="secondScreenHint"');
  assert.ok(address > 0 && consoleRow > address && hint > consoleRow, "主控台地址行的位置不对");
});

test("局域网提示按 lanSharedAccount 分开写，安卓说清登录态在本机", () => {
  const render = extractFunction(source, "renderSecondScreenStatus");
  assert.match(render, /lanConsoleUrlFrom\(preferred\)/, "渲染时要用同一个换算函数");
  assert.match(render, /elements\.lanConsoleRow\.hidden = !hasLanConsole/, "没有局域网地址时要隐藏整行");
  assert.match(render, /payload\.lanSharedAccount/, "提示要看 payload.lanSharedAccount");
  assert.match(render, /登录态跟着这台手机走/, "安卓要说明登录态在本机");
  assert.match(render, /登录\/退出仍在本机操作/, "安卓要说明登录/退出仍在本机");
  assert.match(render, /在那台设备上登录后使用/, "便携版 / Docker 要说明需要在那台设备上登录");
  // 复制按钮要真的把地址写进剪贴板。
  assert.match(source, /copyLanConsoleButton\.addEventListener\("click"/);
});

test("安卓接口声明局域网共用登录态（lanSharedAccount）", () => {
  const java = fs.readFileSync(
    path.join(root, "tools", "packaging", "android", "app", "src", "main", "java", "com", "ato", "assistant", "LocalCampaignApi.java"),
    "utf8",
  );
  assert.match(java, /put\(response, "lanSharedAccount", true\)/, "安卓接口要声明局域网共用登录态");
  // 便携版 / Docker 的 PHP 接口不发这个字段，页面按「需要登录」处理。
  const php = fs.readFileSync(path.join(root, "api", "campaign-state.php"), "utf8");
  assert.ok(!/lanSharedAccount/.test(php), "PHP 接口不该发 lanSharedAccount（局域网入口本来是完整站点）");
});
