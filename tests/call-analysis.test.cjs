const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('src/lib/call-analysis.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${source}\n})`, { Error, Set, Map, JSON, Date, encodeURIComponent, unescape })(mod.exports);
const { parseAnalysis, chunkTranscript, mergeAnalyses, sanitizeTranscript, capSummary } = mod.exports;
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
});
test('최종 통합은 중복만 제거하고 chunk별 할 일과 결정사항을 보존한다', () => {
  const a = sample(); const b = sample(); b.todos.push({ content: '전화', owner: null, due_date: null, source: '연락주세요' }); b.decisions.push('견적 수신 후 검토');
  const merged = mergeAnalyses([a, b], '종합 요약');
  assert.equal(merged.todos.length, 2); assert.equal(merged.details.length, 1);
  assert.equal(merged.decisions[0], '견적 수신 후 검토'); assert.equal(merged.summary, '종합 요약');
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
  assert.equal(capSummary('가'.repeat(1499)).length, 1499);
  assert.equal(capSummary('가'.repeat(5000)).length, 1500);
});
