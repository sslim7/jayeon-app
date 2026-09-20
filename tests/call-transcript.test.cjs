/**
 * 폰에서 받아쓴 원문을 서버로 보내는 한 걸음(→ `src/lib/call-transcript.ts`).
 *
 * 🔴 여기서 확인하는 것은 **28분치 받아쓰기를 잃지 않는 조건**이다: 어떤 실패에 다시
 * 보내야 하고, 어떤 실패에 보내 봐야 소용없는지.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const realms = { Error, Set, Map, JSON, Date, Number, Math, RegExp, String, Promise, Object, Array, encodeURIComponent };
const load = (file) => { const mod = { exports: {} }; vm.runInNewContext(`(function(exports){${compile(file)}\n})`, { ...realms })(mod.exports); return mod.exports; };
// 실패 분류는 **실제 구현을 그대로 쓴다.** 가짜로 바꾸면 「다시 보낼 값어치가 있나」를
// 검사하는 의미가 사라진다.
const callErrors = load('src/lib/call-errors.ts');

class ApiError extends Error {
  constructor(status, body) { super(`API error ${status}`); this.status = status; this.body = body; this.name = 'ApiError'; }
  get code() { return typeof this.body?.code === 'string' ? this.body.code : null; }
}
class ApiTimeoutError extends Error { constructor() { super('timeout'); this.name = 'ApiTimeoutError'; } }

function setup(seed = {}) {
  const log = [];
  const mocks = {
    '@/lib/api': { ApiError, ApiTimeoutError },
    // 기본 `deps` 가 이 값을 붙잡으므로, 아무것도 넘기지 않아도 서버를 부르지 않는다.
    '@/lib/call-api': { callApi: { transcript: async (id, body) => { log.push({ id, body }); if (seed.error) throw seed.error; return { call_id: id, status: 'ANALYZING' }; } } },
    '@/lib/call-errors': callErrors,
  };
  const mod = { exports: {} };
  vm.runInNewContext(`(function(exports,require){${compile('src/lib/call-transcript.ts')}\n})`, { ...realms })(mod.exports, name => {
    if (!(name in mocks)) throw new Error(`unmocked ${name}`);
    return mocks[name];
  });
  return { ...mod.exports, log };
}

const CALL = '7b3f0a1e-0000-4000-8000-000000000001';

test('원문은 다듬어서 보내고, 구간을 주지 않으면 빈 배열로 둔다', async () => {
  const { sendCallTranscript, log } = setup();
  const record = await sendCallTranscript(CALL, '  여보세요 네 안녕하세요  ');
  assert.equal(record.status, 'ANALYZING');
  assert.equal(log.length, 1);
  assert.equal(log[0].id, CALL);
  assert.equal(log[0].body.text, '여보세요 네 안녕하세요');
  // ⚠️ 구간을 모으기 전에 시작한 받아쓰기를 이어받은 경우다. 없는 타임코드를 지어내지 않는다.
  // (vm 안에서 만든 배열이라 `deepEqual` 대신 모양으로 본다 — 프로토타입이 다른 실행 환경이다.)
  assert.equal(Array.isArray(log[0].body.segments), true);
  assert.equal(log[0].body.segments.length, 0);
});

test('서버가 거절할 것이 확실한 두 가지는 보내기 전에 걸러낸다', async () => {
  for (const text of ['', '   ', '\n\t ']) {
    const { sendCallTranscript, log } = setup();
    const error = await sendCallTranscript(CALL, text).catch(e => e);
    assert.equal(error.code, 'CALL_EMPTY_TRANSCRIPT');
    assert.equal(error.permanent, true);
    assert.equal(log.length, 0, '빈 원문은 요청 자체를 내지 않는다');
  }
  // 6 MiB 를 넘으면 올린 끝에 413 을 받는다 — 느린 회선에서는 그것만으로 몇 분이다.
  const { sendCallTranscript, log, TRANSCRIPT_MAX_BYTES } = setup();
  const huge = '가'.repeat(Math.ceil(TRANSCRIPT_MAX_BYTES / 3) + 1); // 한글 한 글자 = 3바이트
  const error = await sendCallTranscript(CALL, huge).catch(e => e);
  assert.equal(error.code, 'CALL_TOO_LARGE');
  assert.equal(error.permanent, true);
  assert.equal(log.length, 0);
});

test('한도 판정은 글자 수가 아니라 UTF-8 바이트로 한다', () => {
  const { utf8Bytes } = setup();
  assert.equal(utf8Bytes('abc'), 3);
  assert.equal(utf8Bytes('가'), 3);
  assert.equal(utf8Bytes('여보세요'), 12);
  // 서로게이트 쌍은 둘이 합쳐 4바이트다. 글자 수로 세면 한도를 잘못 잡는다.
  assert.equal(utf8Bytes('😀'), 4);
  assert.equal(utf8Bytes('가a😀'), 3 + 1 + 4);
  // 한도 바로 아래는 통과해야 한다 — 딱 맞는 원문을 거절하면 28분치를 버리게 된다.
  const { sendCallTranscript, TRANSCRIPT_MAX_BYTES } = setup();
  const edge = '가'.repeat(Math.floor(TRANSCRIPT_MAX_BYTES / 3));
  assert.equal(utf8Bytes(edge) <= TRANSCRIPT_MAX_BYTES, true);
  return sendCallTranscript(CALL, edge);
});

test('응답을 못 받은 실패는 다시 보낼 값어치가 있다', async () => {
  // 서버는 같은 요청을 두 번 받아도 200 이다 — 그래서 시간 초과는 영구 실패가 아니다.
  const timeout = setup({ error: new ApiTimeoutError() });
  const first = await timeout.sendCallTranscript(CALL, '원문').catch(e => e);
  assert.equal(first.code, 'UPLOAD_NETWORK');
  assert.equal(first.permanent, false);

  // 5xx 도 마찬가지다.
  const server = setup({ error: new ApiError(503, {}) });
  const second = await server.sendCallTranscript(CALL, '원문').catch(e => e);
  assert.equal(second.code, 'HTTP_503');
  assert.equal(second.permanent, false);
});

test('다시 보내면 같은 통화 ID 로 같은 원문이 한 번 더 나간다', async () => {
  const fail = { error: new ApiTimeoutError() };
  const attempt = setup(fail);
  await attempt.sendCallTranscript(CALL, '원문').catch(() => {});
  assert.equal(attempt.log.length, 1);
  // 🔴 재시도는 **새 ID 를 뽑지 않는다.** 서버가 기다리고 있는 통화는 그 ID 하나뿐이다.
  fail.error = null;
  const record = await attempt.sendCallTranscript(CALL, '원문');
  assert.equal(attempt.log.length, 2);
  assert.equal(attempt.log[1].id, CALL);
  assert.equal(attempt.log[1].body.text, attempt.log[0].body.text);
  assert.equal(record.status, 'ANALYZING');
});

test('서버가 코드로 거절하면 그 코드가 그대로 나오고 영구 여부가 갈린다', async () => {
  const cases = [
    // 🔴 이 통화는 서버 받아쓰기로 잡혀 있다. 몇 번을 보내도 받지 않는다.
    [new ApiError(409, { code: 'CALL_NOT_CLIENT_ASR' }), 'CALL_NOT_CLIENT_ASR', true],
    [new ApiError(409, { code: 'CALL_ALREADY_COMPLETED' }), 'CALL_ALREADY_COMPLETED', true],
    [new ApiError(400, { code: 'CALL_EMPTY_TRANSCRIPT' }), 'CALL_EMPTY_TRANSCRIPT', true],
    [new ApiError(413, { code: 'CALL_TOO_LARGE' }), 'CALL_TOO_LARGE', true],
    [new ApiError(404, { code: 'CALL_NOT_FOUND' }), 'CALL_NOT_FOUND', true],
    // ⚠️ 세션 문제는 다시 걸어 볼 값어치가 있다.
    [new ApiError(401, {}), 'HTTP_401', false],
  ];
  for (const [thrown, code, permanent] of cases) {
    const { sendCallTranscript } = setup({ error: thrown });
    const error = await sendCallTranscript(CALL, '원문').catch(e => e);
    assert.equal(error.code, code);
    assert.equal(error.permanent, permanent, `${code} 의 영구 여부가 어긋난다`);
    assert.equal(error.name, 'TranscriptSendError');
  }
});

test('「이미 끝났다」는 부른 쪽이 성공으로 읽을 수 있게 이름이 따로 있다', async () => {
  const { ALREADY_DONE, sendCallTranscript } = setup({ error: new ApiError(409, { code: 'CALL_ALREADY_COMPLETED' }) });
  assert.equal(ALREADY_DONE, 'CALL_ALREADY_COMPLETED');
  const error = await sendCallTranscript(CALL, '원문').catch(e => e);
  // 화면은 이 코드만 따로 집어 「보냈습니다」로 끝낸다 — 끝난 일을 빨간 글씨로 그리면
  // 사용자는 계속 다시 누른다.
  assert.equal(error.code, ALREADY_DONE);
});

test('서버 본문 문구는 화면으로 새지 않는다', async () => {
  // 🔴 응답 본문에는 요청 내용이 되비칠 수 있다. 우리가 아는 코드가 아니면 상태 코드만 남긴다.
  const { sendCallTranscript } = setup({ error: new ApiError(400, { code: 'VALIDATION_FAILED', message: '/data/user/0/kr.redhead.nature/files/x.wav' }) });
  const error = await sendCallTranscript(CALL, '원문').catch(e => e);
  assert.equal(error.code, 'HTTP_400');
  assert.doesNotMatch(error.code, /nature/);

  // 네이티브 예외에는 파일 경로가 섞인다. 그것도 코드로 내보내지 않는다.
  const native = setup({ error: new Error('/data/user/0/kr.redhead.nature/files/call.wav: no such file') });
  const failure = await native.sendCallTranscript(CALL, '원문').catch(e => e);
  assert.equal(failure.code, 'UNKNOWN');
});


/* ── 구간 ─────────────────────────────────────────────────────────────
   🔴 통화 원문 화면은 **구간을 그리지 글 전체를 그리지 않는다.** 여기서 구간을 빠뜨리면
   서버에 9,722자가 멀쩡히 들어가 있는데도 화면이 「저장된 통화 원문이 없습니다」로 빈다 —
   실제로 그렇게 됐다.
   ─────────────────────────────────────────────────────────────────── */

