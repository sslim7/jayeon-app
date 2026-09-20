/**
 * 폰 받아쓰기가 실패로 끝났을 때 화면이 무엇을 내주는가(→ `src/lib/asr-outcome.ts`).
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **여기서 지키는 한 줄은 「7분치를 사용자가 스스로 버리게 하지 않는다」다.** 실기기에서 │
 * │ 28분 통화를 7분 18초에 다 받아썼는데 서버 전송이 404 로 실패했고, 화면에는 「처음부터   │
 * │ 다시」와 「포기하기」만 있었다. 그 두 개는 **둘 다 받아쓴 원문을 버리는 버튼**이다.      │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const realms = { Error, Set, Map, JSON, Date, Number, Math, RegExp, String, Object, Array };
const load = (file, mocks = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports,require){${compile(file)}\n})`, { ...realms })(module.exports, name => {
    if (!(name in mocks)) throw new Error(`unmocked ${name}`);
    return mocks[name];
  });
  return module.exports;
};

// 🔴 영구/재시도 판정은 **실제 구현**을 태운다. 가짜로 바꾸면 「CLIENT_TRANSCRIPT_TIMEOUT 은
// 영구가 아니다」 같은 규칙이 여기서만 참이고 앱에서는 거짓일 수 있다.
const callErrors = load('src/lib/call-errors.ts');
const { asrFailurePlan, asrResumePlan, asrSendRetryable, ASR_TIMEOUT_CODE } = load('src/lib/asr-outcome.ts', {
  './call-errors': callErrors,
});

/** 실기기에서 실제로 났던 상태: 받아쓰기는 끝났고 전송만 404. */
const sent = code => asrFailurePlan({ hasTranscript: true, code });
const transcribed = code => asrFailurePlan({ hasTranscript: false, code });

test('전송 실패는 받아쓰기 실패와 다른 화면이다', () => {
  const send = sent('HTTP_500');
  const local = transcribed('UNKNOWN');
  assert.equal(send.stage, 'send');
  assert.equal(local.stage, 'transcribe');
  // 🔴 제목이 갈려야 한다. 「끝내지 못했습니다」만 남으면 7분이 날아간 줄 안다.
  assert.notEqual(send.title, local.title);
  assert.match(send.title, /받아쓰기는 끝났/);
  assert.match(send.message, /받아쓰기는 끝냈고/);
  // 받아쓰기 실패 쪽에는 「원문이 남아 있다」는 말이 있으면 안 된다 — 남은 원문이 없다.
  assert.equal(local.notes.some(note => /저장/.test(note)), false);
});

test('🔴 404 로 전송이 실패해도 「원문 서버 전송」이 있다', () => {
  /*
    실기기에서 바로 이것이 없었다. `permanentFailure('HTTP_404')` 가 참이라 버튼이 걷혔고,
    남은 선택지는 「처음부터 다시」와 「포기하기」뿐이었다 — 둘 다 원문을 버린다.
  */
  assert.equal(callErrors.permanentFailure('HTTP_404'), true, '전제: 일반 판정은 404 를 영구로 본다');
  const plan = sent('HTTP_404');
  assert.equal(plan.action, 'resend');
  assert.equal(plan.actionLabel, '원문 서버 전송');
  // 왜 지금 다시 보내면 되는지도 말해 준다.
  assert.equal(plan.notes.some(note => /서버 쪽이 준비되면/.test(note)), true);
  // 405 도 같은 성격이다(경로는 있는데 메서드가 아직 없다).
  assert.equal(sent('HTTP_405').action, 'resend');
});

test('재시도 가능한 전송 실패는 전부 보내기를 권한다', () => {
  for (const code of ['UPLOAD_NETWORK', 'HTTP_500', 'HTTP_503', 'HTTP_408', 'HTTP_429', 'UNKNOWN']) {
    const plan = sent(code);
    assert.equal(plan.action, 'resend', `${code} 는 다시 보낼 수 있어야 한다`);
    assert.equal(asrSendRetryable(code), true, code);
    // 「다시 보내도 같다」는 말이 섞이면 안 된다.
    assert.equal(plan.notes.some(note => /같은 답이 옵니다/.test(note)), false, code);
  }
});

