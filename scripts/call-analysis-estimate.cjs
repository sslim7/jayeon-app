#!/usr/bin/env node
/**
 * 기기 내 통화 분석의 **예상 소요 시간**을 같은 입력으로 바꾸기 전/후를 견줘 계산한다.
 *
 * 실기기 실행 없이 llama.rn 없이 돈다 — 실제로 도는 것은 설정값(구간 크기, 출력 한도, 통합
 * 묶음)을 읽어 호출 수와 생성 token 수를 세는 산수뿐이다. 그래서 여기 나오는 시간은
 * **측정값이 아니라 추정값**이고, 추정에 쓰는 속도(token/초)는 실기기에서 잰 값을 넣어야
 * 뜻이 있다. 화면의 진단 한 줄(`AI 호출 N회 · 생성 N 토큰 · N 토큰/초`)이 그 값이다.
 *
 * ```sh
 * node scripts/call-analysis-estimate.cjs
 * node scripts/call-analysis-estimate.cjs --decode 8 --prefill 60 --chars-per-minute 300
 * ```
 *
 * 설정값은 `src/lib/call-analysis.ts` 와 `src/lib/call-progress.ts` 에서 그대로 읽는다.
 * 코드를 고치면 이 계산도 함께 움직인다(숫자를 두 곳에 적어 두면 반드시 어긋난다).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
function load(file) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports){${source}\n})`, {})(module.exports);
  return module.exports;
}
const analysis = load('src/lib/call-analysis.ts');
const progress = load('src/lib/call-progress.ts');

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = Number(process.argv[at + 1]);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 🔴 **가정이다. 측정값이 아니다.**
 *
 * `decode` 만 실기기에서 나온 값이다 — 갤럭시 S21, Qwen3-0.6B Q8_0, 4 스레드, JSON schema
 * grammar 를 켠 상태에서 2.4~2.5 token/초가 기록에 남았다. grammar 를 걷어 낸 뒤의 속도는
 * **아직 재지 않았다.** 나머지는 문헌·경험값이라 실기기 수치가 나오면 덮어써야 한다.
 */
const ASSUMED = {
  decode: flag('decode', 2.5),
  prefill: flag('prefill', 40),
  charsPerMinute: flag('chars-per-minute', 300),
  tokensPerChar: flag('tokens-per-char', 0.8),
  instructionTokens: flag('instruction-tokens', 220),
  /** 요약·할 일·결정사항을 함께 만들던 구간의 출력량. 기본값 + 원문 길이 비례. */
  outputBase: flag('output-base', 120),
  outputPerChar: flag('output-per-char', 0.08),
  /**
   * 요약만 만드는 구간의 출력 상한. 지시문이 200자 이내를 요구한다(200 × 0.85 ≈ 170 token).
   *
   * 원문이 길어져도 이 값을 넘지 않는다 — 출력 길이를 정하는 것은 원문이 아니라 지시문이다.
   */
  summaryTokens: flag('summary-tokens', 170),
  /** 짧은 원문의 요약은 상한에 닿지 않는다. 원문 token 의 이 비율까지만 쓴다고 본다. */
  summaryRatio: flag('summary-ratio', 0.4),
};

/** 바꾸기 전 설정. `git show HEAD:src/lib/call-analysis.ts` 로 확인할 수 있다. */
const BEFORE = {
  label: '이전 (요약·할 일·결정사항, n_predict 400)',
  chunkChars: 2000,
  chunkPredict: 400,
  mergePredict: 320,
  ctx: 4096,
  merges: chunks => progress.mergeSteps(chunks),
  /** 항목 수를 정해 두었으므로 한도에 닿기 전에 멈춘다. 출력은 원문 길이를 따라 늘었다. */
  generated: (config, chars) => Math.min(config.chunkPredict, ASSUMED.outputBase + ASSUMED.outputPerChar * chars),
};
const AFTER = {
  label: '이후 (요약만)',
  chunkChars: analysis.CHUNK_CHARS,
  chunkPredict: analysis.SUMMARY_PREDICT,
  mergePredict: analysis.MERGE_PREDICT,
  ctx: analysis.ANALYSIS_CTX,
  merges: chunks => progress.mergeSteps(chunks),
  /** 요약 한 줄은 지시문 상한(200자)에서 멈춘다. 짧은 원문은 그보다도 짧다. */
  generated: (config, chars) => Math.min(config.chunkPredict, ASSUMED.summaryTokens, chars * ASSUMED.tokensPerChar * ASSUMED.summaryRatio),
};

