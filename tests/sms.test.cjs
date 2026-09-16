const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const compiled = ts.transpileModule(fs.readFileSync('src/lib/sms-runner.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${compiled}\n})`, { Error, Set })(mod.exports);
const { SmsRunner } = mod.exports;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(count = 3) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: `r${i}`, campaignId: 'c1', recipientId: `p${i}`, name: `사람${i}`, phone: `+82100000000${i}`, message: '안내', status: 'READY', attemptId: null }));
  const events = []; const journal = []; let version = 1; let sequence = 0;
  const campaign = { id: 'c1', status: 'READY' };
  const response = row => ({ campaign, recipient: { ...row }, dispatchAllowed: false });
  const api = {
    recipients: async () => rows.map(row => ({ ...row })),
    setStatus: async (_, status) => { events.push(status); campaign.status = status; return campaign; },
    claim: async (_, id, input) => { events.push(`claim:${id}`); const row = rows.find(r => r.id === id); assert.equal(row.status, 'READY'); Object.assign(row, { status: 'SENDING', attemptId: input.attemptId }); return { ...response(row), dispatchAllowed: true }; },
    recordResult: async (_, id, input) => { events.push(`save:${id}`); const row = rows.find(r => r.id === id); Object.assign(row, input); return response(row); },
    retry: async (_, id) => { events.push(`retry:${id}`); const row = rows.find(r => r.id === id); assert.equal(row.status, 'FAILED'); row.status = 'READY'; return response(row); },
  };
  const device = {
    getCapabilities: async () => ({ supported: true, permissionGranted: true, subscriptions: [{ id: 7, label: 'SIM 1' }], defaultSubscriptionId: 7 }),
    send: async input => { events.push(`send:${input.campaignRecipientId}`); const result = { ...input, status: 'SENT', success: true, errorCode: null, errorMessage: null }; journal.push(result); return result; },
    getResults: async () => [...journal],
    acknowledge: async id => { events.push(`ack:${id}`); const index = journal.findIndex(r => r.attemptId === id); if (index >= 0) journal.splice(index, 1); },
  };
  const runner = new SmsRunner(api, device, () => version, () => `attempt-${++sequence}`);
  return { rows, events, journal, api, device, runner, changeSession: () => { version++; } };
}
const run = h => h.runner.run('c1', { subscriptionId: 7 });
test('30~50건은 한 건 SENT와 서버 저장 뒤 다음 대상을 호출한다', async () => {
  const h = setup(50); await run(h);
  assert.equal(h.events.filter(x => x.startsWith('send:')).length, 50);
  for (let i = 0; i < 49; i++) assert.ok(h.events.indexOf(`save:r${i}`) < h.events.indexOf(`send:r${i + 1}`));
  assert.ok(h.rows.every(r => r.status === 'SENT'));
  await run(h); assert.equal(h.events.filter(x => x.startsWith('send:')).length, 50);
});
test('서버 결과 저장 실패는 다음 발송을 멈추며 sync는 결과만 복원한다', async () => {
  const h = setup(); const original = h.api.recordResult;
  h.api.recordResult = async () => { throw new Error('offline'); };
  await assert.rejects(run(h), /offline/);
  assert.deepEqual(h.events.filter(x => x.startsWith('send:')), ['send:r0']);
  assert.equal(h.journal.length, 1); assert.equal(h.rows[0].status, 'SENDING');
  h.api.recordResult = original; await h.runner.sync('c1');
  assert.equal(h.rows[0].status, 'SENT'); assert.equal(h.journal.length, 0);
  assert.equal(h.events.filter(x => x.startsWith('send:')).length, 1);
  await run(h); assert.equal(h.events.filter(x => x.startsWith('send:')).length, 3);
});
test('claim 응답 유실은 Native 호출도 새 attempt도 만들지 않는다', async () => {
  const h = setup(); const claim = h.api.claim;
  h.api.claim = async (...args) => { await claim(...args); throw new Error('lost claim'); };
  await assert.rejects(run(h), /lost claim/);
  h.api.claim = claim; await assert.rejects(run(h), /결과가 확인되지/);
  assert.equal(h.events.filter(x => x.startsWith('send:')).length, 0);
  assert.equal(h.events.filter(x => x.startsWith('claim:')).length, 1);
});
test('중복 버튼은 하나만 진행하고 중지는 진행 1건 결과 저장 뒤 멈춘다', async () => {
  const h = setup(); const wait = deferred(); const entered = deferred(); const send = h.device.send;
  h.device.send = async input => { entered.resolve(); await wait.promise; return send(input); };
  const sending = run(h); await entered.promise;
  await assert.rejects(run(h), /이미 발송/); h.runner.stop(); wait.resolve(); await sending;
  assert.deepEqual(h.events.filter(x => x.startsWith('send:')), ['send:r0']);
  assert.ok(h.events.indexOf('save:r0') < h.events.indexOf('CANCELLED'));
});
test('SENT와 UNKNOWN은 재시도하지 않고 FAILED 선택만 다시 보낸다', async () => {
  const h = setup(4); Object.assign(h.rows[0], { status: 'SENT' }); Object.assign(h.rows[1], { status: 'FAILED' });
  Object.assign(h.rows[2], { status: 'FAILED', errorCode: 'OUTCOME_UNKNOWN' });
  await h.runner.run('c1', { subscriptionId: 7, retryRecipientIds: ['r1'] });
  assert.deepEqual(h.events.filter(x => x.startsWith('send:')), ['send:r1']);
  assert.equal(h.rows[3].status, 'READY');
  await assert.rejects(h.runner.run('c1', { subscriptionId: 7, retryRecipientIds: ['r2'] }), /확실하게 실패/);
});
test('확보 응답 dispatchAllowed=false는 발송하지 않는다', async () => {
  const h = setup(); const claim = h.api.claim;
  h.api.claim = async (...args) => ({ ...await claim(...args), dispatchAllowed: false });
  await assert.rejects(run(h), /발송 허가/); assert.equal(h.journal.length, 0);
});
test('권한 또는 SIM 부재는 서버 claim 전에 막는다', async () => {
  const h = setup(); h.device.getCapabilities = async () => ({ supported: false, permissionGranted: false, subscriptions: [] });
  await assert.rejects(run(h), /권한과 SIM/); assert.equal(h.events.length, 0);
});
test('전송 중 계정 변경은 결과 업로드와 다음 전송을 멈추고 journal을 보존한다', async () => {
  const h = setup(); const send = h.device.send;
  h.device.send = async input => { const result = await send(input); h.changeSession(); return result; };
  await assert.rejects(run(h), /계정이 바뀌어/); assert.equal(h.journal.length, 1);
  assert.equal(h.events.filter(x => x.startsWith('save:')).length, 0);
});
test('부분 발송/타임아웃은 확인필요로 저장하고 나머지는 자동으로 보내지 않는다', async () => {
  const h = setup(); const send = h.device.send;
  h.device.send = async input => ({ ...await send(input), status: 'UNKNOWN', success: false, errorCode: 'PARTIAL_SENT' });
  await assert.rejects(run(h), /불확실/); assert.equal(h.rows[0].errorCode, 'OUTCOME_UNKNOWN');
  assert.equal(h.rows[1].status, 'READY');
});
test('앱 복구 조회 sync는 다른 캠페인 journal을 삭제하지 않고 자동 발송하지 않는다', async () => {
  const h = setup(); h.journal.push({ campaignRecipientId: 'another', attemptId: 'old', status: 'SENT' });
  await h.runner.sync('c1'); assert.equal(h.journal.length, 1); assert.equal(h.events.length, 0);
});
test('확인필요 결과 이후 늦은 SENT는 동일 attempt로 보정한다', async () => {
  const h = setup(1); Object.assign(h.rows[0], { status: 'FAILED', errorCode: 'OUTCOME_UNKNOWN', attemptId: 'old' });
  h.journal.push({ campaignRecipientId: 'r0', attemptId: 'old', phone: h.rows[0].phone, status: 'SENT', success: true });
  await h.runner.sync('c1'); assert.equal(h.rows[0].status, 'SENT'); assert.equal(h.journal.length, 0);
});

