# 字形与离线分词来源

字形素材、字母参考表、`vendor/text-format.js` 和 ATO 名称词表来自用户指定的 [Babelian & Siren Translator](https://github.com/HUAHUOOo/Babelian-Siren-Translator)，版本 1.9.27，提交 `3b9a96f49b549802ca9338866e8d97e0d042f22d`。本模块复用字形素材与离线分词算法，自行实现手动输入、字符对应、词组笔记和战役记录；未引入其 OCR、机翻服务或独立存档接口。

英语词频数据来自 [wordninja](https://github.com/keredson/wordninja)，MIT 许可文本及原始来源、哈希保留在 `vendor/`。`word-data.js` 由原词频数据解压生成。

参考字母表需由玩家明确选择使用。默认为空白字符对应；手工录入的塞壬语按玩家确认的读序保存，不根据直线排列推断螺旋的几何读序。

## 分发方式

`glyphs/*.png`（巴别语 58 张、塞壬语 26 张）是上游的字形素材，**不进版本库**
（根目录 `.gitignore` 的 `*.png`），也不进程序包：便携版、Docker 镜像与 APK 都不带它们
（排除规则见 `tools/packaging/package_common.py` 的 `is_cryptic_media`）。

它们随 `.atopack` 资料包的 `crypticFiles` 段分发：素材库导出时写入，导入后落回
`story/assets/cryptic/glyphs/`，Android 端由 `AtopackStore` 解包到 Web 根目录的同一路径
（实现见 `asset-studio/app/cryptic_resources.py`）。**`glyph-catalog.js` 是程序代码**，
随源码发布，不需要随包分发——它同时是内置清单与 APK 名单里字形文件名的来源。

因此新增或改名一张字形时，要同时改 `glyphs/` 里的文件和 `glyph-catalog.js`；只改其一
会让页面引用到不存在的图（收集器与安装侧都只认 `glyphs/` 下合规命名的 `.png`）。
