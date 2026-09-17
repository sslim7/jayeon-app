const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const errors = { exports: {} };
vm.runInNewContext(`(function(exports){${compile('src/lib/call-errors.ts')}\n})`, { Error, Number, RegExp, String })(errors.exports);
const { failureCode, failureReason, failureText, httpCode } = errors.exports;
const threads = { exports: {} };
vm.runInNewContext(`(function(exports){${compile('src/lib/call-threads.ts')}\n})`, { Number, Math })(threads.exports);
const { inferenceThreads } = threads.exports;

test('실패 코드는 정해진 목록만 통과하고 내부 문구는 버린다', () => {
  assert.equal(failureCode(new Error('INCOMPLETE_ANALYSIS')), 'INCOMPLETE_ANALYSIS');
  assert.equal(failureCode(new Error('CONTEXT_TOO_LONG')), 'CONTEXT_TOO_LONG');
  // 경로·원문이 섞인 네이티브 오류는 코드로도 내보내지 않는다.
  assert.equal(failureCode(new Error('/data/user/0/kr.redhead.nature/files/call-audio/x.m4a: no such file')), 'UNKNOWN');
  assert.equal(failureCode('문자열 오류'), 'UNKNOWN');
  assert.equal(failureCode(undefined), 'UNKNOWN');
  // 업로드 거부는 이유 코드까지 살린다.
  assert.equal(failureCode(new Error('UPLOAD_REJECTED:ANALYSIS_TOO_LARGE')), 'ANALYSIS_TOO_LARGE');
  assert.equal(failureCode(new Error('UPLOAD_REJECTED:CONTACT')), 'UPLOAD_REJECTED');
});

test('실패 이유는 사람이 읽을 수 있는 한 줄이고 코드가 함께 남는다', () => {
  assert.match(failureReason('INCOMPLETE_ANALYSIS'), /출력 한도/);
  assert.equal(httpCode(400), 'HTTP_400');
  assert.equal(httpCode(Number.NaN), 'UNKNOWN');
  assert.match(failureReason('HTTP_400'), /받지 않았습니다/);
  assert.match(failureReason('HTTP_503'), /통신하지 못했습니다/);
  assert.match(failureReason('처음 보는 코드'), /알 수 없는/);
  const text = failureText('음성 변환은 완료되었지만 AI 분석을 완료하지 못했습니다.', 'INCOMPLETE_ANALYSIS');
  assert.match(text, /^음성 변환은 완료되었지만/);
  assert.match(text, /\(코드: INCOMPLETE_ANALYSIS\)$/);
});

test('추론 스레드는 코어 수의 절반을 쓰되 2~4 사이로 묶는다', () => {
  assert.equal(inferenceThreads(8), 4);
  assert.equal(inferenceThreads(12), 4);
  assert.equal(inferenceThreads(6), 3);
  assert.equal(inferenceThreads(4), 2);
  assert.equal(inferenceThreads(2), 2);
  // 코어 수를 모르면(구버전 네이티브) 지금까지 돌던 값으로 둔다.
  for (const value of [null, undefined, 0, -4, Number.NaN, '8']) assert.equal(inferenceThreads(value), 2);
});
