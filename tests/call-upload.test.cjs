const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const realms = { Error, Set, Map, JSON, Date, Number, Math, RegExp, String, Promise, encodeURIComponent, unescape };
const load = (file, extra = {}) => { const mod = { exports: {} }; vm.runInNewContext(`(function(exports){${compile(file)}\n})`, { ...realms, ...extra })(mod.exports); return mod.exports; };
// 실패 분류와 파일 규칙은 **실제 구현을 그대로 쓴다.** 가짜로 바꾸면 「서버가 받을 값인가」를
// 검사하는 의미가 없어진다.
const callErrors = load('src/lib/call-errors.ts');
const callFile = load('src/lib/call-file.ts');

class ApiError extends Error {
  constructor(status, body) { super(`API error ${status}`); this.status = status; this.body = body; this.name = 'ApiError'; }
  get code() { return typeof this.body?.code === 'string' ? this.body.code : null; }
}
class ApiTimeoutError extends Error { constructor() { super('timeout'); this.name = 'ApiTimeoutError'; } }

const TICKET = { call_id: 'x', method: 'PUT', url: 'https://storage.test/o?sig=1', headers: { 'Content-Type': 'audio/m4a' }, object: 'calls/u/x/audio.m4a', expires_at: '', max_bytes: 104857600, retention_days: 366 };

