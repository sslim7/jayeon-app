const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const errors = { exports: {} };
vm.runInNewContext(`(function(exports){${compile('src/lib/call-errors.ts')}\n})`, { Error, Set, Number, RegExp, String })(errors.exports);
const { callFailureText, callRetryable, failureCode, failureReason, failureText, httpCode, permanentFailure } = errors.exports;

test('실패 코드는 정해진 목록과 HTTP 코드만 통과하고 내부 문구는 버린다', () => {
  assert.equal(failureCode(new Error('EMPTY_TRANSCRIPT')), 'EMPTY_TRANSCRIPT');
  assert.equal(failureCode(new Error('UPLOAD_CANCELED')), 'UPLOAD_CANCELED');
  assert.equal(failureCode(new Error('HTTP_503')), 'HTTP_503');
  // 경로·원문이 섞인 네이티브 오류는 코드로도 내보내지 않는다.
  assert.equal(failureCode(new Error('/data/user/0/kr.redhead.nature/files/call-audio/x.m4a: no such file')), 'UNKNOWN');
  assert.equal(failureCode('문자열 오류'), 'UNKNOWN');
  assert.equal(failureCode(undefined), 'UNKNOWN');
});

test('실패 이유는 사람이 읽을 수 있는 한 줄이고 코드가 함께 남는다', () => {
  assert.match(failureReason('EMPTY_TRANSCRIPT'), /사람 말소리를 찾지 못했습니다/);
  assert.equal(httpCode(400), 'HTTP_400');
  assert.equal(httpCode(Number.NaN), 'UNKNOWN');
  assert.match(failureReason('HTTP_400'), /받지 않았습니다/);
  assert.match(failureReason('HTTP_503'), /통신하지 못했습니다/);
  // 공급자 코드는 우리가 뜻을 모른다. 아는 척하지 않되 코드는 남긴다.
  assert.match(failureReason('Throttling.RateQuota'), /알 수 없는/);
  const text = failureText('받아쓰기는 끝났지만 내용을 정리하지 못했습니다.', 'DataInspectionFailed');
  assert.match(text, /^받아쓰기는 끝났지만/);
  assert.match(text, /\(코드: DataInspectionFailed\)$/);
});

test('멈춘 자리에 따라 다음에 할 수 있는 일이 다르게 읽힌다', () => {
  assert.match(callFailureText({ status: 'TRANSCRIPTION_FAILED', error: 'EMPTY_TRANSCRIPT' }), /^녹음을 받아쓰지 못했습니다\./);
  assert.match(callFailureText({ status: 'ANALYSIS_FAILED', error: 'CONTENT_FILTERED' }), /^받아쓰기는 끝났지만/);
  // 서버가 코드를 빠뜨려도 빈 괄호를 보이지 않는다.
  assert.match(callFailureText({ status: 'ANALYSIS_FAILED' }), /\(코드: UNKNOWN\)$/);
  assert.match(callFailureText({ status: 'ANALYSIS_FAILED', error: '   ' }), /\(코드: UNKNOWN\)$/);
});

test('4xx 는 다시 보내도 같은 답이 오고, 세션·혼잡·5xx 는 재시도 대상이다', () => {
  for (const code of ['HTTP_400', 'HTTP_404', 'HTTP_409', 'HTTP_413', 'CALL_TOO_LARGE', 'UNSUPPORTED_TYPE', 'FILE_TOO_LARGE', 'INVALID_CONTACT', 'PERMANENT', 'CONTENT_FILTERED']) {
    assert.equal(permanentFailure(code), true, `${code} 는 영구 실패여야 한다`);
  }
  for (const code of ['HTTP_401', 'HTTP_403', 'HTTP_408', 'HTTP_429', 'HTTP_500', 'HTTP_503', 'UPLOAD_NETWORK', 'RETRYABLE', 'UNKNOWN']) {
    assert.equal(permanentFailure(code), false, `${code} 는 재시도 대상이어야 한다`);
  }
});

