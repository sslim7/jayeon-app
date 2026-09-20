const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module_ = { exports: {} };
vm.runInNewContext(`(function(exports){${compile('src/lib/asr-capability-types.ts')}\n})`, { Error, JSON, Date, Number, Math, RegExp, String, Object, Array })(module_.exports);
const {
  socVerdict, preBenchReason, benchReason, buildAsrCapability, estimateAsrMs, isFreshCapability, isAsrCapability,
  asrDurationLabel, ASR_ENCODE_LIMIT_MS, ASR_SLOWDOWN, ASR_REFERENCE_CALL_MS,
} = module_.exports;

const soc = (extra = {}) => ({ manufacturer: '', model: '', hardware: '', board: '', ...extra });

test('AP 판정은 제조사 문자열이 있으면 그 한 값으로 끝난다', () => {
  // 🔴 기기 이름이 아니라 SOC_MANUFACTURER 로 본다. 「Z 폴드는 전부 스냅드래곤」으로 한 번 틀렸다.
  assert.equal(socVerdict(soc({ manufacturer: 'QUALCOMM', model: 'SM8650' })), 'snapdragon');
  // 퀄컴은 기기에 따라 QTI 로 적힌다.
  assert.equal(socVerdict(soc({ manufacturer: 'QTI', model: 'SM8550' })), 'snapdragon');
  // 제조사가 적혀 있는데 퀄컴이 아니면 Hexagon NPU 가 없다 — 보드 이름을 더 볼 이유가 없다.
  assert.equal(socVerdict(soc({ manufacturer: 'Samsung', model: 'S5E9925' })), 'other');
  assert.equal(socVerdict(soc({ manufacturer: 'Mediatek', model: 'MT6983' })), 'other');
  assert.equal(socVerdict(soc({ manufacturer: 'Google', model: 'Tensor G3' })), 'other');
});

test('제조사를 모르는 구버전은 보드·하드웨어 이름으로 대신 짚는다', () => {
  // API 30 이하에는 SOC_MANUFACTURER 자체가 없다.
  assert.equal(socVerdict(soc({ hardware: 'qcom', board: 'kona' })), 'snapdragon');
  assert.equal(socVerdict(soc({ board: 'sm8250' })), 'snapdragon');
  assert.equal(socVerdict(soc({ hardware: 'exynos9820', board: 'exynos9820' })), 'other');
  assert.equal(socVerdict(soc({ hardware: 'mt6785', board: 'mt6785' })), 'other');
  // 값이 UNKNOWN 으로 오는 기기가 있다. 그건 「적혀 있다」가 아니다.
  assert.equal(socVerdict(soc({ manufacturer: 'unknown', hardware: 'qcom' })), 'snapdragon');
  // 🔴 모르는 것은 「아니다」가 아니다. 여기서 막으면 멀쩡한 구형 스냅드래곤이 배제된다.
  assert.equal(socVerdict(soc()), 'unknown');
  assert.equal(socVerdict(null), 'unknown');
});

test('스냅드래곤이 아니면 벤치를 돌리기도 전에 불가다', () => {
  const facts = { platform: 'android', nativeAvailable: true, modelInstalled: true };
  // ⚠️ 엑시노스·미디어텍은 예외 없이 **조용히 CPU 로** 내려간다. 28분이 33분~3시간이 된다.
  assert.equal(preBenchReason({ ...facts, soc: soc({ manufacturer: 'Samsung' }) }), 'NOT_SNAPDRAGON');
  assert.equal(preBenchReason({ ...facts, soc: soc({ board: 'exynos2200' }) }), 'NOT_SNAPDRAGON');
  // 퀄컴이거나 모르면 여기서 결론 내지 않고 **실측**으로 넘어간다.
  assert.equal(preBenchReason({ ...facts, soc: soc({ manufacturer: 'QTI' }) }), null);
  assert.equal(preBenchReason({ ...facts, soc: null }), null);
  // 🔴 AP 판정은 안드로이드만이다. iOS 는 Metal 경로라 Hexagon 여부가 의미 없다.
  assert.equal(preBenchReason({ ...facts, platform: 'ios', soc: soc({ manufacturer: 'Apple' }) }), null);
});

test('웹·옛 껍데기·모델 없음은 각각 다른 이유로 걸린다', () => {
  const facts = { soc: null, modelInstalled: true };
  assert.equal(preBenchReason({ ...facts, platform: 'web', nativeAvailable: false }), 'WEB');
  assert.equal(preBenchReason({ ...facts, platform: 'android', nativeAvailable: false }), 'NO_NATIVE');
  // 모델이 없으면 「불가」가 아니라 「아직 모른다」다.
  assert.equal(preBenchReason({ platform: 'ios', nativeAvailable: true, soc: null, modelInstalled: false }), 'MODEL_MISSING');
});

test('인코더 4,000ms 가 경계다', () => {
  assert.equal(ASR_ENCODE_LIMIT_MS, 4_000);
  assert.equal(benchReason(2_354), 'OK');   // 아이폰 15 Pro 실측
  assert.equal(benchReason(4_000), 'OK');   // 경계는 통과
  assert.equal(benchReason(4_001), 'SLOW');
  assert.equal(benchReason(34_000), 'SLOW'); // CPU 폴백 실측값(28분 통화에 33분)
  // 잴 수 없었던 값으로 「된다」고 말하지 않는다.
  assert.equal(benchReason(0), 'SLOW');
  assert.equal(benchReason(Number.NaN), 'SLOW');
});

