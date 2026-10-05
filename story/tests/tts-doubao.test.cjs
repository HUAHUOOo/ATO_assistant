// 豆包语音合成（火山引擎同步 HTTP 接口 /api/v1/tts）的请求体、鉴权头与错误映射回归。
// 接口口径见 https://docs.volcengine.com/docs/DoubaoVoice/ （语音合成大模型 → 同步语音合成）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../assets/app.js"), "utf8");

function functionSource(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `missing function ${name}`);
  // 先跳过参数表（默认值里可能有 `{}`），再从函数体的左花括号开始配对。
  let parameters = 0;
  let bodyStart = -1;
  for (let index = source.indexOf("(", start); index < source.length; index += 1) {
    if (source[index] === "(") parameters += 1;
    else if (source[index] === ")") {
      parameters -= 1;
      if (parameters === 0) {
        bodyStart = source.indexOf("{", index);
        break;
      }
    }
  }
  assert.ok(bodyStart > 0, `missing body of ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const DOUBAO_DEFAULTS = {
  endpoint: "https://openspeech.bytedance.com/api/v1/tts",
  appId: "",
  accessToken: "",
  cluster: "volcano_tts",
  voiceType: "zh_female_wanqudashu_moon_bigtts",
  voiceLabel: "湾曲大树",
  encoding: "mp3",
  sampleRate: 24000,
  speedRatio: 1,
  loudnessRatio: 1,
  uid: "ato-assistant",
  timeout: 60000,
};

const FUNCTIONS = [
  "doubaoConfig", "isDoubaoConfigured", "doubaoEndpoint", "doubaoMimeType",
  "doubaoVoiceLabel", "doubaoErrorHint", "doubaoRequestId", "decodeBase64Audio",
  "synthesizeDoubaoOnline", "requestWithTimeout",
];

function setup({ doubao = {}, activeEngine = "cloud", fetchImpl = null, activeSpeechToken = 0 } = {}) {
  const calls = [];
  const context = vm.createContext({
    console,
    Blob,
    Uint8Array,
    atob,
    AbortController,
    defaultTtsConfig: { cloud: { doubao: { ...DOUBAO_DEFAULTS } }, local: {} },
    doubaoApiEndpoint: DOUBAO_DEFAULTS.endpoint,
    doubaoDefaultVoice: DOUBAO_DEFAULTS.voiceType,
    doubaoPresetVoices: [
      { id: "zh_male_qingcang_mars_bigtts", label: "擎苍-有声阅读" },
      { id: "zh_female_wanqudashu_moon_bigtts", label: "湾曲大树" },
    ],
    window: { setTimeout, clearTimeout, crypto: globalThis.crypto },
    ttsConfig: { activeEngine, cloud: { doubao: { ...DOUBAO_DEFAULTS, ...doubao } }, local: {} },
    activeSpeechToken,
    normalizeBaseUrl: () => "https://example.test/v1",
    fetch: (...args) => {
      calls.push(args);
      if (fetchImpl) return fetchImpl(...args);
      return Promise.reject(new Error("fetch 未被预期的测试调用"));
    },
  });
  for (const name of FUNCTIONS) vm.runInContext(functionSource(name), context);
  context.calls = calls;
  return context;
}

function jsonResponse(payload, { status = 200, ok = true } = {}) {
  return Promise.resolve({ ok, status, text: async () => JSON.stringify(payload) });
}

const SAMPLE_BYTES = [0x49, 0x44, 0x33, 0x04, 0x00];
const SAMPLE_BASE64 = Buffer.from(SAMPLE_BYTES).toString("base64");

test("请求体按豆包三段式协议组装，鉴权走 Authorization: Bearer;<token>", async () => {
  const context = setup({
    doubao: {
      appId: "app-123",
      accessToken: "tok-abc",
      voiceType: "zh_male_qingcang_mars_bigtts",
      speedRatio: 1.2,
      loudnessRatio: 0.8,
    },
    fetchImpl: () => jsonResponse({ code: 3000, data: SAMPLE_BASE64 }),
  });

  const blob = await context.synthesizeDoubaoOnline("测试文本", context.ttsConfig.cloud);

  assert.equal(context.calls.length, 1, "应当只发一次请求");
  const [url, options] = context.calls[0];
  assert.equal(url, "https://openspeech.bytedance.com/api/v1/tts");
  assert.equal(options.method, "POST");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.equal(options.headers.Authorization, "Bearer;tok-abc");
  // 令牌绝不能进缓存键（见下面的用例），也不该出现在别的地方。
  const body = JSON.parse(options.body);
  assert.deepEqual(body.app, { appid: "app-123", token: "tok-abc", cluster: "volcano_tts" });
  assert.equal(body.user.uid, "ato-assistant");
  assert.equal(body.audio.voice_type, "zh_male_qingcang_mars_bigtts");
  assert.equal(body.audio.encoding, "mp3");
  assert.equal(body.audio.rate, 24000);
  assert.equal(body.audio.speed_ratio, 1.2);
  assert.equal(body.audio.loudness_ratio, 0.8);
  assert.equal(body.request.text, "测试文本");
  assert.equal(body.request.operation, "query");
  assert.match(body.request.reqid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  assert.equal(blob.type, "audio/mpeg");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], SAMPLE_BYTES);
});

test("wav 格式回 audio/wav，未配置账号直接报错且不发请求", async () => {
  const wav = setup({
    doubao: { appId: "a", accessToken: "t", encoding: "wav" },
    fetchImpl: () => jsonResponse({ code: 3000, data: SAMPLE_BASE64 }),
  });
  const blob = await wav.synthesizeDoubaoOnline("正文", wav.ttsConfig.cloud);
  assert.equal(blob.type, "audio/wav");

  const unconfigured = setup({ doubao: { appId: "a" } });
  await assert.rejects(
    () => unconfigured.synthesizeDoubaoOnline("正文", unconfigured.ttsConfig.cloud),
    /未配置 App ID \/ Access Token/,
  );
  assert.equal(unconfigured.calls.length, 0, "账号不全时不应该发请求");
});

test("接口地址与超时可以用配置覆盖，默认值来自配置合并", async () => {
  const context = setup({
    doubao: { appId: "a", accessToken: "t", endpoint: "https://proxy.test/tts", timeout: 1234 },
    fetchImpl: () => jsonResponse({ code: 3000, data: SAMPLE_BASE64 }),
  });
  await context.synthesizeDoubaoOnline("正文", context.ttsConfig.cloud);
  assert.equal(context.calls[0][0], "https://proxy.test/tts");

  // 只存了部分字段（老配置 / 手工导入）时，其余字段回落到默认值。
  const merged = context.doubaoConfig({ doubao: { appId: "a", accessToken: "t" } });
  assert.equal(merged.endpoint, DOUBAO_DEFAULTS.endpoint);
  assert.equal(merged.cluster, "volcano_tts");
  assert.equal(merged.sampleRate, 24000);
  assert.equal(context.doubaoEndpoint({}), DOUBAO_DEFAULTS.endpoint);
});

test("错误码带出原始 code/message 并补提示", async () => {
  const cases = [
    [{ code: 3001, message: "invalid request" }, /豆包错误 3001：invalid request（请求无效/],
    [{ code: 3003, message: "qps limit" }, /豆包错误 3003：qps limit（并发\/QPS 超限/],
    [{ code: 3005, message: "internal error" }, /豆包错误 3005：internal error（服务内部错误/],
    [{ code: 3010, message: "text too long" }, /豆包错误 3010：text too long（文本超过接口上限/],
    [{ code: 4003, message: "no permission" }, /豆包错误 4003：no permission（音色未授权/],
    [{ code: 4001, message: "bad token" }, /豆包错误 4001：bad token（鉴权失败/],
  ];
  for (const [payload, pattern] of cases) {
    const context = setup({
      doubao: { appId: "a", accessToken: "t" },
      fetchImpl: () => jsonResponse(payload, { status: 200, ok: true }),
    });
    await assert.rejects(
      () => context.synthesizeDoubaoOnline("正文", context.ttsConfig.cloud),
      pattern,
    );
  }
});

test("HTTP 失败与非 JSON 响应都有可读报错", async () => {
  const http500 = setup({
    doubao: { appId: "a", accessToken: "t" },
    fetchImpl: () => Promise.resolve({ ok: false, status: 500, text: async () => "boom" }),
  });
  await assert.rejects(
    () => http500.synthesizeDoubaoOnline("正文", http500.ttsConfig.cloud),
    /豆包 HTTP 500：boom/,
  );

  const notJson = setup({
    doubao: { appId: "a", accessToken: "t" },
    fetchImpl: () => Promise.resolve({ ok: true, status: 200, text: async () => "<html>502</html>" }),
  });
  await assert.rejects(
    () => notJson.synthesizeDoubaoOnline("正文", notJson.ttsConfig.cloud),
    /豆包 HTTP 200：<html>502<\/html>/,
  );

  // 跨域被拦时 fetch 只抛 TypeError，提示要落到「跨域」上。
  const blocked = setup({
    doubao: { appId: "a", accessToken: "t" },
    fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")),
  });
  await assert.rejects(
    () => blocked.synthesizeDoubaoOnline("正文", blocked.ttsConfig.cloud),
    /豆包请求失败：Failed to fetch（若为跨域失败/,
  );
});

test("code=3000 但缺音频数据时报错", async () => {
  const context = setup({
    doubao: { appId: "a", accessToken: "t" },
    fetchImpl: () => jsonResponse({ code: 3000, message: "ok" }),
  });
  await assert.rejects(
    () => context.synthesizeDoubaoOnline("正文", context.ttsConfig.cloud),
    /豆包响应中没有音频数据/,
  );
});

test("语音合成与预取都按服务商分派到豆包，缓存键带上音色且不含令牌", async () => {
  const context = setup({ doubao: { appId: "a", accessToken: "secret-token" } });
  context.cloudProvider = () => "doubao";
  context.isXfyunConfigured = () => false;
  context.speakWithXfyun = () => { throw new Error("不应该走到讯飞"); };
  context.speakWithDoubao = (text, token, conf, options) => {
    context.routed = { text, token, engineType: "cloud", options };
    return Promise.resolve(true);
  };
  context.synthesizeDoubaoOnline = (text) => { context.prefetched = text; return Promise.resolve(new Blob(["x"])); };
  vm.runInContext(functionSource("speakWithExternal"), context);
  vm.runInContext(functionSource("fetchExternalAudio"), context);
  vm.runInContext(functionSource("externalAudioCacheKey"), context);

  const cloud = context.ttsConfig.cloud;
  await context.speakWithExternal("正文", 7, "cloud", cloud);
  assert.equal(context.routed.text, "正文");
  assert.equal(context.routed.token, 7);

  const blob = await context.fetchExternalAudio("预取正文", null, "cloud", cloud);
  assert.ok(blob instanceof Blob);
  assert.equal(context.prefetched, "预取正文");

  const key = context.externalAudioCacheKey("同一段正文");
  assert.ok(key.startsWith(`cloud\u001fdoubao\u001f${DOUBAO_DEFAULTS.endpoint}\u001f`), `缓存键前缀不对：${key}`);
  assert.ok(key.includes(DOUBAO_DEFAULTS.voiceType), "缓存键要带上音色，换音色不能复用旧音频");
  assert.ok(key.endsWith("\u001f同一段正文"));
  assert.ok(!key.includes("secret-token"), "缓存键不能包含 Access Token");

  context.ttsConfig.cloud.doubao.voiceType = "zh_male_qingcang_mars_bigtts";
  assert.notEqual(context.externalAudioCacheKey("同一段正文"), key);
});