test('구간은 초 단위로 실어 보낸다 — 폰은 ms 로 센다', async () => {
  const { sendCallTranscript, log } = setup();
  await sendCallTranscript(CALL, '여보세요 네 안녕하세요', [
    { startMs: 0, endMs: 4_500, text: '여보세요' },
    { startMs: 131_000, endMs: 135_500, text: '  네 안녕하세요  ' },
  ]);
  const sent = Array.from(log[0].body.segments, s => ({ start: s.start, end: s.end, text: s.text }));
  // ⚠️ 단위를 섞으면 28분 통화의 구간이 전부 첫 2초 안에 몰린다 — 실패하지 않고 조용히 틀린다.
  assert.deepEqual(sent, [
    { start: 0, end: 4.5, text: '여보세요' },
    { start: 131, end: 135.5, text: '네 안녕하세요' },
  ]);
});

test('화자를 지어내지 않는다', async () => {
  const { sendCallTranscript, log } = setup();
  await sendCallTranscript(CALL, '여보세요', [{ startMs: 0, endMs: 1_000, text: '여보세요' }]);
  /*
    🔴 폰 whisper 에는 화자 정보가 **아예 없다.** 「0」이나 빈 문자열이라도 실어 보내면 통화
    원문 화면이 좌우로 갈린 대화를 그리는데, 그 좌우는 우리가 지어낸 것이다
    (→ `components/call-transcript.tsx` 의 `split` 판정).
  */
  assert.deepEqual(Array.from(Object.keys(log[0].body.segments[0])).sort(), ['end', 'start', 'text']);
});

