# 第二屏主题跟随主控台（循环 + 自定义颜色）

反馈：第二屏幕的主题色不像其他模块那样会变。

## 原因

`ss/index.html` 本来就加载了 `assets/theme.js`，机制没缺，缺的是**值**：

- 外观偏好（`ato-theme-v1`：auto / c1–c5 / 自定义 RGB）和循环（`ato-theme-cycle-v1`）都存在
  **浏览器的 localStorage** 里，只靠同源页面的 BroadcastChannel + `storage` 事件传播——换设备就断。
  第二屏按设计是另一台设备（手机/电视），那边 localStorage 是空的；
- 于是主题落到 `mode=auto`，而 auto 要取「战役的活动循环」，取值顺序是
  `body[data-cycle]` → `?cycle=` → 本机 localStorage，三个都没有 → 固定退回默认 `c1`；
- 其他模块会设这个值：地图页 `render()` 里写 `document.body.dataset.cycle = state.activeCycleId`
  （`map/app.js`），主控台切档时调 `window.ATO_THEME.setCycle(...)`（`index.html`）。第二屏的
  payload 里其实一直带着 `cycleId`，但外壳从没用过它。

实测（无头 Chrome，真实 `ss/index.html` 代码路径）：

| 场景 | 结果 |
| --- | --- |
| 第二屏刚打开（空 localStorage） | `mode=auto`、`cycle=c1`、`--accent:#7f4b26` |
| 把 `body[data-cycle]` 设成 c4 / c5 | `#a0843d` / `#06243d`，机制本身是好的 |
| 在同一台电脑的浏览器里重开 `/ss/` | 沿用主控台的自定义色（同一个 localStorage） |
| 换到另一台设备 | 永远是 c1 |

顺带一个容易误会的地方：第二屏里**内嵌的地图**会跟着战役循环变色（iframe 里 `map/app.js` 自己设的
`data-cycle`），外壳不会，看起来就是"有的地方变、有的地方不变"。

## 改法（外观走服务端，第二屏每次轮询自己应用）

1. **服务端** `api/campaign-state.php`：第二屏条目新增 `theme` 字段。
   - `normalize_theme_setting()` 只认 `auto|c1|c2|c3|c4|c5|custom`，`rgb` 三个通道夹到 0–255 的
     整数，坏值退回 `{mode:'auto', rgb:[127,75,38]}`；
   - `?action=second-screen-status` 的 POST 接受 `theme`（不带就不动已存的那份，改显示大小、
     转版图不会把主题清掉），GET/响应里带回；
   - `public_second_screen_payload()` 在轮询响应里加 `theme`（`cycleId` 本来就有）。
2. **主控台** `index.html`：`ato-theme-changed` 时把当前外观 POST 上去（取色器会连着触发，
   攒 400ms 一次；同一份不重复写）；开启第二屏时连同外观一起写；读状态时用服务端那份初始化
   "已推送"标记，本机没改就不会多写一遍。
3. **第二屏** `ss/app.js`：`applySecondScreenTheme()` 在每次轮询里把 `payload.screen.cycleId`
   写进 `body[data-cycle]`（auto 模式靠它取色），并把 `theme` 交给 `window.ATO_THEME.set()`；
   同一份主题不重复应用。`theme.js` 是 `defer` 加载的，第一次轮询可能赶在它前头——这种情况不记
   "已应用"，下一次轮询接着试（这条是浏览器实测抓出来的，单测里也钉住了）。
4. **安卓** `tools/packaging/android/.../LocalCampaignApi.java`：安卓侧没有 PHP，同样的
   HTTP 接口在 Java 里实现，`theme` 字段按同一套规则（`normalizeTheme`）一起走通，否则安卓上
   的第二屏还是不会变。

## 验证

- **PHP 端到端**（`tests/test_php_api_hardening.py`，真实 PHP 服务器 + 隔离账号）：新增
  `test_second_screen_theme_round_trips_with_the_settings` —— 开启时写 `custom/200,30,30`，
  带令牌的 `?action=second-screen` 读回同一份；换档后 `cycleId` 从 c4 变 c5；坏模式值退回 auto、
  颜色 `[999,-5,12.6]` → `[255,0,13]`；不带 theme 的局部更新保留主题；关屏后令牌地址 404。
  **全套 11 项通过**。
- **安卓**（`tools/test_android_campaign_import.py`，真编译真运行）：harness 里补了同一组断言
  （round-trip、轮询可见、循环为 c5、坏值退回、夹取、局部更新保留），**102 项检查通过**（原 92）。
- **前端**（`tests/ss-second-screen-theme.test.cjs`，8 项）：应用与去重、旧快照只同步循环、
  没有 theme.js 时不报错、defer 竞态下一次轮询补上，以及两端接线（`ss/app.js` 的调用点、
  PHP 的字段与夹取、主控台的三个推送点）。`tests/` 全套 **576 项通过**。
- **真实浏览器**（`tmp/ss-check.cjs`，合成 payload 走真实 `ss/app.js`）：
  `custom/200,30,30` → `--accent:#c81e1e`、背景 `rgb(252,242,242)`；`auto`+c1 → `#7f4b26`；
  `c5` → `#06243d`；`auto`+c3 → `#752a7f`；控制台 0 error。截图 `tmp/ss-check-shots/`。

## 取舍与注意

- 主题跟着**第二屏设置**走：主控台改了约 1.5 秒（一次轮询）后到屏；关掉第二屏就不再同步。
- 自定义颜色以主控台为准；第二屏那台设备自己改（没有入口）会被下一次轮询覆盖。
- `auto` 模式的循环来自战役状态（`cycleId`），和地图一致；选 c1–c5 则固定用那套循环色。
