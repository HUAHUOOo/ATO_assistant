# 故事书朗读新增豆包语音合成（火山引擎）引擎

日期：2026年10月5日。工作目录：`D:\desktop\ATO_assistant`。

用户要求：「故事书朗读部分增加豆包api的选择」，并给出文档链接 `https://docs.volcengine.com/docs/DoubaoVoice/audio-generation-http`。经确认，实际接入的是文档同章节下的**同步语音合成**接口（`POST https://openspeech.bytedance.com/api/v1/tts`，`voice_type` 选音色），并且**走浏览器直连**，与既有 MIMO / 讯飞一致，不新增服务端代理（Android APK 里没有 PHP）。

## 做了什么

朗读引擎配置弹窗的「云端 API → 服务商」新增第三项 **豆包语音合成（火山引擎）**，与 MIMO、讯飞三选一，各自的配置区互斥显示：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| App ID / Access Token | 空 | 控制台「语音合成大模型」里的账号；鉴权头是 `Authorization: Bearer;<Access Token>`（分号是火山引擎的老写法） |
| Cluster | `volcano_tts` | 请求体 `app.cluster` |
| 音色 voice_type | `zh_female_wanqudashu_moon_bigtts` | 输入框带 14 个常用大模型音色的 datalist（含擎苍-有声阅读、湾曲大树、温暖阿虎等），控制台开通了别的音色可直接改写 |
| 音频格式 | `mp3` | 下拉 mp3 / wav / ogg_opus，决定 Blob 的 MIME |
| 采样率 / 语速倍率 / 音量倍率 | 24000 / 1 / 1 | 对应 `audio.rate` / `speed_ratio` / `loudness_ratio` |
| 接口地址 | `https://openspeech.bytedance.com/api/v1/tts` | 可改，便于指向自建反代；跨域被拦时这是唯一的绕法 |
| 超时 ms | 60000 | |

请求体按官方三段式组装：`app{appid,token,cluster}` + `user{uid}` + `audio{voice_type,encoding,rate,speed_ratio,loudness_ratio}` + `request{reqid,text,operation:"query"}`；`reqid` 是自拼的 v4 UUID（局域网明文 HTTP 下没有 `crypto.randomUUID`，和讯飞签名那处是同一个坑）。响应 `code=3000` 时取 `data` 的 base64 音频播放，其它错误码照原样带出并补一句提示（3001 请求无效、3003 并发超限、3005 服务内部错误、3010 文本超长、4003 音色未授权、4001/401 鉴权失败）。`fetch` 被跨域拦下时只有 `TypeError`，单独提示「若为跨域失败」。

豆包和 MIMO、讯飞一样进入既有的分句朗读、预取（前 5 句）、跳转预热与音频缓存；缓存键按「接口地址 + App ID + Cluster + 音色 + 格式 + 采样率 + 语速 + 音量 + 文本」区分，**不含 Access Token**。「试听所有音色」会把 14 个预设音色逐个试听，结束后还原原音色。

## 程序改动

- `story/assets/app.js`：新增 `doubaoPresetVoices` / `doubaoEncodings` / `doubaoApiEndpoint` 与 `defaultTtsConfig.cloud.doubao`；新增 `doubaoConfig`、`isDoubaoConfigured`、`doubaoEndpoint`、`doubaoMimeType`、`doubaoVoiceLabel`、`doubaoErrorHint`、`doubaoRequestId`、`synthesizeDoubaoOnline`、`speakWithDoubao`；在 `getEngineStatusLabel`、`speakWithExternal`、`fetchExternalAudio`、`externalAudioCacheKey`、`previewCloudVoices`、`syncVoiceSelect`、朗读音色切换里各加一条豆包分支；弹窗新增 `#ttsDoubaoFields` 分组，服务商切换同时管三块配置区和两个克隆音色按钮。
- `story/index.html`：`app.js` 缓存参数提到 `?v=20261005-doubao-tts1`（只有这一个文件改了）。
- `story/tests/tts-modal-layout.test.cjs`：字段清单补 12 个豆包 id；隐藏状态用例从「MIMO/讯飞」两态改成三个服务商互斥的三态。
- `story/tests/tts-doubao.test.cjs`（新增 7 项）：请求体与鉴权头逐字段核对、`reqid` 是 v4 UUID、mp3/wav 的 Blob 类型与字节、未配置账号不发请求、部分配置回落默认值、6 个错误码的原始 code/message 与提示、HTTP 500 与非 JSON 响应、跨域 `TypeError` 的提示、`code=3000` 缺音频、`speakWithExternal`/`fetchExternalAudio` 按服务商分派到豆包、缓存键带音色且不含令牌。

## 验证

- `node --test --test-isolation=none story/tests/*.test.cjs` → **91 项通过、0 失败**（基线 84 项 + 新增 7 项）。
- `node --check story/assets/app.js` 通过。
- **未做真机/浏览器验证**：手上没有豆包 App ID 与 Access Token，无法确认 openspeech 是否会给浏览器返回 CORS 响应头。若被拦，状态栏会明确报出跨域失败，并回退浏览器原生语音；此时把「接口地址」改成自建反代即可（Android APK 没有 PHP，所以没有内置服务端代理）。

## 相关文件哈希（SHA-256）

- `story/assets/app.js`：`5bf2b0f7098f688dfc93a58e7244c336c7c058bcf8076195b8cde11bde39b85f`
- `story/index.html`：`d7e56dede9ef06eab14ebd66f3cd8105ee61554886656018584de89f5bc2b5ea`
- `story/tests/tts-modal-layout.test.cjs`：`e7d63d8995bc636771bc04ae18b8c61be3c18a44bf1d8d65e442b7a2c6826b5d`
- `story/tests/tts-doubao.test.cjs`（新增）：`6a5b629433064015ce865378f480a322134ba08919f2d28d52f1405ec5d76440`
