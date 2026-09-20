/**
 * 남은 시간 추정 — **거짓말하지 않는지**를 본다.
 *
 * 🔴 여기서 지키려는 것은 「정확한 초」가 아니다. ① 실측이 있으면 실측이 이기고 ② 발열로
 * 느려진 지금을 따라가고 ③ 멈춰 있던 시간이 표본에 섞이지 않고 ④ 모르면 아무 말도 하지
 * 않는다 — 넷 중 하나라도 깨지면 화면의 숫자가 사용자를 속인다.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const realms = { Error, Set, Map, JSON, Date, Number, Math, RegExp, String, Promise, Array, Object };
const load = (file, mocks = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports,require){${compile(file)}\n})`, { ...realms })(module.exports, name => {
    if (!(name in mocks)) throw new Error(`unmocked ${name}`);
    return mocks[name];
  });
  return module.exports;
};

// 🔴 의존하는 두 모듈도 **실제 구현**을 태운다. `estimateAsrMs` 를 가짜로 바꾸면 「판정으로
// 떨어지는가」를 검사한다면서 정작 그 환산식은 한 번도 돌지 않는다.
const localTypes = load('src/lib/asr-local-types.ts');
const capabilityTypes = load('src/lib/asr-capability-types.ts');
const { ASR_CHUNK_MS } = localTypes;
const { estimateAsrMs, ASR_REFERENCE_CALL_MS } = capabilityTypes;
const { ASR_ETA_WINDOW, asrEta, asrEtaSample, asrRemainingMs } = load('src/lib/asr-eta.ts', {
  './asr-local-types': localTypes,
  './asr-capability-types': capabilityTypes,
});

/** 아이폰 15 Pro 실측 인코더 시간. 환산식의 기준점이다. */
const ENCODE_MS = 2_354;
/** 28분 26초. 120초 14개 + 26초 1개 = 15청크. */
const TOTAL = ASR_REFERENCE_CALL_MS;

const sample = (index, elapsedMs, extra = {}) => ({ index, audioMs: ASR_CHUNK_MS, elapsedMs, paused: false, ...extra });

// ── ① 아직 아무 청크도 안 끝났을 때 ────────────────────────────────────────────
test('끝난 청크가 없으면 저장된 판정으로 어림한다', () => {
  const eta = asrEta({ samples: [], remainingMs: TOTAL, encodeMs: ENCODE_MS });
  assert.equal(eta.source, 'estimate');
  assert.equal(eta.remainingMs, estimateAsrMs(ENCODE_MS, TOTAL));
  // 실기기 실측이 7분 18초였다. 환산식이 그 근처에 있어야 의미가 있다.
  assert.ok(Math.abs(eta.remainingMs - 438_000) < 30_000, `${eta.remainingMs}`);
});

test('판정 기반 추정은 남은 길이에 비례해 줄어든다', () => {
  const full = asrEta({ samples: [], remainingMs: TOTAL, encodeMs: ENCODE_MS });
  const half = asrEta({ samples: [], remainingMs: TOTAL / 2, encodeMs: ENCODE_MS });
  assert.equal(half.source, 'estimate');
  assert.ok(Math.abs(half.remainingMs - full.remainingMs / 2) <= 1);
});

// ── ② 청크가 끝난 뒤 ──────────────────────────────────────────────────────────
test('청크가 하나라도 끝나면 실측이 판정을 이긴다', () => {
  // 판정은 청크당 약 30초라고 말하지만, 이 폰은 실제로 60초씩 쓰고 있다.
  const eta = asrEta({ samples: [sample(0, 60_000)], remainingMs: ASR_CHUNK_MS * 10, encodeMs: ENCODE_MS });
  assert.equal(eta.source, 'measured');
  assert.equal(eta.remainingMs, 600_000);
});

test('판정이 없어도 실측만으로 답한다', () => {
  const eta = asrEta({ samples: [sample(0, 30_000), sample(1, 30_000)], remainingMs: ASR_CHUNK_MS * 4, encodeMs: null });
  assert.equal(eta.source, 'measured');
  assert.equal(eta.remainingMs, 120_000);
});

