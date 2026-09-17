const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('src/lib/call-analysis.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${source}\n})`, { Error, Set, Map, JSON, Date, encodeURIComponent, unescape })(mod.exports);
const { parseAnalysis, parseChunkResult, parseSummary, chunkTranscript, mergeAnalyses, sanitizeTranscript, capSummary, CHUNK_CHARS, NO_SOURCE, SUMMARY_LIMIT } = mod.exports;
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
const chunk = () => ({ summary: '견적 전달을 요청했다.', todos: [{ content: '견적 전달', owner: null, due_date: null, source: '견적을 보내주세요.' }], decisions: [] });
test('구간 출력은 줄 단위 텍스트로 읽고 근거가 없으면 지어내지 않는다', () => {
  const result = parseChunkResult([
    '요약: 도입 견적을 요청한 통화입니다.',
    '할일: 견적서 전달 | 근거: 견적서를 보내 주세요',
    '할일: 담당자 연락',
    '결정: 다음 주에 다시 통화하기',
  ].join('\n'));
  assert.equal(result.summary, '도입 견적을 요청한 통화입니다.');
  assert.equal(result.todos.length, 2);
  assert.equal(result.todos[0].source, '견적서를 보내 주세요');
  // 근거를 적지 않았으면 원문을 지어내지 않고 없다고 적는다(서버는 빈 문자열을 거부한다).
  assert.equal(result.todos[1].source, NO_SOURCE);
  // 담당자·기한은 뽑지 않는다. 추측 대신 null 이다.
  assert.equal(result.todos[1].owner, null);
  assert.equal(result.todos[1].due_date, null);
  assert.equal(result.decisions.join('|'), '다음 주에 다시 통화하기');
});
test('구간 출력의 항목 수·표기 흔들림·생각 블록을 흡수하고 요약이 없으면 실패한다', () => {
  const many = ['<think>고민</think>', '요약: 통화 요약입니다.']
    .concat(Array.from({ length: 5 }, (_, i) => `- 할 일: 작업${i}`))
    .concat(Array.from({ length: 4 }, (_, i) => `결정：결정${i}`));
  const result = parseChunkResult(many.join('\n'));
  assert.equal(result.summary, '통화 요약입니다.');
  // 모델이 더 써도 여기서 끊는다 — 할 일 3줄, 결정 2줄.
  assert.equal(result.todos.length, 3);
  assert.equal(result.decisions.length, 2);
  // 라벨을 잊은 출력도 버리지 않는다.
  assert.equal(parseChunkResult('도입 견적을 요청했습니다.').summary, '도입 견적을 요청했습니다.');
  assert.throws(() => parseChunkResult('   '), /INVALID_ANALYSIS/);
  assert.throws(() => parseChunkResult('결정: 다시 통화'), /INVALID_ANALYSIS/);
});
test('출력 한도에 닿아 잘린 구간은 마지막 줄만 버리고 앞줄을 살린다', () => {
  const truncated = '요약: 견적을 요청했습니다.\n할일: 견적서 전달 | 근거: 보내 주세요\n할일: 담당자 연';
  const result = parseChunkResult(truncated, true);
  assert.equal(result.summary, '견적을 요청했습니다.');
  assert.equal(result.todos.length, 1);
  // 같은 출력을 온전한 것으로 읽으면 잘린 줄도 할 일이 된다.
  assert.equal(parseChunkResult(truncated, false).todos.length, 2);
});
test('요약만 받는 출력은 라벨을 떼고 상한에서 자른다', () => {
  assert.equal(parseSummary('요약: 견적 통화입니다.'), '견적 통화입니다.');
  assert.equal(parseSummary('견적 통화입니다.\n두 번째 줄.'), '견적 통화입니다. 두 번째 줄.');
  assert.equal(parseSummary(`요약: ${'가'.repeat(SUMMARY_LIMIT + 100)}`).length, SUMMARY_LIMIT);
  assert.throws(() => parseSummary('<think>생각만 하고 끝</think>'), /INVALID_ANALYSIS/);
});
test('최종 통합은 중복만 제거하고 구간별 할 일과 결정사항을 보존한다', () => {
  const a = chunk(); const b = chunk(); b.todos.push({ content: '전화', owner: null, due_date: null, source: '연락주세요' }); b.decisions.push('견적 수신 후 검토');
  const merged = mergeAnalyses([a, b], '종합 요약');
  assert.equal(merged.todos.length, 2);
  assert.equal(merged.decisions[0], '견적 수신 후 검토'); assert.equal(merged.summary, '종합 요약');
  // 이 버전은 상세 내용과 상담 분석을 기기에서 만들지 않는다. 서버는 `null` 을 거부하므로
  // 빈 배열을 채워 보낸다(→ `internal/calls/model.go`).
  // vm 밖 realm 과 배열을 직접 비교하지 않는다(다른 Array 생성자다).
  assert.equal(merged.details.length, 0);
  assert.equal(Object.values(merged.consulting).every(list => Array.isArray(list) && list.length === 0), true);
  // 빈 배열로도 서버 계약 검사를 그대로 통과한다.
  assert.equal(parseAnalysis(JSON.stringify(merged)).summary, '종합 요약');
});
test('통합 결과는 서버 개수 상한 안에서 끊는다', () => {
  const parts = Array.from({ length: 60 }, (_, i) => ({ summary: '요약', todos: Array.from({ length: 3 }, (_, j) => ({ content: `할 일 ${i}-${j}`, owner: null, due_date: null, source: '근거' })), decisions: [`결정 ${i}`] }));
  const merged = mergeAnalyses(parts, '종합');
  assert.equal(merged.todos.length, 100);
  assert.equal(merged.decisions.length, 60);
  assert.doesNotThrow(() => parseAnalysis(JSON.stringify(merged)));
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
