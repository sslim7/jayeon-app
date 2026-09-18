const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('src/lib/call-progress.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${source}\n})`, { Date, Number, Math, String })(mod.exports);
const { percentOf, callStageViews, currentStageLabel, stageText, elapsedMs, elapsedLabel, formatDuration, missingAnalysisNotice, isActive, isFailed, CALL_STAGES } = mod.exports;

const view = (status, extra = {}) => callStageViews({ status, ...extra });
const states = (status, extra) => view(status, extra).map(stage => stage.state).join(',');

test('서버 진행률은 0~1 이고 범위 밖 값은 막대를 그리지 않는다', () => {
  assert.equal(percentOf(0), 0);
  assert.equal(percentOf(0.4), 40);
  assert.equal(percentOf(0.05), 5);
  assert.equal(percentOf(1), 100);
  // 🔴 기기 분석 시절의 0~100 정수가 섞여 들어오면 여기서 걸린다. 잘못 읽은 값으로
  // 막대를 그리느니 막대를 지운다.
  for (const value of [42, 100, -0.1, 1.5, Number.NaN, Infinity, null, undefined, '0.5']) assert.equal(percentOf(value), null);
});

test('네 단계는 업로드 → 음성 변환 → 분석 → 완료 순서다', () => {
  assert.equal([...CALL_STAGES].join(','), 'UPLOAD,TRANSCRIBE,ANALYZE,DONE');
  assert.equal(view('COMPLETED').map(stage => stage.label).join(','), '업로드,음성 변환,분석,완료');
});

test('서버 status 가 머무는 자리로 단계가 갈린다', () => {
  // 업로드를 기다리는 통화(AWAITING_UPLOAD)와 올리는 중인 통화는 첫 칸이다.
  assert.equal(states('PENDING'), 'running,pending,pending,pending');
  assert.equal(states('UPLOADING'), 'running,pending,pending,pending');
  // QUEUED 는 업로드가 끝나고 전사 차례를 기다리는 상태다 — 업로드 칸은 이미 지났다.
  assert.equal(states('PREPARING'), 'done,running,pending,pending');
  assert.equal(states('TRANSCRIBING'), 'done,running,pending,pending');
  assert.equal(states('ANALYZING'), 'done,done,running,pending');
  // 끝난 통화는 마지막 「완료」 칸까지 칠한다.
  assert.equal(states('COMPLETED'), 'done,done,done,done');
  // 실패는 **멈춘 자리**를 가리킨다.
  assert.equal(states('TRANSCRIPTION_FAILED'), 'done,failed,pending,pending');
  assert.equal(states('ANALYSIS_FAILED'), 'done,done,failed,pending');
});

test('막대는 도는 단계에만, 실제 값이 있을 때만 선다', () => {
  // vm 밖 realm 과 배열을 직접 비교하지 않는다(다른 Array 생성자다).
  const percents = record => view(record.status, record).map(stage => stage.percent).join(',');
  assert.equal(percents({ status: 'TRANSCRIBING', progress: 0.4 }), ',40,,');
  // 진행률을 주지 않으면 그리지 않는다. 지어낸 막대를 세우지 않는다.
  assert.equal(percents({ status: 'TRANSCRIBING' }), ',,,');
  // 업로드 중에는 앱이 직접 센 값이 첫 칸에 선다.
  assert.equal(percents({ status: 'UPLOADING', progress: 0.25 }), '25,,,');
  // 끝난 통화에는 도는 단계가 없으므로 막대도 없다.
  assert.equal(percents({ status: 'COMPLETED', progress: 1 }), ',,,');
});

test('진행 중 한 줄은 서버가 보낸 문구를 그대로 쓰고, 없으면 단계 이름으로 대신한다', () => {
  assert.equal(stageText({ status: 'TRANSCRIBING', stage: '받아쓰는 중' }), '받아쓰는 중');
  assert.equal(stageText({ status: 'PREPARING', stage: '업로드 완료, 순서 기다리는 중' }), '업로드 완료, 순서 기다리는 중');
  // 기기 경로로 저장된 옛 통화에는 이 값이 없다. 화면이 비지 않게 앱의 단계 이름을 쓴다.
  assert.equal(stageText({ status: 'ANALYZING' }), '분석');
  assert.equal(stageText({ status: 'ANALYZING', stage: '   ' }), '분석');
  assert.equal(currentStageLabel({ status: 'COMPLETED' }), '');
});

test('경과 시간은 등록 시각부터 재고 끝난 통화에는 붙이지 않는다', () => {
  const created = new Date(2026, 8, 17, 14, 0, 0).toISOString();
  const now = Date.parse(created) + 192_000;
  assert.equal(elapsedMs(created, now), 192_000);
  assert.equal(elapsedLabel({ status: 'TRANSCRIBING', created_at: created }, now), '3분 12초 경과');
  // 🔴 끝난 통화에 붙이면 「3일 경과」가 된다. 서버는 단계별 소요 시간을 주지 않는다.
  assert.equal(elapsedLabel({ status: 'COMPLETED', created_at: created }, now), '');
  assert.equal(elapsedLabel({ status: 'ANALYSIS_FAILED', created_at: created }, now), '');
  // 읽을 수 없는 시각은 지어내지 않는다.
  for (const value of [null, undefined, '언젠가']) assert.equal(elapsedMs(value, now), null);
  // 기기 시계가 서버보다 뒤처지면 음수가 된다. 0 으로 눌러 둔다.
  assert.equal(elapsedMs(created, Date.parse(created) - 5000), 0);
});

test('경과 시간 표기는 시·분·초를 사람이 읽는 단위로 접는다', () => {
  assert.equal(formatDuration(0), '0초');
  assert.equal(formatDuration(9_000), '9초');
  assert.equal(formatDuration(192_000), '3분 12초');
  assert.equal(formatDuration(3_900_000), '1시간 05분');
  assert.equal(formatDuration(-1), '0초');
  assert.equal(formatDuration(Number.NaN), '0초');
});

test('요약이 없는 탭은 왜 비었는지와 다음에 할 일을 말한다', () => {
  const created = new Date(2026, 8, 17, 14, 0, 0).toISOString();
  const now = Date.parse(created) + 192_000;
  const running = missingAnalysisNotice({ status: 'TRANSCRIBING', stage: '받아쓰는 중', created_at: created }, now);
  assert.match(running, /현재 단계: 받아쓰는 중/);
  assert.match(running, /3분 12초 경과/);
  const failed = missingAnalysisNotice({ status: 'ANALYSIS_FAILED', created_at: created }, now, '받아쓰기는 끝났지만 내용을 정리하지 못했습니다. (코드: X)');
  assert.match(failed, /^받아쓰기는 끝났지만/);
  // 재시도는 원문으로 분석만 다시 돈다 — 화면이 약속하는 것과 서버가 하는 일이 같아야 한다.
  assert.match(failed, /원문으로 분석만 다시 진행합니다/);
});

test('진행 중·실패 판정은 같은 목록을 본다', () => {
  for (const status of ['PENDING', 'PREPARING', 'TRANSCRIBING', 'ANALYZING', 'UPLOADING']) assert.equal(isActive(status), true);
  for (const status of ['COMPLETED', 'ANALYSIS_FAILED', 'TRANSCRIPTION_FAILED']) assert.equal(isActive(status), false);
  for (const status of ['ANALYSIS_FAILED', 'TRANSCRIPTION_FAILED', 'UPLOAD_FAILED', 'UPLOAD_REJECTED', 'FAILED']) assert.equal(isFailed(status), true);
  assert.equal(isFailed('COMPLETED'), false);
});