test('빈 글·깨진 숫자의 구간은 보내지 않는다', async () => {
  const { sendCallTranscript, log } = setup();
  await sendCallTranscript(CALL, '여보세요', [
    { startMs: 0, endMs: 1_000, text: '   ' },
    { startMs: NaN, endMs: 2_000, text: '깨짐' },
    { startMs: 3_000, endMs: 4_000, text: '성한 말' },
  ]);
  // 서버 스키마는 빈 글의 구간을 거절한다. 하나 때문에 28분치를 되돌려받을 이유가 없다.
  assert.equal(log[0].body.segments.length, 1);
  assert.equal(log[0].body.segments[0].text, '성한 말');
});

test('구간 쪽 글자도 한도에 함께 센다', async () => {
  const { sendCallTranscript, log, TRANSCRIPT_MAX_BYTES } = setup();
  // 🔴 구간이 붙으면서 같은 글이 본문에 **두 번** 들어간다. 글자 쪽만 재면 한도 판정이
  // 실제 크기의 절반만 보고, 그 답은 「6 MiB 를 다 올린 끝에 413」이다.
  const half = '가'.repeat(Math.floor(TRANSCRIPT_MAX_BYTES / 3 / 2) + 1);
  const error = await sendCallTranscript(CALL, half, [{ startMs: 0, endMs: 1_000, text: half }]).catch(e => e);
  assert.equal(error.code, 'CALL_TOO_LARGE');
  assert.equal(error.permanent, true);
  assert.equal(log.length, 0);
});

/* ── 원문 화면이 그릴 것 ───────────────────────────────────────────── */

test('구간이 있으면 대화로 그린다', () => {
  const { transcriptView } = setup();
  const view = transcriptView({ text: '여보세요 네', segments: [{ start: 0, end: 1, text: '여보세요' }] });
  assert.equal(view.kind, 'talk');
  assert.equal(view.segments.length, 1);
});

test('구간이 없고 글만 있으면 그 글이라도 보여 준다', () => {
  const { transcriptView } = setup();
  /*
    🔴 **이 폴백이 없으면 이미 저장된 통화 하나를 영영 못 본다.** 폰이 구간 없이 보낸
    전사문이 서버에 그대로 있고, 화면은 구간만 그렸다.
    ⚠️ 읽기 좋은 모양은 아니다 — 만 자가 문단 하나가 된다. 정상은 위의 `talk` 쪽이고
    이것은 안전망이다.
  */
  const view = transcriptView({ text: '  여보세요. 네, 여보세요.  ', segments: [] });
  assert.equal(view.kind, 'plain');
  assert.equal(view.text, '여보세요. 네, 여보세요.');
});

test('둘 다 없으면 없다고 말한다', () => {
  const { transcriptView } = setup();
  // 빈 화면은 「불러오는 중」과 구분되지 않는다. 없다는 것도 화면이 말해야 한다.
  for (const value of [null, undefined, { text: '', segments: [] }, { text: '   ', segments: [] }]) {
    assert.equal(transcriptView(value).kind, 'none');
  }
});
