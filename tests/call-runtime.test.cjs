const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = compile('src/lib/call-runtime.ts');
// 업로드 직전 정리는 실제 구현을 그대로 쓴다. 서버 계약을 흉내 낸 가짜로는 걸러지는지 알 수 없다.
const realms = { Error, Set, Map, JSON, Date, Number, Math, encodeURIComponent, unescape };
const analysisModule = { exports: {} };
vm.runInNewContext(`(function(exports){${compile('src/lib/call-analysis.ts')}\n})`, { ...realms })(analysisModule.exports);
const sample = { schema_version: 1, summary: '견적을 요청했다.', details: [], todos: [], decisions: [], consulting: { customer_needs: [], questions: [], concerns: [], objections: [], important_points: [], followups: [] } };
class ApiError extends Error {
  constructor(status) { super(`API error ${status}`); this.status = status; this.name = 'ApiError'; }
}
function setup(seed = {}) {
  let owner = 'a'; let version = 1; let uuid = 0; let listener;
  const rows = seed.rows ?? new Map(); const chunks = seed.chunks ?? new Map(); const sync = seed.sync ?? new Map();
  const calls = { stt: 0, llm: 0, upload: 0, payload: null };
  const failures = { llm: false, upload: false, uploadStatus: 0 }; let duringLlm;
  let segments = seed.segments ?? [{ t0: 0, t1: 3000, text: '견적 주세요.' }];
  const copy = value => value == null ? value : structuredClone(value);
  const store = {
    listCalls: async owner => [...rows.entries()].filter(([key]) => key.startsWith(owner + ':')).map(([, value]) => copy(value)),
    readCall: async (owner, id) => copy(rows.get(`${owner}:${id}`)),
    saveCall: async (owner, call) => rows.set(`${owner}:${call.call_id}`, copy(call)),
    publicCall: call => { const { local_file_uri, wav_uri, ...rest } = call; return rest; },
    saveChunk: async (owner, id, key, value) => chunks.set(`${owner}:${id}:${key}`, copy(value)),
    readChunk: async (owner, id, key) => copy(chunks.get(`${owner}:${id}:${key}`)),
    clearChunks: async (owner, id) => { for (const key of [...chunks.keys()]) if (key.startsWith(`${owner}:${id}:`)) chunks.delete(key); },
    clearAnalysis: async (owner, id) => store.clearChunks(owner, id),
    syncAttempt: async (owner, id) => {
      const current = sync.get(`${owner}:${id}`) ?? { retry_count: 0 };
      sync.set(`${owner}:${id}`, { retry_count: current.retry_count + 1, last_attempt_at: new Date().toISOString() });
    },
    syncSettled: async (owner, id) => sync.set(`${owner}:${id}`, { retry_count: 0, last_attempt_at: new Date().toISOString() }),
    syncState: async (owner, id) => sync.get(`${owner}:${id}`) ?? { retry_count: 0, last_attempt_at: null },
  };
  const analysis = {
    analysisInstruction: 'system', analysisSchema: {}, chunkTranscript: segments => [segments],
    parseAnalysis: JSON.parse, mergeAnalyses: (parts, summary) => ({ ...parts[0], summary }),
    sanitizeTranscript: analysisModule.exports.sanitizeTranscript, capSummary: analysisModule.exports.capSummary,
  };
  const mocks = {
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener() {} } },
    'expo-file-system/legacy': { documentDirectory: 'file:///private/', getInfoAsync: async () => ({ exists: true }), makeDirectoryAsync: async () => {}, copyAsync: async () => {}, deleteAsync: async () => {} },
    'expo-document-picker': { getDocumentAsync: async () => ({ canceled: false, assets: [{ name: 'call.m4a', size: 100, uri: 'file:///cache/audio' }] }) },
    'expo-crypto': { randomUUID: () => `00000000-0000-0000-0000-${String(++uuid).padStart(12, '0')}` },
    '@/store/user-store': { useUserStore: { getState: () => ({ stage: 'authed', profile: { userId: owner } }), subscribe: callback => { listener = callback; } } },
    '@/lib/auth-tokens': { getSessionVersion: () => version }, '@/config/env': { ENV: { apiUrl: 'https://nature.test' } },
    '@/lib/api': { ApiError, api: { put: async (path, body) => { calls.upload++; calls.payload = body; if (failures.uploadStatus) throw new ApiError(failures.uploadStatus); if (failures.upload) throw Error('offline'); } } },
    './call-analysis': analysis, './call-store': store,
    './call-models': { modelState: async () => ({ installed: true }), installModels: async () => {}, pauseModelDownload: async () => {}, excludeFromBackup: async () => {}, modelPath: index => `model${index}`, MODEL_FILES: [{}, { name: 'qwen', version: 'v1' }], audioNative: () => ({ decode: async () => 30 }) },
    'whisper.rn/index': { initWhisper: async () => ({ transcribe: () => { calls.stt++; return { stop: async () => {}, promise: Promise.resolve({ result: '견적 주세요.', segments }) }; }, release: async () => {} }) },
    'llama.rn': { initLlama: async () => ({ tokenize: async () => ({ tokens: [1, 2] }), completion: async () => { calls.llm++; await duringLlm?.(); if (failures.llm) throw Error('out of memory'); return { text: JSON.stringify(sample) }; }, stopCompletion: async () => {}, release: async () => {} }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports,require){${compiled}\n})`, { ...realms, Promise, __DEV__: false, setInterval() {} })(module.exports, name => { if (!(name in mocks)) throw Error(name); return mocks[name]; });
  const device = module.exports.callDevice;
  async function start(overrides = {}) {
    const file = await device.pickFile();
    return device.start({ file, contact: { name: '고객', phone: '021234567' }, recorded_at: '2026-09-01T00:00:00.000Z', ...overrides });
  }
  async function idle(ticks = 20) { for (let i = 0; i < ticks; i++) await new Promise(r => setImmediate(r)); }
  async function settled(id, status) {
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setImmediate(r));
      if (rows.get(`a:${id}`)?.status === status) { await new Promise(r => setImmediate(r)); return; }
    }
    throw Error(`Expected ${status}, got ${rows.get(`a:${id}`)?.status}`);
  }
  return {
    device, start, settled, idle, calls, failures, rows, chunks, sync,
    setDuringLlm(fn) { duringLlm = fn; },
    switchOwner() { const previous = { stage: 'authed', profile: { userId: owner } }; owner = 'b'; version++; listener?.({ stage: 'authed', profile: { userId: owner } }, previous); },
  };
}
test('업로드 재시도는 로컬 저장 결과만 전송하고 STT/LLM을 재실행하지 않는다', async () => {
  const h = setup(); h.failures.upload = true; const call = await h.start(); await h.settled(call.call_id, 'UPLOAD_FAILED');
  assert.equal(h.calls.stt, 1); assert.equal(h.calls.llm, 1); assert.ok(h.rows.get(`a:${call.call_id}`).analysis);
  h.failures.upload = false; await h.device.retry(call.call_id); await h.settled(call.call_id, 'COMPLETED');
  assert.equal(h.calls.stt, 1); assert.equal(h.calls.llm, 1); assert.equal(h.calls.upload, 2);
});
test('LLM 실패 뒤에는 저장된 transcript부터 재개한다', async () => {
  const h = setup(); h.failures.llm = true; const call = await h.start(); await h.settled(call.call_id, 'ANALYSIS_FAILED');
  assert.ok(h.rows.get(`a:${call.call_id}`).transcript); assert.equal(h.calls.upload, 0);
  h.failures.llm = false; await h.device.retry(call.call_id); await h.settled(call.call_id, 'COMPLETED');
  assert.equal(h.calls.stt, 1); assert.equal(h.calls.llm, 2);
});
test('분석 도중 계정 전환은 이전 계정 결과 업로드와 다른 계정 조회를 차단한다', async () => {
  const h = setup(); h.setDuringLlm(async () => h.switchOwner()); const call = await h.start();
  await h.idle();
  assert.equal(h.calls.upload, 0); assert.equal(await h.device.get(call.call_id), null);
  assert.equal((await h.device.list()).length, 0); assert.ok(h.rows.get(`a:${call.call_id}`).transcript);
});
test('공백 세그먼트는 업로드 payload에 들어가지 않는다', async () => {
  const h = setup({ segments: [{ t0: 0, t1: 100, text: '   ' }, { t0: 100, t1: 300, text: '견적 주세요.' }, { t0: 50, t1: 400, text: '\n' }] });
  const call = await h.start(); await h.settled(call.call_id, 'COMPLETED');
  const sent = h.calls.payload.transcript;
  assert.equal(sent.segments.length, 1);
  assert.equal(sent.segments[0].text, '견적 주세요.');
  assert.ok(sent.segments.every(segment => segment.text.trim()));
  assert.deepEqual(h.rows.get(`a:${call.call_id}`).transcript.segments.length, 1);
});
test('세그먼트가 모두 공백이면 원문 한 덩어리로 되돌린다', async () => {
  const h = setup({ segments: [{ t0: 0, t1: 100, text: ' ' }] });
  const call = await h.start(); await h.settled(call.call_id, 'COMPLETED');
  assert.equal(h.calls.payload.transcript.segments.length, 1);
  assert.equal(h.calls.payload.transcript.segments[0].text, '견적 주세요.');
});
test('서버 400은 영구 실패로 분류하고 다시 올리지 않는다', async () => {
  const h = setup(); h.failures.uploadStatus = 400;
  const call = await h.start(); await h.settled(call.call_id, 'UPLOAD_REJECTED');
  assert.equal(h.calls.upload, 1);
  assert.match(h.rows.get(`a:${call.call_id}`).error, /다시 분석/);
  // 앱을 다시 켜도 거부된 결과를 자동으로 재전송하지 않는다.
  const restarted = setup({ rows: h.rows, chunks: h.chunks, sync: h.sync });
  await restarted.device.list(); await restarted.idle();
  assert.equal(restarted.calls.upload, 0);
  assert.equal(h.rows.get(`a:${call.call_id}`).status, 'UPLOAD_REJECTED');
  // 수동 재시도는 chunk 캐시를 비우고 분석부터 다시 한다.
  h.failures.uploadStatus = 0;
  await h.device.retry(call.call_id); await h.settled(call.call_id, 'COMPLETED');
  assert.equal(h.calls.llm, 2); assert.equal(h.calls.stt, 1);
});
test('401은 세션 문제라 업로드 재시도 대상으로 남긴다', async () => {
  const h = setup(); h.failures.uploadStatus = 401;
  const call = await h.start(); await h.settled(call.call_id, 'UPLOAD_FAILED');
});
test('연속 실패한 업로드는 백오프 전에는 다시 보내지 않는다', async () => {
  const h = setup(); h.failures.upload = true;
  const call = await h.start(); await h.settled(call.call_id, 'UPLOAD_FAILED');
  assert.equal(h.sync.get(`a:${call.call_id}`).retry_count, 1);
  const restarted = setup({ rows: h.rows, chunks: h.chunks, sync: h.sync });
  await restarted.device.list(); await restarted.idle();
  assert.equal(restarted.calls.upload, 0);
});
test('contact는 허용한 키만 저장하고 잘못된 recipient_id는 거절한다', async () => {
  const h = setup();
  const call = await h.start({ contact: { name: ' 고객 ', phone: '021234567', recipient_id: 'abc-1_A', role: 'admin', owner: 'b' } });
  assert.deepEqual(h.rows.get(`a:${call.call_id}`).contact, { name: '고객', phone: '021234567', recipient_id: 'abc-1_A' });
  await h.settled(call.call_id, 'COMPLETED');
  assert.deepEqual(Object.keys(h.calls.payload.contact).sort(), ['name', 'phone', 'recipient_id']);
  await assert.rejects(() => h.start({ contact: { name: '고객', phone: '021234567', recipient_id: 'bad id!' } }));
  await assert.rejects(() => h.start({ contact: { name: '고객', phone: '021234567', recipient_id: 'a'.repeat(129) } }));
});
test('기기 시계 여유 안쪽 통화일시는 받고 그 밖은 이유를 밝혀 거절한다', async () => {
  const h = setup();
  const soon = new Date(Date.now() + 60_000).toISOString();
  assert.ok(await h.start({ recorded_at: soon }));
  await assert.rejects(() => h.start({ recorded_at: new Date(Date.now() + 30 * 60_000).toISOString() }), /기기 시각/);
  await assert.rejects(() => h.start({ recorded_at: 'not-a-date' }));
});
test('앱이 죽었다 켜지면 ANALYZING으로 남은 작업을 이어서 끝낸다', async () => {
  const first = setup(); first.failures.llm = true;
  const call = await first.start(); await first.settled(call.call_id, 'ANALYSIS_FAILED');
  // 종료 직전 상태를 흉내 낸다: 저장된 transcript 와 ANALYZING.
  const saved = first.rows.get(`a:${call.call_id}`);
  saved.status = 'ANALYZING'; saved.error = null;
  const restarted = setup({ rows: first.rows, chunks: first.chunks, sync: first.sync });
  await restarted.device.list();
  await restarted.settled(call.call_id, 'COMPLETED');
  assert.equal(restarted.calls.stt, 0); assert.equal(restarted.calls.llm, 1); assert.equal(restarted.calls.upload, 1);
  assert.ok(restarted.calls.payload.analysis);
});
test('완료한 통화는 WAV·원본 사본과 chunk 캐시를 남기지 않는다', async () => {
  const h = setup();
  const call = await h.start(); await h.settled(call.call_id, 'COMPLETED');
  const saved = h.rows.get(`a:${call.call_id}`);
  assert.equal(saved.local_file_uri, undefined);
  assert.equal(saved.wav_uri, null);
  assert.equal([...h.chunks.keys()].length, 0);
  assert.ok(saved.analysis && saved.transcript);
});
