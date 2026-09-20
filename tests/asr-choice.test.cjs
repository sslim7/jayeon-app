/**
 * 등록 시트의 「로컬 받아쓰기」 체크박스가 어떤 모습이어야 하는가(→ `src/lib/asr-choice.ts`).
 *
 * 🔴 **가장 중요한 한 줄은 「웹에서는 아예 없다」다.** 웹에는 whisper 가 없어서, 그 칸이
 * 서는 순간 사용자는 눌러도 아무 일이 없는 체크박스를 보게 된다.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const realms = { Error, Set, Map, JSON, Date, Number, Math, RegExp, String, Object, Array };
// 판정 규칙은 **실제 구현을 그대로 쓴다.** 두 곳이 서로 다르게 판단하기 시작하면
// 「왜 체크가 안 켜지지」를 화면만 봐서는 알 수 없다.
const types = { exports: {} };
vm.runInNewContext(`(function(exports){${compile('src/lib/asr-capability-types.ts')}\n})`, { ...realms })(types.exports);

const mod = { exports: {} };
vm.runInNewContext(`(function(exports,require){${compile('src/lib/asr-choice.ts')}\n})`, { ...realms })(mod.exports, name => {
  if (name === './asr-capability-types') return types.exports;
  throw new Error(`unmocked ${name}`);
});
const { asrChoice, ASR_SETUP_PATH } = mod.exports;
const { buildAsrCapability } = types.exports;

const soc = (extra = {}) => ({ manufacturer: '', model: '', hardware: '', board: '', ...extra });
const SNAPDRAGON = soc({ manufacturer: 'QTI', model: 'SM8650' });
const EXYNOS = soc({ manufacturer: 'Samsung', model: 'S5E9925' });

const capability = (reason, id = 'q8_0', encodeMs = null) =>
  buildAsrCapability({ reason, modelId: id, soc: SNAPDRAGON, encodeMs, now: 0, appVersion: '0.1.0' });

/** 깔려 있고, 재 봤고, 그 판정이 아직 쓸 만한 모델 하나. */
const usable = (id = 'q8_0') => ({ id, installed: true, capability: capability('OK', id, 2354), fresh: true });

const native = (facts) => ({ platform: 'android', nativeAvailable: true, soc: SNAPDRAGON, facts });

test('웹에서는 체크박스가 아예 서지 않는다', () => {
  // 🔴 모델이 깔려 있고 판정이 「사용 가능」이어도 마찬가지다 — 웹에는 whisper 가 없다.
  for (const facts of [null, [], [usable()]]) {
    const choice = asrChoice({ platform: 'web', nativeAvailable: false, soc: null, facts });
    assert.equal(choice.visible, false, '웹에서는 보이면 안 된다');
    assert.equal(choice.checked, false);
    assert.equal(choice.enabled, false);
    assert.equal(choice.modelId, null);
    // 보이지 않는 칸에 설명을 달아 둘 이유가 없다.
    assert.equal(choice.reason, '');
  }
  // 네이티브 모듈이 있다고 우겨도 웹이면 결론은 같다.
  assert.equal(asrChoice({ platform: 'web', nativeAvailable: true, soc: SNAPDRAGON, facts: [usable()] }).visible, false);
});

test('아직 읽는 중에는 보이되 켜지 않는다', () => {
  // 🔴 미리 켜 두면 「불가」가 돌아오는 순간 체크가 저절로 풀린다 — 사용자는 끈 적 없는 것이 꺼진 것을 본다.
  const choice = asrChoice(native(null));
  assert.equal(choice.visible, true);
  assert.equal(choice.pending, true);
  assert.equal(choice.enabled, false);
  assert.equal(choice.checked, false);
  assert.match(choice.reason, /확인하는 중/);
});

test('쓸 수 있으면 기본으로 켜지고 쓸 모델이 정해진다', () => {
  const choice = asrChoice(native([usable('q8_0'), { id: 'q5_0', installed: false, capability: null, fresh: false }]));
  assert.equal(choice.visible, true);
  assert.equal(choice.enabled, true);
  assert.equal(choice.checked, true);
  assert.equal(choice.modelId, 'q8_0');
  assert.equal(choice.setupPath, null);
  // 판정이 알려 준 예상 시간이 그대로 붙는다.
  assert.match(choice.reason, /28분 통화에 약/);
});

