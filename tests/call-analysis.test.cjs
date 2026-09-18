const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('src/lib/call-analysis.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${source}\n})`, { Error, Array, Number, Math, encodeURIComponent, unescape })(mod.exports);
const { sanitizeTranscript } = mod.exports;

/*
 * 남은 검사는 하나다 — **올리지 못한 옛 결과를 마저 올릴 때** 서버 계약에 맞는 모양인가.
 * 기기 추론(프롬프트·구간 나누기·출력 파서)은 서버로 옮겨가면서 함께 걷었다.
 */

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
  assert.throws(() => sanitizeTranscript({ text: '내용', segments: [{ start: 0, end: 1, text: ' ' }] }), /EMPTY_TRANSCRIPT/);
  assert.throws(() => sanitizeTranscript({ text: '내용', segments: [{ start: 0, end: 1, text: '가'.repeat(64001) }] }), /CALL_TOO_LARGE/);
  assert.throws(() => sanitizeTranscript({ text: '내용', segments: Array.from({ length: 20001 }, () => ({ start: 0, end: 1, text: '가' })) }), /CALL_TOO_LARGE/);
  assert.throws(() => sanitizeTranscript({ text: '가'.repeat(2 * 1024 * 1024), segments: [{ start: 0, end: 1, text: '가' }] }), /CALL_TOO_LARGE/);
  // 서버 상한을 넘는 시각은 잘라 맞춘다. 업로드를 막을 이유는 아니다.
  assert.equal(sanitizeTranscript({ text: '가', segments: [{ start: 90000, end: 90001, text: '가' }] }).segments[0].end, 86400);
  // 비어 있는 text 는 세그먼트에서 되살린다.
  assert.equal(sanitizeTranscript({ text: '  ', segments: [{ start: 0, end: 1, text: '가' }] }).text, '가');
});