// ── ③ 최근 것만 본다 ─────────────────────────────────────────────────────────
test('앞이 빠르고 뒤가 느려지면 추정은 느린 쪽을 따라간다', () => {
  // 발열 전 20초짜리 다섯 개, 발열 뒤 40초짜리 세 개.
  const samples = [
    sample(0, 20_000), sample(1, 20_000), sample(2, 20_000), sample(3, 20_000), sample(4, 20_000),
    sample(5, 40_000), sample(6, 40_000), sample(7, 40_000),
  ];
  const eta = asrEta({ samples, remainingMs: ASR_CHUNK_MS * 5, encodeMs: ENCODE_MS });
  // 전체 평균이면 27.5초 × 5 = 137.5초로 낙관적이다. 최근 3개면 40초 × 5 = 200초.
  assert.equal(eta.remainingMs, 200_000);
});

test('최근 창은 ASR_ETA_WINDOW 개다', () => {
  assert.equal(ASR_ETA_WINDOW, 3);
  const samples = [sample(0, 1), sample(1, 1), sample(2, 30_000), sample(3, 30_000), sample(4, 30_000)];
  const eta = asrEta({ samples, remainingMs: ASR_CHUNK_MS, encodeMs: null });
  assert.equal(eta.remainingMs, 30_000);
});

// ── ④ 멈춰 있던 청크 ─────────────────────────────────────────────────────────
test('백그라운드가 낀 청크는 표본에서 빠진다', () => {
  // 청크 1 은 통화를 받느라 4분 동안 얼어 있었다. 그 값이 섞이면 추정이 8배로 부푼다.
  const samples = [sample(0, 30_000), sample(1, 240_000, { paused: true }), sample(2, 30_000)];
  const eta = asrEta({ samples, remainingMs: ASR_CHUNK_MS * 3, encodeMs: null });
  assert.equal(eta.source, 'measured');
  assert.equal(eta.remainingMs, 90_000);
});

test('쓸 수 있는 표본이 창보다 적으면 있는 것만 쓴다', () => {
  const samples = [sample(0, 240_000, { paused: true }), sample(1, 240_000, { paused: true }), sample(2, 45_000)];
  const eta = asrEta({ samples, remainingMs: ASR_CHUNK_MS * 2, encodeMs: null });
  assert.equal(eta.remainingMs, 90_000);
});

test('표본이 전부 백그라운드면 판정으로 돌아간다', () => {
  const samples = [sample(0, 240_000, { paused: true })];
  const eta = asrEta({ samples, remainingMs: TOTAL, encodeMs: ENCODE_MS });
  assert.equal(eta.source, 'estimate');
  assert.equal(eta.remainingMs, estimateAsrMs(ENCODE_MS, TOTAL));
});

// ── ⑤ 모르면 아무 말도 하지 않는다 ────────────────────────────────────────────
test('판정도 없고 끝난 청크도 없으면 null 이다', () => {
  assert.equal(asrEta({ samples: [], remainingMs: TOTAL, encodeMs: null }), null);
});

test('쓸 수 없는 표본과 잴 수 없는 판정도 null 이다', () => {
  assert.equal(asrEta({ samples: [sample(0, 30_000, { paused: true })], remainingMs: TOTAL, encodeMs: 0 }), null);
  assert.equal(asrEta({ samples: [sample(0, 0)], remainingMs: TOTAL, encodeMs: null }), null);
  assert.equal(asrEta({ samples: [], remainingMs: TOTAL, encodeMs: Number.NaN }), null);
});

test('남은 것이 없으면 null 이다 — 「0초 남음」도 말하지 않는다', () => {
  assert.equal(asrEta({ samples: [sample(0, 30_000)], remainingMs: 0, encodeMs: ENCODE_MS }), null);
  assert.equal(asrEta({ samples: [], remainingMs: -1, encodeMs: ENCODE_MS }), null);
});

// ── ⑥ 마지막 청크는 짧다 ─────────────────────────────────────────────────────
test('짧은 마지막 청크가 표본에 들어와도 속도를 왜곡하지 않는다', () => {
  // 26초짜리 꼬리를 6.5초에 끝냈다 = 120초짜리 30초와 같은 속도다.
  const samples = [sample(0, 30_000), { index: 1, audioMs: 26_000, elapsedMs: 6_500, paused: false }];
  const eta = asrEta({ samples, remainingMs: ASR_CHUNK_MS * 2, encodeMs: null });
  assert.equal(eta.remainingMs, 60_000);
});

