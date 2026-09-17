const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('src/lib/call-analysis.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${source}\n})`, { Error, Set, Map, JSON, Date, encodeURIComponent, unescape })(mod.exports);
const { parseAnalysis, parseSummary, chunkTranscript, summaryAnalysis, sanitizeTranscript, capSummary, CHUNK_CHARS, SUMMARY_LIMIT, SUMMARY_PREDICT } = mod.exports;
// 옛 기록과 앞으로 서버가 돌려줄 분석은 상세 항목을 담는다. 계약 검사는 그 모양을 그대로 본다.
const sample = () => ({ schema_version: 1, summary: '견적 전달을 요청했다.', details: [{ title: '견적', content: '견적서를 요청했다.' }], todos: [{ content: '견적 전달', owner: null, due_date: null, source: '견적을 보내주세요.' }], decisions: [], consulting: { customer_needs: [], questions: [], concerns: [], objections: [], important_points: [], followups: [] } });
test('구조화 분석의 날짜·nullable 값을 유지하고 잘못된 JSON을 거절한다', () => {
  assert.equal(parseAnalysis(JSON.stringify(sample())).todos[0].due_date, null);
  for (const invalid of ['2026-02-30', '다음 화요일', '', '2026-9-1']) {
    const data = sample(); data.todos[0].due_date = invalid;
    assert.throws(() => parseAnalysis(JSON.stringify(data)));
  }
  const data = sample(); data.todos[0].due_date = '2026-09-17';
  assert.equal(parseAnalysis(JSON.stringify(data)).todos[0].due_date, '2026-09-17');
  assert.throws(() => parseAnalysis('```json\n{}\n```'));
});
test('서버가 거부하는 빈 근거·빈 제목·과도한 항목을 분석 단계에서 거절한다', () => {
  const data = sample(); data.todos[0].source = '';
  assert.throws(() => parseAnalysis(JSON.stringify(data)));
  data.todos = []; data.details[0].title = '';
  assert.throws(() => parseAnalysis(JSON.stringify(data)));
  data.details = []; data.todos = Array.from({length: 101}, () => sample().todos[0]);
  assert.throws(() => parseAnalysis(JSON.stringify(data)));
});
test('긴 원문은 발화 경계를 보존하고 빈/과도한 단일 문장은 자르지 않고 실패한다', () => {
  const segments = [{ start: 0, end: 2, text: '첫 문장.' }, { start: 2, end: 4, text: '두 번째 문장.' }];
  const chunks = chunkTranscript(segments, 10);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1][0].start, 2);
  assert.equal(chunks.flat().map(s => s.text).join(''), segments.map(s => s.text).join(''));
  assert.throws(() => chunkTranscript([]), /EMPTY/);
  assert.throws(() => chunkTranscript([{ start: 0, end: 1, text: '가'.repeat(30) }], 10), /TOO_LONG/);
  // 기본 구간 크기는 속도 설정이 정한다 — 구간이 커질수록 호출 수가 줄어든다.
  assert.equal(chunkTranscript([{ start: 0, end: 1, text: '가'.repeat(CHUNK_CHARS) }, { start: 1, end: 2, text: '나' }]).length, 2);
});
test('구간 출력은 요약 한 줄로 읽고 라벨 흔들림·생각 블록을 흡수한다', () => {
  assert.equal(parseSummary('요약: 견적 통화입니다.'), '견적 통화입니다.');
  assert.equal(parseSummary('- 요약：견적 통화입니다.'), '견적 통화입니다.');
  assert.equal(parseSummary('<think>고민</think>\n요약: 견적 통화입니다.'), '견적 통화입니다.');
  // 라벨을 잊은 출력도 버리지 않는다 — 줄을 이어 붙여 요약으로 받는다.
  assert.equal(parseSummary('견적 통화입니다.\n두 번째 줄.'), '견적 통화입니다. 두 번째 줄.');
  // 출력 한도에 닿아 잘려도 받은 만큼을 쓴다. 요약은 한 줄이라 앞부분이 그대로 살아남는다.
  assert.equal(parseSummary('요약: 견적을 요청했고 다음 주에 다시 통'), '견적을 요청했고 다음 주에 다시 통');
  assert.equal(parseSummary(`요약: ${'가'.repeat(SUMMARY_LIMIT + 100)}`).length, SUMMARY_LIMIT);
  assert.throws(() => parseSummary('<think>생각만 하고 끝</think>'), /INVALID_ANALYSIS/);
  assert.throws(() => parseSummary('   '), /INVALID_ANALYSIS/);
});
test('요청하지 않은 할 일·결정 줄은 요약에 섞지 않는다', () => {
  // 이 버전은 요약만 요청한다. 모델이 옛 형식을 흉내 내 덧붙인 줄까지 요약 문장으로 만들면
  // 지어낸 내용이 섞인다.
  assert.equal(parseSummary('요약: 견적 통화입니다.\n할일: 견적서 전달\n결정: 다음 주 재통화'), '견적 통화입니다.');
  assert.throws(() => parseSummary('할일: 견적서 전달'), /INVALID_ANALYSIS/);
});
test('기기 분석은 요약만 채우고 나머지는 빈 배열로 서버 계약을 맞춘다', () => {
  const analysis = summaryAnalysis('종합 요약');
  assert.equal(analysis.summary, '종합 요약');
  // 서버는 이 필드들이 `null` 이면 400 으로 거부한다. 만들지 않는 대신 빈 배열을 채운다.
  // vm 밖 realm 과 배열을 직접 비교하지 않는다(다른 Array 생성자다).
  assert.equal(analysis.details.length, 0);
  assert.equal(analysis.todos.length, 0);
  assert.equal(analysis.decisions.length, 0);
  assert.equal(Object.values(analysis.consulting).every(list => Array.isArray(list) && list.length === 0), true);
  // 빈 배열로도 서버 계약 검사를 그대로 통과한다. `schema_version` 은 1 그대로다.
  assert.equal(parseAnalysis(JSON.stringify(analysis)).schema_version, 1);
  // 요약이 비면 서버가 거부한다. 여기서 먼저 걸린다.
  assert.throws(() => parseAnalysis(JSON.stringify(summaryAnalysis('   '))), /INVALID_ANALYSIS/);
});
test('요약 출력 한도는 200자 요약에 맞춘 크기다', () => {
  // 생성량이 곧 대기 시간이다. 요약만 만드는 지금은 직전 버전(400)의 절반이면 된다.
  assert.equal(SUMMARY_PREDICT, 224);
  assert.ok(SUMMARY_PREDICT < 400);
});
test('업로드 전 원문 정리는 공백 세그먼트를 버리고 start를 비감소로 맞춘다', () => {
  const cleaned = sanitizeTranscript({ text: '견적 주세요.', segments: [
    { start: 0, end: 1, text: '  ' },
    { start: 5, end: 7, text: '견적 주세요.' },
    { start: 2, end: 1, text: '네 알겠습니다.', speaker: '고객' },
  ] });
  assert.equal(cleaned.segments.length, 2);
  assert.equal(cleaned.segments.map(s => s.start).join(','), '5,5');
  assert.ok(cleaned.segments.every(s => s.end >= s.start));
  assert.equal(cleaned.segments[1].speaker, '고객');
  assert.equal(cleaned.text, '견적 주세요.');
});
test('원문 정리는 남는 내용·개수·용량 상한을 넘기면 조용히 자르지 않고 실패한다', () => {
  assert.throws(() => sanitizeTranscript({ text: '내용', segments: [{ start: 0, end: 1, text: ' ' }] }), /EMPTY/);
  assert.throws(() => sanitizeTranscript({ text: '내용', segments: [{ start: 0, end: 1, text: '가'.repeat(64001) }] }), /SEGMENT_TOO_LONG/);
  assert.throws(() => sanitizeTranscript({ text: '내용', segments: Array.from({ length: 20001 }, () => ({ start: 0, end: 1, text: '가' })) }), /TOO_MANY_SEGMENTS/);
  const segments = [{ start: 0, end: 1, text: '가' }];
  assert.throws(() => sanitizeTranscript({ text: '가'.repeat(2 * 1024 * 1024), segments }), /TRANSCRIPT_TOO_LARGE/);
  // 서버 상한을 넘는 시각은 잘라 맞춘다. 업로드를 막을 이유는 아니다.
  assert.equal(sanitizeTranscript({ text: '가', segments: [{ start: 90000, end: 90001, text: '가' }] }).segments[0].end, 86400);
  // 비어 있는 text 는 세그먼트에서 되살린다.
  assert.equal(sanitizeTranscript({ text: '  ', segments: [{ start: 0, end: 1, text: '가' }] }).text, '가');
});
test('chunk 요약 상한은 통합 입력만 자른다', () => {
  assert.equal(capSummary('가'.repeat(SUMMARY_LIMIT - 1)).length, SUMMARY_LIMIT - 1);
  assert.equal(capSummary('가'.repeat(5000)).length, SUMMARY_LIMIT);
});
