const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('src/lib/call-progress.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${source}\n})`, { Date, Number, Math, String })(mod.exports);
const { transcribeProgress, analysisProgress, mergeSteps, unavailableSectionNotice, elapsedMs, formatDuration, elapsedLabel, totalDurationLabel, callStageViews, stageMs, currentStageLabel, skippedNotice, diagnosticsLabel, missingAnalysisNotice, tokensPerSecond, liveAnalysisText } = mod.exports;

test('음성 변환 진행률은 whisper 가 준 값만 쓰고 범위를 벗어난 값은 다듬거나 버린다', () => {
  assert.equal(transcribeProgress(0), 0);
  assert.equal(transcribeProgress(37.9), 37);
  assert.equal(transcribeProgress(100), 100);
  assert.equal(transcribeProgress(150), 100);
  assert.equal(transcribeProgress(-1), 0);
  for (const value of [NaN, Infinity, undefined, null, '50']) assert.equal(transcribeProgress(value), null);
});

test('요약 통합은 4개씩 묶어 호출 수를 줄이고, 하나 남은 묶음은 부르지 않는다', () => {
  assert.equal(mergeSteps(1), 0);
  assert.equal(mergeSteps(2), 1);
  assert.equal(mergeSteps(4), 1);
  // 5개는 [4]+[1] → 한 번, 남은 2개를 한 번 더. 둘씩 짝지으면 4번 걸리던 자리다.
  assert.equal(mergeSteps(5), 2);
  assert.equal(mergeSteps(9), 3);
  assert.equal(mergeSteps(10), 4);
  // 16개도 5번이면 끝난다(둘씩이면 15번).
  assert.equal(mergeSteps(16), 5);
  assert.equal(mergeSteps(0), 0);
});

test('분석 진행률은 chunk 와 요약 통합을 합쳐 센다', () => {
  // chunk 가 하나면 통합이 없다 — 그 하나가 전부다.
  assert.equal(analysisProgress(0, 1), 0);
  assert.equal(analysisProgress(1, 1), 100);
  // chunk 3개 → 몫 4개(chunk 3 + 통합 1). chunk 를 다 끝내도 100% 가 되지 않는다.
  assert.equal(analysisProgress(3, 3), 75);
  assert.equal(analysisProgress(4, 3), 100);
  assert.equal(analysisProgress(9, 3), 100);
  // chunk 5개 → 몫 7개(chunk 5 + 통합 2).
  assert.equal(analysisProgress(5, 5), 71);
  assert.equal(analysisProgress(7, 5), 100);
  assert.equal(analysisProgress(0, 0), 0);
});

test('경과 시간은 시작 시각부터 재고, 끝나면 최종 소요 시간으로 고정된다', () => {
  const started = new Date(2026, 8, 17, 14, 0, 0);
  const now = started.getTime() + 192_000;
  const running = { started_at: started.toISOString() };
  assert.equal(elapsedMs(running, now), 192_000);
  assert.equal(elapsedLabel(running, now), '3분 12초 경과');
  const done = { started_at: started.toISOString(), finished_at: new Date(started.getTime() + 245_000).toISOString() };
  assert.equal(elapsedLabel(done, now + 9_999_999), '4분 05초 걸렸습니다');
  // 시작 시각이 없으면 아무것도 보이지 않는다. 지어내지 않는다.
  for (const value of [null, undefined, {}, { started_at: '언젠가' }]) {
    assert.equal(elapsedMs(value, now), null);
    assert.equal(elapsedLabel(value, now), '');
  }
  // 기기 시계가 뒤로 조정되면 음수가 된다. 0 으로 눌러 둔다.
  assert.equal(elapsedMs(running, started.getTime() - 5_000), 0);
});

test('소요 시간 표기는 초·분·시간 단위로 끊는다', () => {
  assert.equal(formatDuration(0), '0초');
  assert.equal(formatDuration(45_400), '45초');
  assert.equal(formatDuration(65_000), '1분 05초');
  assert.equal(formatDuration(3_600_000), '1시간 00분');
  assert.equal(formatDuration(-5), '0초');
  // 끝난 기록의 총 소요 시간은 현재 시각과 무관하다(렌더 중 시계를 읽지 않는다).
  assert.equal(totalDurationLabel({ started_at: new Date(2026, 8, 17, 14, 0, 0).toISOString(), finished_at: new Date(2026, 8, 17, 14, 4, 5).toISOString() }), '4분 05초 걸렸습니다');
  assert.equal(totalDurationLabel({ started_at: new Date().toISOString() }), '');
  assert.equal(totalDurationLabel(null), '');
});

test('네 단계는 지난 단계·도는 단계·예정 단계를 시간과 함께 구분한다', () => {
  const started = new Date(2026, 8, 17, 14, 0, 0);
  const now = started.getTime() + 600_000;
  const timing = {
    started_at: started.toISOString(),
    stages: {
      PREPARE: { started_at: null, ms: 3_000 },
      TRANSCRIBE: { started_at: null, ms: 35_000 },
      ANALYZE: { started_at: new Date(started.getTime() + 38_000).toISOString(), ms: 0 },
    },
  };
  const views = callStageViews({ status: 'ANALYZING', progress: 42, timing }, now);
  // vm 밖 realm 과 배열을 직접 비교하지 않는다(다른 Array 생성자다). 문자열로 붙여 비교한다.
  assert.equal(views.map(view => `${view.label}:${view.state}`).join('|'), '분석 준비:done|음성 변환:done|통화 분석:running|결과 저장:pending');
  assert.equal(views[0].ms, 3_000);
  // 도는 단계는 시작 시각부터 지금까지 — 1초마다 다시 계산한다.
  assert.equal(views[2].ms, 562_000);
  assert.equal(views[2].percent, 42);
  // 예정 단계는 시간도 진행률도 없다.
  assert.equal(views[3].ms, null);
  assert.equal(views[3].percent, null);
  assert.equal(currentStageLabel({ status: 'ANALYZING' }), '통화 분석');
  assert.equal(currentStageLabel({ status: 'COMPLETED' }), '');
});

test('실패는 멈춘 단계를 가리키고, 끝난 기록의 시간은 더 늘지 않는다', () => {
  const started = new Date(2026, 8, 17, 14, 0, 0);
  const timing = {
    started_at: started.toISOString(),
    finished_at: new Date(started.getTime() + 245_000).toISOString(),
    stages: { PREPARE: { started_at: null, ms: 3_000 }, TRANSCRIBE: { started_at: new Date(started.getTime() + 3_000).toISOString(), ms: 0 } },
  };
  const views = callStageViews({ status: 'TRANSCRIPTION_FAILED', progress: null, timing }, started.getTime() + 9_999_999);
  assert.equal(views.map(view => view.state).join('|'), 'done|failed|pending|pending');
  // 끝난 시각에서 멈춘다 — 화면을 열어 둔 시간만큼 늘어나면 안 된다.
  assert.equal(views[1].ms, 242_000);
  assert.equal(stageMs(timing, 'TRANSCRIBE', Date.now()), 242_000);
  assert.equal(stageMs(timing, 'ANALYZE', Date.now()), null);
  // 완료는 네 단계를 모두 지난 상태다.
  assert.equal(callStageViews({ status: 'COMPLETED', progress: null, timing }, 0).map(view => view.state).join('|'), 'done|done|done|done');
});

test('부분 성공과 진단 숫자를 숨기지 않고 보여 준다', () => {
  const llm = { chunks: 5, completions: 7, skipped: 2, tokens: 4210, tokens_per_second: 2.4, stopped_limit: 3, merge_fallbacks: 1 };
  assert.equal(skippedNotice({ started_at: 'x', llm }), '구간 5개 중 2개는 분석하지 못해 결과에서 빠졌습니다.');
  assert.equal(skippedNotice({ started_at: 'x', llm: { ...llm, skipped: 0 } }), '');
  assert.equal(skippedNotice(null), '');
  assert.equal(diagnosticsLabel({ started_at: 'x', llm }), 'AI 호출 7회 · 생성 4210 토큰 · 2.4 토큰/초 · 출력 한도 도달 3회 · 요약 통합 대체 1회');
  // 요약만 건진 구간도 숨기지 않는다 — 그 구간의 할 일·결정사항은 결과에 없다.
  assert.equal(diagnosticsLabel({ started_at: 'x', llm: { ...llm, summary_only: 2 } }), 'AI 호출 7회 · 생성 4210 토큰 · 2.4 토큰/초 · 출력 한도 도달 3회 · 요약만 추출 2회 · 요약 통합 대체 1회');
  assert.equal(diagnosticsLabel({ started_at: 'x' }), '');
});

test('기기에서 만들지 않는 항목은 빈 화면 대신 이유를 말한다', () => {
  const notice = unavailableSectionNotice('상세 내용');
  assert.match(notice, /^상세 내용은 이 버전의 기기 분석에서 만들지 않습니다\./);
  // 기기가 무엇을 만드는지, 이 항목은 언제 오는지까지 말한다.
  assert.match(notice, /통화 요약과 할 일, 결정사항/);
  assert.match(notice, /서버 분석이 준비되면/);
  assert.match(unavailableSectionNotice('상담 분석'), /^상담 분석은/);
});

test('분석이 없는 탭에는 왜 비었는지 안내한다', () => {
  const started = new Date(2026, 8, 17, 14, 0, 0);
  const now = started.getTime() + 192_000;
  const running = { status: 'ANALYZING', timing: { started_at: started.toISOString() } };
  assert.equal(missingAnalysisNotice(running, now), 'AI 분석이 아직 끝나지 않았습니다. 현재 단계: 통화 분석 · 3분 12초 경과. 완료되면 이 탭에 내용이 나타납니다.');
  // 실패는 저장해 둔 이유(+코드)를 그대로 보여 준다.
  const failed = { status: 'ANALYSIS_FAILED', error: '음성 변환은 완료되었지만 AI 분석을 완료하지 못했습니다. AI가 출력 한도 안에 분석을 끝내지 못했습니다. (코드: INCOMPLETE_ANALYSIS)' };
  assert.match(missingAnalysisNotice(failed, now), /코드: INCOMPLETE_ANALYSIS\) 목록에서 다시 시도하면/);
  assert.match(missingAnalysisNotice({ status: 'FAILED' }, now), /분석을 완료하지 못했습니다/);
  assert.match(missingAnalysisNotice({ status: 'COMPLETED' }, now), /아직 보여 드릴 내용이 없습니다/);
});