test('종료 상태로 오는 서버 코드는 무엇이 잘못됐는지까지 말한다', () => {
  // 서버가 재시도를 다 쓴 것이지 사용자가 기다릴 일이 아니다.
  assert.match(failureReason('RETRIES_EXHAUSTED'), /여러 번 다시 시도했지만/);
  assert.doesNotMatch(failureReason('RETRIES_EXHAUSTED'), /잠시 뒤/);
  // 🔴 회복 가능한 실패를 사람에게 떠넘기는 말은 어느 코드에도 남아 있으면 안 된다.
  for (const code of ['RETRYABLE', 'RETRIES_EXHAUSTED', 'BUDGET_TOO_SMALL', 'ProviderTimeout', 'MAX_ATTEMPTS']) {
    assert.doesNotMatch(failureReason(code), /잠시 뒤 다시 시도/, `${code} 문구가 기다리라고 말하면 안 된다`);
  }
  // 우리가 고쳐야 하는 실패는 그렇다고 말한다.
  assert.match(failureReason('BUDGET_TOO_SMALL'), /다시 시도해도 같으니 저희가 고쳐야 합니다/);
  assert.match(failureReason('ANALYSIS_TOO_LARGE'), /저희가 고쳐야 합니다/);
  assert.match(failureReason('RECORD_INVALID'), /저희가 고쳐야 하는 문제입니다/);
  // 사용자가 할 수 있는 일이 있으면 그것을 말한다.
  assert.match(failureReason('TRANSCRIPT_TOO_LARGE'), /나눠서 등록해 주세요/);
  assert.match(failureReason('INPUT_UNAVAILABLE'), /다시 등록해 주세요/);
  assert.match(failureReason('AUDIO_MISSING'), /다시 등록해 주세요/);
  assert.match(failureReason('EMPTY_ANALYSIS'), /다시 시도하면 나올 수 있습니다/);
  assert.match(failureReason('ProviderTimeout'), /제시간에 답하지 않았습니다/);
  // 옛 통화에 남아 있는 코드도 「알 수 없는 오류」로 떨어지지 않는다.
  assert.doesNotMatch(failureReason('MAX_ATTEMPTS'), /알 수 없는/);
});

test('같은 입력이면 같은 자리에서 막히는 실패에는 다시 시도할 길을 주지 않는다', () => {
  for (const code of ['BUDGET_TOO_SMALL', 'TRANSCRIPT_TOO_LARGE', 'ANALYSIS_TOO_LARGE', 'RECORD_INVALID', 'INPUT_UNAVAILABLE', 'AUDIO_MISSING', 'EMPTY_TRANSCRIPT']) {
    assert.equal(permanentFailure(code), true, `${code} 는 다시 눌러도 같다`);
    assert.equal(callRetryable({ status: 'ANALYSIS_FAILED', error: code }), false, `${code} 에는 버튼을 세우지 않는다`);
  }
  // ⚠️ 버튼 자체가 사라지면 안 된다 — 서버가 시도를 다 쓴 뒤 사람이 판단할 길이다.
  for (const code of ['RETRIES_EXHAUSTED', 'EMPTY_ANALYSIS', 'ProviderTimeout', 'MAX_ATTEMPTS', 'DataInspectionFailed', 'UNKNOWN']) {
    assert.equal(callRetryable({ status: 'ANALYSIS_FAILED', error: code }), true, `${code} 는 한 번 더 돌릴 값어치가 있다`);
  }
  // 받아쓰기가 실패한 통화에는 다시 분석할 원문이 없다. 코드와 무관하게 버튼을 세우지 않는다.
  assert.equal(callRetryable({ status: 'TRANSCRIPTION_FAILED', error: 'RETRIES_EXHAUSTED' }), false);
  assert.equal(callRetryable({ status: 'COMPLETED' }), false);
});