test('28분 예상 시간은 실측 기준점을 그대로 재현한다', () => {
  // 🔴 아이폰 15 Pro: 인코더 2,354ms → 실제 7분 18초. 환산식은 이 한 쌍에서 나온다.
  assert.equal(estimateAsrMs(2_354), 438_000);
  assert.equal(asrDurationLabel(438_000), '7분 18초');
  // 순진한 「인코더 × 창 개수」는 이만큼 낙관적이다.
  const naive = 2_354 * (ASR_REFERENCE_CALL_MS / 30_000);
  assert.ok(ASR_SLOWDOWN > 3.2 && ASR_SLOWDOWN < 3.35, `보정 계수: ${ASR_SLOWDOWN}`);
  assert.equal(Math.round(438_000 / naive * 100), Math.round(ASR_SLOWDOWN * 100));
  // 임계값과도 들어맞는다: 4,000ms 면 28분 통화에 12분을 넘는다.
  assert.ok(estimateAsrMs(ASR_ENCODE_LIMIT_MS) > 720_000);
  assert.ok(estimateAsrMs(ASR_ENCODE_LIMIT_MS) < 780_000);
  // 길이를 모르거나 못 쟀으면 0 이다 — 지어내지 않는다.
  assert.equal(estimateAsrMs(0), 0);
  assert.equal(estimateAsrMs(2_354, 0), 0);
  // 절반 길이 통화는 절반 시간.
  assert.equal(estimateAsrMs(2_354, ASR_REFERENCE_CALL_MS / 2), 219_000);
});

test('통과한 판정에는 예상 시간이 문장으로 함께 담긴다', () => {
  const capability = buildAsrCapability({
    reason: benchReason(2_354), modelId: 'q8_0', soc: soc({ manufacturer: 'QTI', model: 'SM8650' }),
    encodeMs: 2_354, benchConfig: 'HEXAGON', gpu: true, threads: 4, now: 1_000, appVersion: '0.1.0',
  });
  assert.equal(capability.ok, true);
  assert.equal(capability.reason, 'OK');
  assert.equal(capability.estimateMs, 438_000);
  // 🔴 「됩니다」만 말하지 않는다. 얼마나 걸리는지를 같이 말한다.
  assert.ok(capability.message.includes('7분 18초'), capability.message);
  assert.equal(capability.benchConfig, 'HEXAGON');
  assert.equal(capability.gpu, true);
});

test('불가한 판정도 왜, 그리고 얼마나 걸리는지를 말한다', () => {
  const slow = buildAsrCapability({
    reason: benchReason(12_000), modelId: 'q8_0', soc: null, encodeMs: 12_000, now: 1, appVersion: '0.1.0',
  });
  assert.equal(slow.ok, false);
  assert.equal(slow.reason, 'SLOW');
  // 🔴 「안 됩니다」만 말하면 사용자는 앱을 의심한다.
  assert.ok(slow.message.includes(asrDurationLabel(slow.estimateMs)), slow.message);
  assert.ok(slow.message.includes('서버'), slow.message);

  const wrongSoc = buildAsrCapability({
    reason: 'NOT_SNAPDRAGON', modelId: 'q8_0', soc: soc({ manufacturer: 'Samsung', model: 'S5E9945' }),
    encodeMs: null, now: 1, appVersion: '0.1.0',
  });
  assert.equal(wrongSoc.ok, false);
  // 재지 못했으면 예상 시간은 null 이다 — 0 으로 채우지 않는다.
  assert.equal(wrongSoc.estimateMs, null);
  assert.ok(wrongSoc.message.includes('Samsung S5E9945'), wrongSoc.message);
  assert.ok(wrongSoc.message.includes('NPU'), wrongSoc.message);
});

test('저장된 판정은 같은 모델·같은 앱 버전일 때만 다시 쓴다', () => {
  const saved = buildAsrCapability({ reason: 'OK', modelId: 'q8_0', soc: null, encodeMs: 2_354, now: 1, appVersion: '0.1.0' });
  assert.equal(isFreshCapability(saved, 'q8_0', '0.1.0'), true);
  // ⚠️ 모델이 바뀌면 백엔드·양자화가 함께 바뀐다. 옛 숫자는 이 모델의 숫자가 아니다.
  assert.equal(isFreshCapability(saved, 'q5_0', '0.1.0'), false);
  assert.equal(isFreshCapability(saved, 'q8_0', '0.2.0'), false);
  assert.equal(isFreshCapability(null, 'q8_0', '0.1.0'), false);
  assert.equal(isFreshCapability({ ...saved, version: 0 }, 'q8_0', '0.1.0'), false);
  // 🔴 「아직 모른다」를 캐시하면 모델을 받은 뒤에도 영원히 「모델이 없다」고 말한다.
  assert.equal(isFreshCapability({ ...saved, reason: 'MODEL_MISSING' }, 'q8_0', '0.1.0'), false);
  assert.equal(isFreshCapability({ ...saved, reason: 'ERROR' }, 'q8_0', '0.1.0'), false);
  // 불가 판정은 다시 써도 된다 — 20초를 또 쓸 이유가 없다.
  assert.equal(isFreshCapability({ ...saved, reason: 'SLOW', ok: false }, 'q8_0', '0.1.0'), true);
});

test('깨진 저장 파일로 판정을 흉내 내지 않는다', () => {
  assert.equal(isAsrCapability(null), false);
  assert.equal(isAsrCapability({}), false);
  assert.equal(isAsrCapability({ version: 1, ok: true }), false);
  assert.equal(isAsrCapability(buildAsrCapability({ reason: 'OK', modelId: 'q8_0', soc: null, encodeMs: 2_354, now: 1, appVersion: '0.1.0' })), true);
});