function estimate(config, transcriptChars) {
  const chunks = Math.max(1, Math.ceil(transcriptChars / config.chunkChars));
  const perChunk = transcriptChars / chunks;
  const merges = config.merges(chunks);
  const chunkPrompt = ASSUMED.instructionTokens + perChunk * ASSUMED.tokensPerChar;
  const chunkOutput = config.generated(config, perChunk);
  // 통합 입력은 구간 요약 묶음이다. 요약 상한(`SUMMARY_LIMIT`)에 묶음 크기를 곱한다.
  const mergeChars = analysis.SUMMARY_LIMIT * Math.min(chunks, progress.MERGE_FAN);
  const mergePrompt = ASSUMED.instructionTokens + mergeChars * ASSUMED.tokensPerChar;
  const mergeOutput = Math.min(config.mergePredict, ASSUMED.outputBase + ASSUMED.outputPerChar * mergeChars);
  const prefill = chunks * chunkPrompt + merges * mergePrompt;
  const decode = chunks * chunkOutput + merges * mergeOutput;
  return {
    chunks, calls: chunks + merges, prefill: Math.round(prefill), decode: Math.round(decode),
    seconds: prefill / ASSUMED.prefill + decode / ASSUMED.decode,
    // Qwen3-0.6B: 28 layer × 8 KV head × 128 dim × 2(K+V) × 2 byte = token 당 114,688 byte.
    kvBytes: config.ctx * 114688,
  };
}
const duration = value => { const total = Math.round(value); return total >= 60 ? `${Math.floor(total / 60)}분 ${String(total % 60).padStart(2, '0')}초` : `${total}초`; };
const pad = (value, width) => String(value).padStart(width);

console.log('# 기기 내 통화 분석 소요 시간 추정 (측정값 아님)');
console.log('');
console.log('가정:');
console.log(`  생성 속도      ${ASSUMED.decode} token/초   ← 실기기 기록(grammar 켠 상태). 걷어 낸 뒤의 값은 미측정.`);
console.log(`  프롬프트 처리  ${ASSUMED.prefill} token/초    ← 가정`);
console.log(`  통화 1분당     ${ASSUMED.charsPerMinute}자        ← 가정`);
console.log(`  글자당 token   ${ASSUMED.tokensPerChar}         ← 가정 (Qwen3 tokenizer, 한국어)`);
console.log(`  구간 출력량    이전 ${ASSUMED.outputBase} + ${ASSUMED.outputPerChar}×글자 · 이후 min(${ASSUMED.summaryTokens}, 원문×${ASSUMED.summaryRatio})  ← 가정`);
console.log('');
console.log('설정:');
for (const config of [BEFORE, AFTER]) {
  console.log(`  ${config.label}: 구간 ${config.chunkChars}자 · 출력 한도 ${config.chunkPredict} token · n_ctx ${config.ctx} (KV ${(config.ctx * 114688 / 1024 ** 2).toFixed(0)}MiB)`);
}
console.log('');
console.log('| 통화 길이 |   원문 |  구간 | 이전 호출 | 이전 생성 |     이전 | 이후 호출 | 이후 생성 |     이후 |');
console.log('|-----------|--------|-------|-----------|-----------|----------|-----------|-----------|----------|');
for (const minutes of [1, 2, 5, 10, 30, 60]) {
  const chars = Math.round(minutes * ASSUMED.charsPerMinute);
  const before = estimate(BEFORE, chars);
  const after = estimate(AFTER, chars);
  console.log(`| ${pad(minutes + '분', 9)} | ${pad(chars + '자', 6)} | ${pad(`${before.chunks}→${after.chunks}`, 5)} | ${pad(before.calls + '회', 9)} | ${pad(before.decode, 9)} | ${pad(duration(before.seconds), 8)} | ${pad(after.calls + '회', 9)} | ${pad(after.decode, 9)} | ${pad(duration(after.seconds), 8)} |`);
}
console.log('');
console.log('「이전」은 요약과 함께 할 일·결정사항을 만들던 직전 버전이다. 실기기(갤럭시 S21)에서 짧은 샘플이');
console.log('1분 32초에 끝났지만 할 일·결정사항의 품질이 쓸 수 없는 수준이었다. 기기는 요약만 만들고 상세 분석은');
console.log('원문을 받은 서버가 맡는다 — 호출 수는 그대로이고 **구간마다 생성하는 양**이 줄어든다.');
console.log('');
console.log('생성 속도를 달리 두면(실기기 속도는 화면의 진단 한 줄에서 읽어 `--decode` 로 넣는다):');
console.log('');
console.log('| 생성 속도 |     1분 통화 |     5분 통화 |    30분 통화 |');
console.log('|-----------|--------------|--------------|--------------|');
for (const decode of [2.5, 5, 8, 12, 20]) {
  const previous = ASSUMED.decode;
  ASSUMED.decode = decode;
  const row = [1, 5, 30].map(minutes => pad(duration(estimate(AFTER, Math.round(minutes * ASSUMED.charsPerMinute)).seconds), 12));
  ASSUMED.decode = previous;
  console.log(`| ${pad(decode + ' t/s', 9)} | ${row.join(' | ')} |`);
}