test('첨부는 claim 전에 준비하고 같은 파일은 한 번만 내려받아 MMS로 전달한다', async () => {
  const h = setup(2); const image = { id: 'a1', name: '명함.png', mimeType: 'image/png', size: 3 };
  h.rows.forEach(row => { row.attachments = [image]; });
  const capabilities = h.device.getCapabilities;
  h.device.getCapabilities = async () => ({ ...await capabilities(), mmsSupported: true });
  h.api.attachmentContent = async () => { h.events.push('download'); return { ...image, dataBase64: 'YWJj' }; };
  const send = h.device.send;
  h.device.send = async input => { assert.equal(input.attachments[0].dataBase64, 'YWJj'); return send(input); };
  await run(h);
  assert.equal(h.events.filter(e => e === 'download').length, 1);
  assert.ok(h.events.indexOf('download') < h.events.indexOf('claim:r0'));
});
test('구버전 앱과 첨부 다운로드 실패는 claim 전에 막아 텍스트만 발송하지 않는다', async () => {
  const h = setup(1); h.rows[0].attachments = [{ id: 'a1', name: '명함.png', mimeType: 'image/png', size: 3 }];
  await assert.rejects(run(h), /최신 Android/);
  assert.equal(h.events.filter(e => e.startsWith('claim:')).length, 0);
  const capabilities = h.device.getCapabilities;
  h.device.getCapabilities = async () => ({ ...await capabilities(), mmsSupported: true });
  h.api.attachmentContent = async () => { throw new Error('download offline'); };
  await assert.rejects(run(h), /download offline/);
  assert.equal(h.events.filter(e => e.startsWith('claim:')).length, 0);
});
test('서버 결과 응답이 요청과 다르면 단말 결과를 지우거나 다음 사람에게 보내지 않는다', async () => {
  const h = setup(); const record = h.api.recordResult;
  h.api.recordResult = async (...args) => { const result = await record(...args); return { ...result, recipient: { ...result.recipient, status: 'SENDING' } }; };
  await assert.rejects(run(h), /저장 결과/);
  assert.equal(h.journal.length, 1);
  assert.deepEqual(h.events.filter(e => e.startsWith('send:')), ['send:r0']);
});

