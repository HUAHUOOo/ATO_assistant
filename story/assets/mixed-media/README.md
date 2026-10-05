# 可选故事混排渲染器

程序代码与资料分开：本目录公开 `renderer.js`、`styles.css` 和说明；
`mapping.js`、`images/`、`assets/icons/` 中的图形及完整故事数据由使用者在本地准备。
源码仓库、PR、程序发行包均不包含这些素材，也不提供素材下载地址。
本模块沿用仓库 [LICENSE](../../../LICENSE) 的许可及通知要求；代码许可不授予游戏素材许可。

## 行为与兼容边界

- 故事页和第二屏共用一个 schema 1 渲染器。故事正文、搜索数据、存档结构保持原样
- 仅精确命中书目、版本、条目、全文长度/指纹、锚点次数和相邻文本的映射生效
- C1–C3 仅启用官方版映射，C4–C5 仅启用民间版映射；故事卡、厄运卡和规则条目不启用
- 不存在映射、版本不符、锚点变化或范围重叠时显示原文，不猜测图标或位置
- 经登记的 SVG 优先；加载/解码失败后尝试原 PNG，再失败则保留原文。每次请求有超时
- 点击图片可放大；离开条目、重绘或关闭浮层后，旧加载回调不能改写新页面
- 复制和朗读只在当前图像真正加载后使用已登记的语义名称；否则保持原文
- 精确登记的 C5 战斗标题仅加粗，不改标题内容、正文、规则或朗读文本
- 原生战斗版图可以复用，只有内嵌图片真正解码成功才隐藏重复图库，失败后恢复图库

## 本地资料路径

路径从应用根目录起算，不接受远程 URL、绝对路径、路径穿越、查询参数或片段：

| 内容 | 路径 |
| --- | --- |
| 映射 | `story/assets/mixed-media/mapping.js` |
| 原始 PNG | `story/assets/mixed-media/images/c1/` 至 `c5/` |
| 已登记 SVG | `assets/icons/` 下的精确白名单文件 |
| 复用原生版图 | `story/images/battles/` 下的精确白名单文件 |

`mapping.js` 采用已有资料包契约：给 `window.ATO_MIXED_MEDIA_MAP` 赋值的本地脚本。
页面异步加载它，不阻塞阅读；加载完成后刷新当前条目。它是可执行 JavaScript，
只应使用可信来源的资料，不应把不受信任的文件放到这个位置。

本 PR 提供前端与源码发布保护，不改变 `.atopack` 导入器、Android 资源目录或 Docker
挂载配置。便携版/开发目录可按上述相对路径单独放置资料；Android 和 Docker 若要自动
导入/挂载新增映射及 PNG 目录，还需后续接入。不要把整个 `mixed-media/` 挂载为素材目录，
否则会遮住随应用更新的 `renderer.js` 和 `styles.css`。没有这些资料的客户端继续显示原文。

## 映射契约

顶层 `schema: 1`；`rows` 是普通图形，`resourceSchema: 1` / `resourceRows` 是资源图标，
`battleSchema: 1` / `battleRows` 是战斗图形，`requestedSchema: 1` / `requestedRows`
是额外已审核图形。每一行至少包含：

- `book`、`variant`、`key`：对应上下文的 `bookId`、`variant`、`entryKey`
- `path`、`layout`（`inline` 或 `block`）
- `textLength` 与 `textFingerprint`：JavaScript 字符串长度和 `fingerprint(text)` 的八位十六进制结果
- `anchor`、`anchorOccurrence`、`anchorCount`、`contextBefore`、`contextAfter`
- `position`（`replace` / `before` / `after`）；替换时还需 `replaceText`
- 资源图标需 `kind: "resource-icon"` 和 `resourceLabel`；其它带语义的图形需 `semanticLabel`

`before` / `after` 插入不消耗源文字。对原文已经写出名称的插入，应声明
`textAlreadyNamesResource` 或 `textAlreadyNamesMedia`，并提供经核验的
`retainedNameText`、`retainedNameStart`、`retainedNameEnd`，避免复制/朗读重复名称。

SVG 还需 `vectorSchema: 1` 和 `vectorAssets`。仅运行时登记的路径、尺寸及 PNG/SVG
SHA-256 元数据组合可用；元数据白名单不是浏览器对文件内容的散列校验，安装端仍须
校验实际文件。未登记/变更的 SVG 元数据不会通过宽松路径规则自动生效。

公共回归测试用虚构正文构造映射，不需要任何游戏文件：

```sh
node --test tests/mixed-media*.test.cjs story/tests/mixed-media-gallery.test.cjs
python tools/test_mixed_media_release.py
```

这些测试覆盖纯 JavaScript 规划、有限 DOM/事件模型和发布路径保护；不等同于真实浏览器、
Windows 便携版、Android WebView、系统剪贴板/语音或实际游戏图片的端到端验证。