test('⚠️ CLIENT_TRANSCRIPT_TIMEOUT 은 영구가 아니다 — 지금 보내면 들어간다', () => {
  // 서버가 6시간 뒤 통화를 정리해도 늦게 온 전사문은 받아 준다(서버 계약).
  assert.equal(asrSendRetryable(ASR_TIMEOUT_CODE), true);
  const plan = sent(ASR_TIMEOUT_CODE);
  assert.equal(plan.action, 'resend');
  assert.equal(plan.notes.some(note => /지금 보내면 들어갑니다/.test(note)), true);
  // 포기하라는 말이 함께 뜨면 안 된다.
  assert.equal(plan.notes.some(note => /길은 닫혔습니다/.test(note)), false);
});

test('영구 실패는 버튼 대신 「다시 보내도 같다」를 말한다', () => {
  for (const code of ['CALL_NOT_CLIENT_ASR', 'CALL_ALREADY_COMPLETED', 'CALL_EMPTY_TRANSCRIPT', 'CALL_TOO_LARGE', 'CALL_NOT_FOUND']) {
    const plan = sent(code);
    assert.equal(plan.action, null, `${code} 에는 버튼을 세우지 않는다`);
    assert.equal(plan.actionLabel, '', code);
    assert.equal(plan.notes.some(note => /같은 답이 옵니다/.test(note)), true, code);
    // 🔴 그래도 「원문은 폰에 있다」는 말은 남는다. 버튼이 없다고 자료까지 사라진 것은 아니다.
    assert.equal(plan.notes[0].includes('폰에 저장돼 있습니다'), true, code);
  }
});

test('🔴 전송 실패에서는 「처음부터 다시」를 한 번 더 묻고 내준다', () => {
  // 원문을 들고 있는 상태의 「처음부터 다시」는 사실상 지우기 버튼이다.
  for (const code of ['HTTP_404', 'HTTP_500', 'CALL_NOT_CLIENT_ASR', ASR_TIMEOUT_CODE]) {
    assert.equal(sent(code).restartGuarded, true, code);
  }
  // 받아쓰기가 아직 안 끝났으면 버릴 원문이 없다 — 그때는 평소대로 바로 내준다.
  for (const code of ['UNKNOWN', 'ASR_MODEL_MISSING', 'HTTP_500']) {
    assert.equal(transcribed(code).restartGuarded, false, code);
  }
});

test('받아쓰기 실패는 영구일 때만 버튼을 걷는다', () => {
  const retry = transcribed('UNKNOWN');
  assert.equal(retry.action, 'retry');
  assert.equal(retry.actionLabel, '이어서 받아쓰기');

  // 폰 쪽이 막힌 실패는 눌러도 같다. 대신 서버 받아쓰기로 가는 길을 알려 준다.
  for (const code of ['ASR_MODEL_MISSING', 'ASR_AUDIO_MISSING', 'ASR_CONVERT_FAILED']) {
    const plan = transcribed(code);
    assert.equal(plan.action, null, code);
    assert.equal(plan.notes.some(note => /서버 받아쓰기로 다시 등록/.test(note)), true, code);
  }
});

test('실패 문장에는 코드가 붙는다', () => {
  // 다음 사람이 화면 사진만 보고 원인을 짚을 수 있어야 한다(→ `lib/call-errors.ts`).
  assert.match(sent('HTTP_404').message, /\(코드: HTTP_404\)/);
  assert.match(transcribed('ASR_CONVERT_FAILED').message, /\(코드: ASR_CONVERT_FAILED\)/);
});

test('🔴 저장된 원문이 있으면 받아쓰기를 건너뛰고 그 사실을 말한다', () => {
  const plan = asrResumePlan({ fresh: false, pending: '여보세요 네 안녕하세요' });
  assert.equal(plan.skipTranscribe, true);
  assert.match(plan.note, /건너뛰고/);
  assert.match(plan.note, /보내기부터/);
});

test('건너뛸 것이 없으면 아무 말도 하지 않는다', () => {
  for (const pending of [null, '', '   ', '\n\t ']) {
    const plan = asrResumePlan({ fresh: false, pending });
    assert.equal(plan.skipTranscribe, false, JSON.stringify(pending));
    // ⚠️ 빈 줄을 띄우지 않는다. 할 말이 없으면 칸 자체가 서지 않아야 한다.
    assert.equal(plan.note, '', JSON.stringify(pending));
  }
});

test('「처음부터 다시」는 저장된 원문을 버리기로 한 선택이라 건너뛰지 않는다', () => {
  const plan = asrResumePlan({ fresh: true, pending: '이미 받아쓴 28분치' });
  assert.equal(plan.skipTranscribe, false);
  assert.equal(plan.note, '');
});