function setup(seed = {}) {
  const log = [];
  let uuid = 0;
  const api = {
    uploadUrl: async (id, body) => {
      log.push({ step: 'upload-url', id, body });
      if (seed.uploadUrlError) throw seed.uploadUrlError;
      return TICKET;
    },
    complete: async (id, asr) => {
      // 🔴 두 번째 인자를 함께 적는다 — 「폰에서 받아쓴다」는 사실이 여기로만 전해진다.
      log.push({ step: 'complete', id, asr });
      if (seed.completeError) throw seed.completeError;
      return { call_id: id, status: 'PREPARING', progress: 0.05, job_state: 'QUEUED' };
    },
  };
  const put = async (file, url, headers, options) => {
    log.push({ step: 'put', url, headers, file });
    if (options?.signal?.aborted) throw new Error('UPLOAD_CANCELED');
    options?.onProgress?.(0.5);
    if (seed.putError) throw seed.putError;
    options?.onProgress?.(1);
  };
  const mocks = {
    'expo-crypto': { randomUUID: () => `00000000-0000-0000-0000-${String(++uuid).padStart(12, '0')}` },
    '@/lib/api': { ApiError, ApiTimeoutError },
    '@/lib/call-api': { callApi: api },
    '@/lib/call-errors': callErrors,
    '@/lib/call-file': callFile,
    '@/lib/call-put': { putCallAudio: put },
  };
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports,require){${compile('src/lib/call-upload.ts')}\n})`, { ...realms })(module.exports, name => {
    if (!(name in mocks)) throw new Error(`unmocked ${name}`);
    return mocks[name];
  });
  return { ...module.exports, log };
}

const FILE = { name: 'call.m4a', size: 2_000_000, content_type: 'audio/m4a', modified_at: null, source: { kind: 'web', file: {} } };
const CONTACT = { name: '김고객', phone: '021234567' };
const AT = '2026-09-18T05:00:00.000Z';
const NOW = () => Date.parse('2026-09-18T06:00:00.000Z');
const input = (extra = {}) => ({ file: FILE, contact: CONTACT, recorded_at: AT, ...extra });

test('등록은 upload-url → PUT → complete 순서로 딱 한 번씩 부른다', async () => {
  const { uploadCall, log } = setup();
  const result = await uploadCall(input(), { now: NOW });
  assert.deepEqual(log.map(entry => entry.step), ['upload-url', 'put', 'complete']);
  // 같은 통화 ID 로 세 걸음이 이어져야 한다 — 객체 경로가 이 ID 로 정해진다.
  assert.equal(log[0].id, result.callId);
  assert.equal(log[2].id, result.callId);
  assert.equal(result.record.status, 'PREPARING');
});

test('서명에 들어간 헤더를 글자 그대로 싣는다', async () => {
  const { uploadCall, log } = setup();
  await uploadCall(input(), { now: NOW });
  // 🔴 한 글자만 달라도 GCS 가 403 을 준다. 우리가 만든 값이 아니라 **서버가 준 값**이어야 한다.
  assert.deepEqual({ ...log[1].headers }, { 'Content-Type': 'audio/m4a' });
  assert.equal(log[1].url, TICKET.url);
});

test('길이는 지어내지 않고 서버가 전사 뒤에 채우게 둔다', async () => {
  const { uploadCall, log } = setup();
  await uploadCall(input(), { now: NOW });
  const body = log[0].body;
  assert.equal(body.call.duration, null);
  assert.equal(body.content_type, 'audio/m4a');
  assert.equal(body.size, 2_000_000);
  assert.equal(body.call.recorded_at, AT);
  // 수신자 ID 가 없으면 키 자체를 넣지 않는다(서버가 모르는 키를 400 으로 거부한다).
  assert.equal('recipient_id' in body.contact, false);
});

test('진행률은 전송기가 센 값을 그대로 올려 준다', async () => {
  const { uploadCall } = setup();
  const seen = [];
  await uploadCall(input(), { now: NOW, onProgress: value => seen.push(value) });
  assert.deepEqual(seen, [0.5, 1]);
});

test('취소하면 큐잉까지 가지 않고 UPLOAD_CANCELED 로 끝난다', async () => {
  const { uploadCall, log } = setup();
  const controller = new AbortController();
  controller.abort();
  const error = await uploadCall(input(), { now: NOW, signal: controller.signal }).catch(e => e);
  assert.equal(error.code, 'UPLOAD_CANCELED');
  // 주소는 받았지만 올리지도 큐에 넣지도 않았다.
  assert.deepEqual(log.map(entry => entry.step), ['upload-url']);
});

test('이미 큐에 들어간 통화는 다시 올리지 않고 complete 만 부른다', async () => {
  // 앞선 시도에서 업로드까지 끝났는데 complete 응답을 받지 못한 경우다.
  const { uploadCall, log } = setup({ uploadUrlError: new ApiError(409, { code: 'CALL_ALREADY_QUEUED' }) });
  const result = await uploadCall(input(), { now: NOW, callId: 'call-1' });
  assert.deepEqual(log.map(entry => entry.step), ['upload-url', 'complete']);
  assert.equal(result.callId, 'call-1');
  assert.equal(result.record.status, 'PREPARING');
});

test('재시도는 앞서 쓰던 ID 를 그대로 쓴다', async () => {
  const failing = setup({ putError: new Error('UPLOAD_NETWORK') });
  const error = await failing.uploadCall(input(), { now: NOW }).catch(e => e);
  assert.match(error.callId, /^00000000-/);
  const retry = setup();
  await retry.uploadCall(input(), { now: NOW, callId: error.callId });
  // 같은 ID 여야 저장소의 같은 객체를 덮어쓴다. 새 ID 면 못 쓰는 28MB 가 1년 남는다.
  assert.equal(retry.log[0].id, error.callId);
});

test('4xx 는 영구 실패, 5xx·연결 실패는 다시 보낼 값어치가 있다', async () => {
  const permanent = [
    new ApiError(400, { code: 'VALIDATION_FAILED' }),
    new ApiError(404, { code: 'CALL_NOT_FOUND' }),
    new ApiError(413, { code: 'CALL_TOO_LARGE' }),
    new Error('HTTP_400'),
  ];
  for (const failure of permanent) {
    const { uploadCall } = setup({ uploadUrlError: failure, putError: failure });
    const error = await uploadCall(input(), { now: NOW }).catch(e => e);
    assert.equal(error.permanent, true, `${failure.message} 는 영구 실패여야 한다`);
  }
  const retryable = [
    new ApiError(500, { code: 'INTERNAL_ERROR' }),
    new ApiError(429, {}),
    new ApiError(401, { code: 'UNAUTHORIZED' }),
    new ApiTimeoutError(),
    new Error('UPLOAD_NETWORK'),
    // 서명 URL 이 만료되면 저장소가 403 을 준다. 새 주소를 받으면 되는 실패라 재시도 쪽이다.
    new Error('HTTP_403'),
  ];
  for (const failure of retryable) {
    const { uploadCall } = setup({ uploadUrlError: failure });
    const error = await uploadCall(input(), { now: NOW }).catch(e => e);
    assert.equal(error.permanent, false, `${failure.message} 는 재시도 대상이어야 한다`);
  }
});

test('서버가 거절할 값은 서버를 부르기 전에 걸러낸다', async () => {
  const cases = [
    [input({ contact: { name: '', phone: '021234567' } }), 'INVALID_CONTACT'],
    [input({ contact: { name: '김고객', phone: '12' } }), 'INVALID_CONTACT'],
    [input({ contact: { name: '김고객', phone: '021234567', recipient_id: '어떤 값' } }), 'INVALID_CONTACT'],
    // 기기 시계가 5분 넘게 빠르면 서버가 거부한다. 현재 시각으로 고쳐 넣지 않고 이유를 밝힌다.
    [input({ recorded_at: '2026-09-18T06:10:00.000Z' }), 'INVALID_RECORDED_AT'],
    [input({ recorded_at: '언젠가' }), 'INVALID_RECORDED_AT'],
    [input({ file: { ...FILE, size: 0 } }), 'EMPTY_FILE'],
    [input({ file: { ...FILE, size: 104857601 } }), 'FILE_TOO_LARGE'],
  ];
  for (const [value, code] of cases) {
    const { uploadCall, log } = setup();
    const error = await uploadCall(value, { now: NOW }).catch(e => e);
    assert.equal(error.code, code);
    assert.equal(error.permanent, true);
    assert.equal(log.length, 0, `${code} 는 요청 전에 걸러야 한다`);
  }
  // 기기 시계가 조금 빠른 것은 인정한다(서버 허용치와 같은 5분).
  const ok = setup();
  await ok.uploadCall(input({ recorded_at: '2026-09-18T06:04:00.000Z' }), { now: NOW });
  assert.equal(ok.log.length, 3);
});

test('브라우저가 알려 준 MIME 이 아니라 확장자로 형식을 정한다', () => {
  const { audioContentType } = callFile;
  // 크롬은 audio/x-m4a, 사파리는 빈 문자열을 준다. 둘 다 서버 화이트리스트에 없다.
  assert.equal(audioContentType('call.m4a', 'audio/x-m4a'), 'audio/m4a');
  assert.equal(audioContentType('call.M4A', ''), 'audio/m4a');
  assert.equal(audioContentType('녹음.mp3', null), 'audio/mpeg');
  assert.equal(audioContentType('a.3gp', undefined), 'audio/3gpp');
  // 확장자를 모를 때만 브라우저 값을 본다.
  assert.equal(audioContentType('recording', 'audio/wav; codecs=1'), 'audio/wav');
  assert.throws(() => audioContentType('notes.txt', 'text/plain'), /UNSUPPORTED_TYPE/);
  assert.throws(() => audioContentType('recording', ''), /UNSUPPORTED_TYPE/);
});

/*
 * ── 폰에서 받아쓰는 통화(`asr: "client"`) ────────────────────────────────────
 *
 * 🔴 여기서 지키는 것은 **서버 경로가 한 글자도 바뀌지 않았다**는 사실이다. 체크를 끈
 * 등록은 이 기능이 생기기 전과 똑같은 요청을 내야 한다 — 그것이 이 기능의 안전망이다.
 */
test('받아쓰기를 고르지 않으면 complete 에 본문을 싣지 않는다', async () => {
  const { uploadCall, log } = setup();
  await uploadCall(input(), { now: NOW });
  const complete = log.find(entry => entry.step === 'complete');
  // 서버에서는 「생략」과 `"server"` 가 같은 뜻이지만, 예전 요청 모양을 그대로 둔다.
  assert.equal(complete.asr, undefined);
});

test('폰에서 받아쓰기로 등록하면 complete 에만 asr 가 실린다', async () => {
  const { uploadCall, log } = setup();
  const result = await uploadCall(input(), { now: NOW, asr: 'client' });
  assert.deepEqual(log.map(entry => entry.step), ['upload-url', 'put', 'complete']);
  // 🔴 **녹음은 어느 쪽이든 올라간다.** 받아쓰기를 누가 하느냐만 달라진다 — 업로드를
  // 건너뛰면 나중에 통화를 다시 들을 수 없다.
  assert.equal(log[1].step, 'put');
  assert.equal(log[2].asr, 'client');
  // 업로드 주소 요청은 받아쓰기와 무관하다. 여기에 끼워 넣으면 서버가 400 을 준다.
  assert.equal('asr' in log[0].body, false);
  assert.equal(result.record.status, 'PREPARING');
});

test('이미 큐잉된 통화를 다시 올릴 때도 asr 가 그대로 따라간다', async () => {
  // 앞선 시도에서 업로드까지는 끝났는데 `complete` 응답을 못 받은 경우다.
  const { uploadCall, log } = setup({ uploadUrlError: new ApiError(409, { code: 'CALL_ALREADY_QUEUED' }) });
  await uploadCall(input(), { now: NOW, asr: 'client' });
  assert.deepEqual(log.map(entry => entry.step), ['upload-url', 'complete']);
  // 🔴 여기서 빠뜨리면 서버는 이 통화를 **서버 받아쓰기**로 잡고, 앱이 보낸 전사문은
  // `CALL_NOT_CLIENT_ASR` 로 영원히 거절된다.
  assert.equal(log[1].asr, 'client');
});

test('서버 받아쓰기로 등록한 통화는 재시도에서도 본문이 없다', async () => {
  const { uploadCall, log } = setup({ uploadUrlError: new ApiError(409, { code: 'CALL_ALREADY_QUEUED' }) });
  await uploadCall(input(), { now: NOW });
  assert.equal(log[1].asr, undefined);
});