test('NPU 가 없는 AP 는 내려받아도 답이 안 바뀌므로 설정으로 보내지 않는다', () => {
  const choice = asrChoice({ platform: 'android', nativeAvailable: true, soc: EXYNOS, facts: [] });
  assert.equal(choice.visible, true);
  assert.equal(choice.enabled, false);
  assert.equal(choice.checked, false);
  assert.match(choice.reason, /NPU 지원되는 폰만 로컬 받아쓰기 가능해요/);
  // 🔴 834MB 를 받게 한 뒤에 같은 「안 됩니다」를 다시 듣게 하면 안 된다.
  assert.equal(choice.setupPath, null);
});

test('모델이 없으면 설정에서 받으라고 안내한다', () => {
  const choice = asrChoice(native([
    { id: 'q8_0', installed: false, capability: null, fresh: false },
    { id: 'q5_0', installed: false, capability: null, fresh: false },
  ]));
  assert.equal(choice.enabled, false);
  assert.equal(choice.setupPath, ASR_SETUP_PATH);
  assert.equal(ASR_SETUP_PATH, '/asr-setup');
  assert.match(choice.reason, /내려받/);
});

test('깔려 있는데 재 본 적이 없으면 「안 된다」가 아니라 「아직 모른다」로 말한다', () => {
  // ⚠️ 여기서 재면 시트가 20초 멈춘다. 재는 일은 설정 화면 몫이다.
  const choice = asrChoice(native([{ id: 'q8_0', installed: true, capability: null, fresh: false }]));
  assert.equal(choice.enabled, false);
  assert.equal(choice.checked, false);
  assert.match(choice.reason, /아직 재 보지 않았어요/);
  assert.equal(choice.setupPath, ASR_SETUP_PATH);
  assert.doesNotMatch(choice.reason, /지원되지 않/);

  // 앱이 업데이트돼 옛 판정을 못 쓰게 된 경우도 같다 — 옛 숫자는 이 앱의 숫자가 아니다.
  const stale = asrChoice(native([{ id: 'q8_0', installed: true, capability: capability('OK', 'q8_0', 2354), fresh: false }]));
  assert.equal(stale.enabled, false);
  assert.match(stale.reason, /아직 재 보지 않았어요/);
});

test('모델을 지우면 옛 「사용 가능」 판정으로 켜지지 않는다', () => {
  // 🔴 판정만 보고 켜면, 모델을 지운 뒤에도 영원히 「쓸 수 있다」고 말하게 된다.
  const choice = asrChoice(native([{ id: 'q8_0', installed: false, capability: capability('OK', 'q8_0', 2354), fresh: true }]));
  assert.equal(choice.enabled, false);
  assert.equal(choice.setupPath, ASR_SETUP_PATH);
});

test('재 봤더니 느린 기기에는 예상 시간과 함께 이유를 말한다', () => {
  const slow = { id: 'q8_0', installed: true, capability: capability('SLOW', 'q8_0', 9000), fresh: true };
  const choice = asrChoice(native([slow]));
  assert.equal(choice.enabled, false);
  assert.match(choice.reason, /NPU 지원되는 폰만/);
  assert.match(choice.reason, /28분 통화에 약/);
  // 내려받을 것이 없다 — 이미 깔려 있고, 느린 것은 기기 쪽 사실이다.
  assert.equal(choice.setupPath, null);
});

test('되는 모델이 하나라도 있으면 그것을 쓴다', () => {
  const choice = asrChoice(native([
    { id: 'q8_0', installed: true, capability: capability('SLOW', 'q8_0', 9000), fresh: true },
    usable('q5_0'),
  ]));
  assert.equal(choice.enabled, true);
  assert.equal(choice.checked, true);
  assert.equal(choice.modelId, 'q5_0');
});

test('네이티브 모듈이 없는 옛 껍데기에는 앱을 업데이트하라고 말한다', () => {
  const choice = asrChoice({ platform: 'android', nativeAvailable: false, soc: null, facts: [] });
  assert.equal(choice.visible, true);
  assert.equal(choice.enabled, false);
  assert.match(choice.reason, /업데이트/);
  assert.equal(choice.setupPath, null);
});

test('iOS 에서는 AP 문자열이 비어 있어도 막지 않는다', () => {
  // 🔴 Hexagon 판정은 안드로이드에만 해당한다. iOS 는 Metal 경로다.
  const choice = asrChoice({ platform: 'ios', nativeAvailable: true, soc: null, facts: [usable('q8_0')] });
  assert.equal(choice.enabled, true);
  assert.equal(choice.modelId, 'q8_0');
});