const phoneModule = { exports: {} };
const phoneCompiled = ts.transpileModule(fs.readFileSync('src/lib/phone.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${phoneCompiled}\n})`, { Error })(phoneModule.exports);
const { normalizePhone, canonicalStoredPhone, formatPhone } = phoneModule.exports;
test('010 뒤 8자리만 허용하고 하이픈 입력을 숫자로 저장한다', () => {
  for (const value of ['01012345678', '010-1234-5678', ' 010 1234 5678 ']) assert.equal(normalizePhone(value), '01012345678');
  for (const value of ['', '01112345678', '0101234567', '010123456789', '+821012345678', '0101234abcd']) assert.throws(() => normalizePhone(value), /010/);
});
test('저장된 번호와 기존 국가번호는 하이픈으로 표시하고 잘못된 엑셀 번호도 표시 가능하다', () => {
  assert.equal(canonicalStoredPhone('+821012345678'), '01012345678');
  for (const value of ['01012345678', '+821012345678', '010-1234-5678']) assert.equal(formatPhone(value), '010-1234-5678');
  assert.equal(formatPhone('번호오류'), '번호오류');
});

const dateModule = { exports: {} };
const dateCompiled = ts.transpileModule(fs.readFileSync('src/lib/external-send-date.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${dateCompiled}\n})`, { Error, Date })(dateModule.exports);
const { externalSendLocalTime, parseExternalSendTime } = dateModule.exports;
test('외부 발송일시는 현지시각을 UTC로 변환하며 미래·존재하지 않는 날짜를 거절한다', () => {
  const now = new Date(2026, 8, 16, 15, 0);
  assert.equal(parseExternalSendTime('2026-09-16 14:30', now), new Date(2026, 8, 16, 14, 30).toISOString());
  assert.equal(externalSendLocalTime(new Date(2026, 0, 2, 3, 4)), '2026-01-02 03:04');
  assert.throws(() => parseExternalSendTime('2026-09-16 15:01', now), /미래/);
  for (const value of ['2026-02-30 12:00', '2026-13-01 00:00', '2026-09-16 24:00', '2026-9-16 12:00']) assert.throws(() => parseExternalSendTime(value, now));
});
