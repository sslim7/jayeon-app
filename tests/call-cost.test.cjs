const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('src/lib/call-cost.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${source}\n})`, { Number, Math })(mod.exports);
const { formatWon, costLine } = mod.exports;

/*
 * 🔧 **이 규칙들은 보고서 화면에서 재고 있었다.** 사용자가 비용 줄을 걷어 달라고 해서
 * (「나중에 어드민 만들면 거기 보자」) 화면에서는 빠졌지만, **규칙까지 사라지면 안 된다** —
 * 어드민을 만들 때 「0원과 모름은 다르다」를 처음부터 다시 발견하게 된다.
 * 그래서 화면을 거치지 않고 표기 함수를 직접 부른다.
 *
 * 🔴 앱은 단가를 모른다. 금액은 서버가 원화로 계산해 내려보내고, 여기 있는 것은 **읽히게
 * 쓰는 일**뿐이다(§`jayeon-was/internal/calls/cost.go`).
 */

test('비용 한 줄은 받아쓰기와 분석을 나눠 적는다', () => {
  // 🔴 합계만 적으면 「비싸다」까지는 알아도 **어느 단계를 바꿔야 싸지는지**를 알 수 없다.
  // 이 파이프라인은 돈의 대부분이 받아쓰기에 나가므로 그 사실이 한 줄에 보여야 한다.
  assert.equal(
    costLine({ currency: 'KRW', transcription: 96.4, analysis: 14.2, total: 110.6, usage: { audio_seconds: 1706, input_tokens: 17800, output_tokens: 2200, reasoning_tokens: 1024 } }),
    '비용: 받아쓰기 96원 · 분석 14원 (합계 111원)',
  );
});

test('1원이 안 되는 비용은 소수점을 남겨 공짜로 읽히지 않게 한다', () => {
  /*
   * 🔴 서버는 정수로 반올림하지 않고 내려보낸다. 그 값을 0원으로 뭉개면 화면을 보고
   * 「이 단계는 돈이 안 든다」고 판단하게 된다 — 실제로는 들었다.
   */
  assert.equal(formatWon(0.42), '0.42원');
  assert.equal(formatWon(0.03), '0.03원');
  assert.equal(formatWon(0.004), '0.01원 미만');
  // 1원 이상은 정수로 반올림한다 — 원 단위 아래는 읽는 사람에게 쓸모가 없다.
  assert.equal(formatWon(1706.5), '1,707원');
});

test('실제로 0원인 값만 0원이다 — 「모름」은 부르는 쪽이 칸째로 걷는다', () => {
  /*
   * 서버가 `cost` 를 안 보내는 경우는 셋이고 전부 정상이다(단가 미설정 · 사용량 없는 옛 통화 ·
   * 기기 분석 시절 기록). 🔴 그때 0원을 그리면 **돈이 안 들었다는 거짓말**이 되므로, 화면은
   * 값이 없으면 칸을 통째로 걷는다 — 이 함수는 「없음」을 받지 않는다.
   */
  assert.equal(formatWon(0), '0원');
  // 서버가 받아쓰기를 한 적이 없는 통화(폰에서 받아쓰고 서버가 분석만 함)는 진짜로 0원이다.
  assert.equal(
    costLine({ currency: 'KRW', transcription: 0, analysis: 16.2, total: 16.2, usage: { audio_seconds: 0, input_tokens: 17800, output_tokens: 2200, reasoning_tokens: 0 } }),
    '비용: 받아쓰기 0원 · 분석 16원 (합계 16원)',
  );
});