test('구간 안의 진행은 실제로 센 토큰 수와 속도로만 말한다', () => {
  // 1초가 안 된 구간은 속도라고 부를 값이 없다.
  assert.equal(tokensPerSecond(10, 500), null);
  assert.equal(tokensPerSecond(0, 5000), null);
  assert.equal(tokensPerSecond(120, 50_000), 2.4);
  assert.equal(tokensPerSecond(1240, 60_000), 20.7);
  for (const value of [NaN, Infinity, -1]) assert.equal(tokensPerSecond(value, 5000), null);
  assert.equal(tokensPerSecond(10, NaN), null);
  // 백분율을 만들지 않는다 — 생성 토큰 수는 상한 대비 비율일 뿐 완료율이 아니다.
  assert.equal(liveAnalysisText({ chunk: 2, chunks: 5, tokens: 1240, tokens_per_second: 2.4 }), '구간 2/5 분석 중 · 1,240 토큰 · 2.4 토큰/초');
  // 구간이 하나면 위치를 적지 않는다.
  assert.equal(liveAnalysisText({ chunk: 1, chunks: 1, tokens: 30, tokens_per_second: null }), '30 토큰');
  assert.equal(liveAnalysisText({ chunk: 0, chunks: 3, tokens: 12, tokens_per_second: 1.2 }), '요약 통합 중 · 12 토큰 · 1.2 토큰/초');
  assert.equal(liveAnalysisText({ chunk: 1, chunks: 1, tokens: 0, tokens_per_second: null }), '');
  assert.equal(liveAnalysisText(null), '');
});