test('남은 쪽의 마지막 청크가 짧으면 그만큼만 센다', () => {
  // 청크당 30초로 도는 폰. 남은 오디오는 120초 + 26초뿐이다.
  const eta = asrEta({ samples: [sample(0, 30_000)], remainingMs: ASR_CHUNK_MS + 26_000, encodeMs: null });
  assert.equal(eta.remainingMs, 36_500);
});

// ── 표본 만들기 ──────────────────────────────────────────────────────────────
test('청크 번호가 하나 늘어야 표본이 된다', () => {
  const mark = { index: 0, startedAt: 1_000, paused: false };
  // ⚠️ vm 안에서 만들어진 객체라 프로토타입이 다르다. 펼쳐서 값만 견준다.
  assert.deepEqual({ ...asrEtaSample(mark, { chunkIndex: 1, totalMs: TOTAL }, 31_000) },
    { index: 0, audioMs: ASR_CHUNK_MS, elapsedMs: 30_000, paused: false });
  // 아직 같은 청크를 돌고 있다.
  assert.equal(asrEtaSample(mark, { chunkIndex: 0, totalMs: TOTAL }, 31_000), null);
  // 「처음부터 다시」로 되돌아갔거나 두 칸을 건너뛰었다 — 그 사이를 우리가 재지 않았다.
  assert.equal(asrEtaSample({ index: 3, startedAt: 1_000, paused: false }, { chunkIndex: 0, totalMs: TOTAL }, 31_000), null);
  assert.equal(asrEtaSample(mark, { chunkIndex: 2, totalMs: TOTAL }, 31_000), null);
});

test('표본의 오디오 길이는 마지막 청크에서 짧아진다', () => {
  // 15번째 청크(index 14)는 26초뿐이다.
  const mark = { index: 14, startedAt: 0, paused: false };
  assert.equal(asrEtaSample(mark, { chunkIndex: 15, totalMs: TOTAL }, 6_500).audioMs, TOTAL - ASR_CHUNK_MS * 14);
});

test('백그라운드 표시와 흐르지 않은 시간', () => {
  assert.equal(asrEtaSample({ index: 0, startedAt: 0, paused: true }, { chunkIndex: 1, totalMs: TOTAL }, 30_000).paused, true);
  // 시계가 뒤로 가거나 그대로면 표본이 아니다.
  assert.equal(asrEtaSample({ index: 0, startedAt: 30_000, paused: false }, { chunkIndex: 1, totalMs: TOTAL }, 30_000), null);
});

// ── 남은 오디오 길이 ─────────────────────────────────────────────────────────
test('청크 안 진행률이 없으면 끝난 청크까지만 센다', () => {
  assert.equal(asrRemainingMs({ doneMs: ASR_CHUNK_MS * 2, totalMs: TOTAL, chunkPercent: null }), TOTAL - 240_000);
});

test('whisper 가 준 청크 안 진행률은 남은 길이에서 빼 준다', () => {
  assert.equal(asrRemainingMs({ doneMs: 0, totalMs: TOTAL, chunkPercent: 50 }), TOTAL - 60_000);
  assert.equal(asrRemainingMs({ doneMs: 0, totalMs: TOTAL, chunkPercent: 0 }), TOTAL);
});

test('마지막 청크의 진행률은 남은 길이만큼만 깎는다', () => {
  // 26초 남은 상태에서 50% → 13초만 줄어야 한다. 120초로 깎으면 음수가 된다.
  assert.equal(asrRemainingMs({ doneMs: TOTAL - 26_000, totalMs: TOTAL, chunkPercent: 50 }), 13_000);
  assert.equal(asrRemainingMs({ doneMs: TOTAL - 26_000, totalMs: TOTAL, chunkPercent: 100 }), 0);
});

test('다 끝났으면 0 이다', () => {
  assert.equal(asrRemainingMs({ doneMs: TOTAL, totalMs: TOTAL, chunkPercent: null }), 0);
  assert.equal(asrRemainingMs({ doneMs: TOTAL + 1, totalMs: TOTAL, chunkPercent: 50 }), 0);
});
