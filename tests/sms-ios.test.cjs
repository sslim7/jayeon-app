/*
  iPhone 문자 발송.

  🔴 **iOS 는 앱이 문자를 직접 보낼 수 없다.** 시스템 메시지 화면을 띄우고 사용자가
  「보내기」를 눌러야 나간다. 그래서 확인할 것이 안드로이드와 다르다 — 시스템이 준 세 가지
  결말이 우리 결과로 어떻게 옮겨지는지, 「통과」와 「시트 취소」가 서버에 갈라져 남는지,
  「중단」 뒤에 여기까지의 결과가 남아 있는지, 그리고 회선(SIM) 선택이 없는 것이 안드로이드
  보호 장치를 풀어 버리지는 않는지.

  🔴 **갇히지 않는지도 여기서 본다.** 실기기에서 두 번 갇혔다. 한 번은 시트가 결과 없이
  사라져 발송 루프가 `device.send` 앞에 선 채로 멈췄고, 한 번은 확인창을 띄운 화면을 떠나
  답이 영영 오지 않았다. 둘 다 앱당 하나뿐인 러너를 `running: true` 로 잠가 **모든 캠페인**을
  막았고, 앱을 껐다 켜는 것 말고는 나올 길이 없었다.

  실제 시트는 열 수 없으므로 판단만 순수 함수로 빼서 확인한다.
*/
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

function load(file, sandbox = { Error, Set }) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(exports){${compiled}\n})`, sandbox)(mod.exports);
  return mod.exports;
}

const runnerModule = load('src/lib/sms-runner.ts');
const iosResult = load('modules/nature-sms/ios-result.ts');
const capabilityModule = load('src/lib/sms-capability.ts');
const outcomeModule = load('src/lib/sms-outcome.ts');
const {
  SmsRunner, USER_SKIPPED, USER_CANCELLED, IOS_COMPOSER_ABANDONED, CANCELLED_BEFORE_SEND,
  knownNotSent, skippedResult, blockedByOther,
} = runnerModule;
const { mapComposeOutcome } = iosResult;
const { lineSelectable, composerConfirm, dispatchReady, dispatchSubscriptionId } = capabilityModule;
const {
  recipientOutcome, countOutcomes, unsentTargets, retryTargets, hasClosedUnsent, NOT_SENT_CODES,
} = outcomeModule;

// vm 밖에서 만든 객체와 비교하려면 realm 을 한 번 벗겨야 한다(프로토타입이 달라 deepEqual 이 막힌다).
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const idle = { campaignId: null, running: false, stopping: false, currentRecipientId: null, error: null };

const target = { campaignRecipientId: 'r1', attemptId: 'a1', phone: '01012345678' };

test('시스템이 준 결말 셋은 보냄·취소·실패로 갈리고 transport 는 지어내지 않는다', () => {
  const sent = mapComposeOutcome(target, 'sent');
  assert.deepEqual({ ...sent }, { ...target, success: true, status: 'SENT', errorCode: null, errorMessage: null });
  // 🔴 iOS 는 SMS 로 나갔는지 iMessage 였는지 알려 주지 않는다. 모르는 값을 채우지 않는다.
  assert.equal('transport' in sent, false);

  const cancelled = mapComposeOutcome(target, 'cancelled');
  assert.equal(cancelled.success, false);
  assert.equal(cancelled.status, 'UNKNOWN');
  assert.equal(cancelled.errorCode, USER_CANCELLED);

  const failed = mapComposeOutcome(target, 'failed');
  assert.equal(failed.success, false);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.errorCode, 'IOS_SEND_FAILED');
});
test('모르는 결말은 실패로 단정하지 않고 확인 필요로 남긴다', () => {
  for (const outcome of ['unknown', '', 'SENT', 'whatever']) {
    const result = mapComposeOutcome(target, outcome);
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.errorCode, 'IOS_OUTCOME_UNKNOWN');
    assert.equal(result.success, false);
  }
});
test('취소 코드는 네이티브 모듈과 발송 루프가 같은 글자를 써야 한다', () => {
  // 한쪽만 바뀌면 취소가 조용히 「결과 확인 필요」로 덮인다. 두 파일을 여기서 묶어 둔다.
  assert.equal(iosResult.USER_CANCELLED, USER_CANCELLED);
  assert.equal(knownNotSent({ errorCode: USER_CANCELLED }), true);
  assert.equal(knownNotSent({ errorCode: USER_SKIPPED }), true);
  assert.equal(knownNotSent({ errorCode: 'PARTIAL_SENT' }), false);
  assert.equal(knownNotSent({ errorCode: null }), false);
  assert.equal(skippedResult({ campaignRecipientId: 'r1', phone: '010' }, 'a1').errorCode, USER_SKIPPED);
});

// iPhone 단말을 흉내 낸다. 회선 목록이 비어 있고, 결과 수신함이 없으며, send 가 결과를 직접 준다.
function setup(count = 3, { outcomes = [], capabilities = {} } = {}) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `r${i}`, campaignId: 'c1', recipientId: `p${i}`, name: `사람${i}`,
    phone: `0101111000${i}`, message: '@name님 안내드립니다', status: 'READY', attemptId: null,
  }));
  const events = []; let version = 1; let sequence = 0;
  const campaign = { id: 'c1', status: 'READY' };
  const response = row => ({ campaign, recipient: { ...row }, dispatchAllowed: false });
  const api = {
    recipients: async () => rows.map(row => ({ ...row })),
    setStatus: async (_, status) => { events.push(status); campaign.status = status; return campaign; },
    claim: async (_, id, input) => {
      events.push(`claim:${id}`);
      const row = rows.find(r => r.id === id);
      Object.assign(row, { status: 'SENDING', attemptId: input.attemptId });
      return { ...response(row), dispatchAllowed: true };
    },
    recordResult: async (_, id, input) => {
      events.push(`save:${id}:${input.status}:${input.errorCode ?? ''}`);
      const row = rows.find(r => r.id === id);
      Object.assign(row, input);
      return response(row);
    },
    retry: async (_, id) => { const row = rows.find(r => r.id === id); row.status = 'READY'; return response(row); },
  };
  const device = {
    getCapabilities: async () => ({
      supported: true, permissionGranted: true, mmsSupported: true, lmsSupported: false,
      subscriptions: [], defaultSubscriptionId: null, lineSelectable: false, composerConfirm: true,
      ...capabilities,
    }),
    send: async input => {
      events.push(`send:${input.campaignRecipientId}:${input.message}`);
      return mapComposeOutcome(input, outcomes.shift() ?? 'sent');
    },
    // iOS 는 백그라운드 결과 수신함이 없다. 늘 비어 있고 acknowledge 는 지울 것이 없다.
    getResults: async () => [],
    acknowledge: async () => { events.push('ack'); },
  };
  const runner = new SmsRunner(api, device, () => version, () => `attempt-${++sequence}`);
  return { rows, events, campaign, api, device, runner };
}
const sends = h => h.events.filter(e => e.startsWith('send:')).map(e => e.split(':')[1]);
const saves = h => h.events.filter(e => e.startsWith('save:'));

test('한 건마다 물어보고 사람 이름·순번·치환된 본문을 그대로 보여 준다', async () => {
  const h = setup(3);
  const asked = [];
  await h.runner.run('c1', { subscriptionId: 0, confirm: async prompt => { asked.push(prompt); return 'send'; } });
  assert.deepEqual(asked.map(p => [p.index, p.total, p.name]), [[1, 3, '사람0'], [2, 3, '사람1'], [3, 3, '사람2']]);
  // 사용자가 읽는 본문은 치환이 끝난 것이어야 한다 — 시트에 들어갈 글자와 같아야 하니까.
  assert.equal(asked[0].message, '사람0님 안내드립니다');
  assert.deepEqual(sends(h), ['r0', 'r1', 'r2']);
  assert.ok(h.rows.every(r => r.status === 'SENT'));
});
test('confirm 이 없으면 묻지 않고 예전 그대로 이어서 보낸다', async () => {
  // 안드로이드 발송 흐름. 3버튼은 iPhone 에만 필요하고 여기에는 끼어들지 않는다.
  const h = setup(2, { capabilities: { subscriptions: [{ id: 7, label: 'SIM 1' }], lineSelectable: undefined, composerConfirm: undefined } });
  await h.runner.run('c1', { subscriptionId: 7 });
  assert.deepEqual(sends(h), ['r0', 'r1']);
});

test('「통과」는 단말을 부르지 않고 「시트 취소」와 다른 사유로 서버에 남는다', async () => {
  const h = setup(3, { outcomes: ['sent', 'cancelled'] });
  // r0 보냄 → r1 통과 → r2 는 발송을 눌렀지만 시트에서 취소.
  const choices = ['send', 'skip', 'send'];
  await h.runner.run('c1', { subscriptionId: 0, confirm: async () => choices.shift() });
  // 통과한 사람에게는 메시지 화면 자체가 열리지 않는다.
  assert.deepEqual(sends(h), ['r0', 'r2']);
  assert.deepEqual(saves(h), ['save:r0:SENT:', `save:r1:FAILED:${USER_SKIPPED}`, `save:r2:FAILED:${USER_CANCELLED}`]);
  // 🔴 나중에 「왜 안 갔지」를 볼 때 둘은 다른 이야기다. 사유가 섞이면 구별할 길이 없다.
  assert.equal(h.rows[1].errorCode, USER_SKIPPED);
  assert.equal(h.rows[2].errorCode, USER_CANCELLED);
  assert.notEqual(h.rows[1].errorCode, h.rows[2].errorCode);
});
test('시트 취소는 결과 확인 필요로 덮이지 않고 다음 사람으로 이어진다', async () => {
  const h = setup(3, { outcomes: ['cancelled', 'sent', 'sent'] });
  await h.runner.run('c1', { subscriptionId: 0, confirm: async () => 'send' });
  // 실수로 한 건 닫은 것이 25명짜리 일괄 발송 전체를 세우면 안 된다.
  assert.deepEqual(sends(h), ['r0', 'r1', 'r2']);
  assert.equal(h.rows[0].status, 'FAILED');
  assert.notEqual(h.rows[0].errorCode, 'OUTCOME_UNKNOWN');
  assert.equal(h.rows[0].errorCode, USER_CANCELLED);
  // 확실히 안 나간 건이므로 「실패 다시 보내기」로 되돌릴 수 있다.
  assert.equal(runnerModule.needsOutcomeReview(h.rows[0]), false);
});
test('iOS 발송 실패는 여전히 실패 사유 그대로 남는다', async () => {
  const h = setup(2, { outcomes: ['failed', 'sent'] });
  await h.runner.run('c1', { subscriptionId: 0, confirm: async () => 'send' });
  assert.equal(h.rows[0].errorCode, 'IOS_SEND_FAILED');
  assert.equal(h.rows[1].status, 'SENT');
});
test('결과를 모르는 결말은 예전처럼 확인 필요로 저장하고 멈춘다', async () => {
  const h = setup(3, { outcomes: ['unknown'] });
  await assert.rejects(h.runner.run('c1', { subscriptionId: 0, confirm: async () => 'send' }), /불확실/);
  assert.equal(h.rows[0].errorCode, 'OUTCOME_UNKNOWN');
  assert.equal(h.rows[1].status, 'READY');
});

test('「중단」은 그 사람을 보내지 않고 닫고 여기까지의 결과를 남긴 채 멈춘다', async () => {
  const h = setup(4);
  const choices = ['send', 'stop'];
  await h.runner.run('c1', { subscriptionId: 0, confirm: async () => choices.shift() ?? 'send' });
  assert.deepEqual(sends(h), ['r0']);
  // 앞사람 결과는 저장돼 있고, 멈춘 자리의 사람은 claim 된 채로 남지 않는다.
  assert.equal(h.rows[0].status, 'SENT');
  assert.equal(h.rows[1].status, 'FAILED');
  assert.equal(h.rows[1].errorCode, 'CANCELLED_BEFORE_SEND');
  // 뒤에 남은 사람들은 손대지 않는다 — 다시 「미발송 계속 보내기」로 이어갈 수 있다.
  assert.deepEqual(h.rows.slice(2).map(r => r.status), ['READY', 'READY']);
  assert.equal(h.campaign.status, 'CANCELLED');
  // vm 밖에서 만든 객체와 비교하려면 realm 을 한 번 벗겨야 한다(프로토타입이 달라 deepEqual 이 막힌다).
  assert.deepEqual(JSON.parse(JSON.stringify(h.runner.getSnapshot())), { campaignId: 'c1', running: false, stopping: false, currentRecipientId: null, error: null });
});
test('중단한 캠페인은 남은 사람만 이어서 보낸다', async () => {
  const h = setup(3);
  const choices = ['stop'];
  await h.runner.run('c1', { subscriptionId: 0, confirm: async () => choices.shift() ?? 'send' });
  assert.deepEqual(sends(h), []);
  await h.runner.run('c1', { subscriptionId: 0, confirm: async () => 'send' });
  assert.deepEqual(sends(h), ['r1', 'r2']);
});

test('회선 목록이 비는 것은 iPhone 뿐이고 안드로이드의 SIM 확인은 그대로다', async () => {
  // 🔴 iPhone 에는 회선을 고르는 API 가 없다 — 고를 것이 없으니 묻지도 막지도 않는다.
  const iphone = setup(1);
  assert.deepEqual((await iphone.device.getCapabilities()).subscriptions, []);
  await iphone.runner.run('c1', { subscriptionId: 0, confirm: async () => 'send' });
  assert.deepEqual(sends(iphone), ['r0']);

  // lineSelectable 을 주지 않는 단말(예전 Android 빌드)에서 SIM 이 없으면 예전처럼 막는다.
  const android = setup(1, { capabilities: { lineSelectable: undefined, composerConfirm: undefined } });
  await assert.rejects(android.runner.run('c1', { subscriptionId: 0 }), /SIM 회선/);
  assert.deepEqual(android.events, []);
});
test('첨부를 못 붙이는 iPhone 에는 앱을 업데이트하라고 하지 않는다', async () => {
  const h = setup(1, { capabilities: { mmsSupported: false } });
  h.rows[0].attachments = [{ id: 'a1', name: '명함.png', mimeType: 'image/png', size: 3 }];
  await assert.rejects(h.runner.run('c1', { subscriptionId: 0, confirm: async () => 'send' }), /iPhone/);
});

test('화면은 단말이 알려 준 값으로 회선 UI 와 한 건 확인창을 가른다', () => {
  const iphone = { supported: true, permissionGranted: true, subscriptions: [], defaultSubscriptionId: null, lineSelectable: false, composerConfirm: true };
  const android = { supported: true, permissionGranted: true, subscriptions: [{ id: 7, label: 'SIM 1' }], defaultSubscriptionId: 7 };
  assert.equal(lineSelectable(iphone), false);
  assert.equal(composerConfirm(iphone), true);
  // 예전 Android 빌드는 두 값을 주지 않는다. 그때는 회선 선택이 있는 것으로 봐야 안전하다.
  assert.equal(lineSelectable(android), true);
  assert.equal(composerConfirm(android), false);
  // 아직 확인 중(null)에도 회선 선택이 있는 쪽으로 본다 — 없는 화면을 미리 감추지 않는다.
  assert.equal(lineSelectable(null), true);
  assert.equal(composerConfirm(null), false);
});
test('발송 버튼은 iPhone 에서 SIM 을 고르지 않았다고 막히지 않는다', () => {
  const iphone = { supported: true, permissionGranted: true, subscriptions: [], defaultSubscriptionId: null, lineSelectable: false, composerConfirm: true };
  const android = { supported: true, permissionGranted: true, subscriptions: [{ id: 7, label: 'SIM 1' }], defaultSubscriptionId: 7 };
  assert.equal(dispatchReady(iphone, null, true), true);
  assert.equal(dispatchReady(android, null, true), false);
  assert.equal(dispatchReady(android, 7, true), true);
  // 첨부를 못 보내는 단말, 권한 없는 단말, 브라우저는 어느 쪽이든 막는다.
  assert.equal(dispatchReady(iphone, null, false), false);
  assert.equal(dispatchReady({ ...iphone, permissionGranted: false }, null, true), false);
  assert.equal(dispatchReady({ ...android, supported: false }, 7, true), false);
  assert.equal(dispatchReady(null, 7, true), false);
  // 고를 회선이 없으면 고른 척하지 않는다.
  assert.equal(dispatchSubscriptionId(iphone, 7), 0);
  assert.equal(dispatchSubscriptionId(android, 7), 7);
  assert.equal(dispatchSubscriptionId(android, null), 0);
});

/*
  갇히지 않기 ①: 다른 캠페인이 잡고 있을 때.

  러너는 앱당 하나뿐이라 한 캠페인이 잡으면 나머지 전부가 막힌다. 예전 화면은 「다른 문자를
  발송 중입니다」 한 줄만 보여 주고 그 발송을 멈출 길도, 찾아갈 길도 주지 않았다.
*/
test('다른 문자가 잡고 있으면 빠져나갈 길을 함께 준다', () => {
  assert.equal(blockedByOther(idle, 'c1'), null);
  // 내 캠페인이 돌고 있는 것은 막힘이 아니다 — 그 화면에는 예전부터 중단 버튼이 있었다.
  assert.equal(blockedByOther({ ...idle, running: true, campaignId: 'c1' }, 'c1'), null);
  assert.deepEqual(plain(blockedByOther({ ...idle, running: true, campaignId: 'c2' }, 'c1')),
    { campaignId: 'c2', canOpen: true, canStop: true });
  // 🔴 어느 캠페인인지 몰라도 멈출 길은 있어야 한다. 막아 놓고 길을 안 주는 것이 결함이었다.
  assert.deepEqual(plain(blockedByOther({ ...idle, running: true, campaignId: null }, 'c1')),
    { campaignId: null, canOpen: false, canStop: true });
});
test('중단은 답이 오지 않는 확인창을 끊고 running 을 실제로 푼다', async () => {
  const h = setup(3);
  const asked = deferred();
  // 확인창을 띄운 화면을 떠난 뒤라 답이 영영 오지 않는 상황. 예전에는 여기서 앱이 잠겼다.
  const sending = h.runner.run('c1', {
    subscriptionId: 0,
    confirm: async () => { asked.resolve(); return new Promise(() => {}); },
  });
  await asked.promise;
  assert.equal(h.runner.getSnapshot().running, true);
  // 다른 화면에서 누른 중단. 러너는 싱글턴이라 같은 흐름을 멈춘다.
  h.runner.stop();
  await sending;
  assert.equal(h.runner.getSnapshot().running, false);
  assert.equal(h.runner.getSnapshot().stopping, false);
  // 답을 못 받은 사람에게 문자가 나가지는 않았고, claim 한 채로 남지도 않는다.
  assert.deepEqual(sends(h), []);
  assert.equal(h.rows[0].errorCode, CANCELLED_BEFORE_SEND);
  assert.equal(h.campaign.status, 'CANCELLED');
  // 그리고 막혔던 발송을 다시 시작할 수 있다 — 앱을 껐다 켜지 않아도 된다.
  await h.runner.run('c1', { subscriptionId: 0, confirm: async () => 'send' });
  assert.deepEqual(sends(h), ['r1', 'r2']);
});

/*
  갇히지 않기 ②: 시트가 결과 없이 사라졌을 때.

  `didFinishWith` 델리게이트가 안 오면 네이티브의 Promise 가 영원히 매달리고 발송 루프는
  `await device.send(...)` 앞에 선 채로 멈춘다. 네이티브가 그 약속을 거둬들이면
  (→ `modules/nature-sms/ios/NatureSmsModule.swift`) 여기로 `abandoned` 가 온다.
*/
test('정리된 시트는 「모른다」가 아니라 「안 나갔다」로 남는다', () => {
  const abandoned = mapComposeOutcome(target, 'abandoned');
  assert.equal(abandoned.success, false);
  assert.equal(abandoned.errorCode, IOS_COMPOSER_ABANDONED);
  // 🔴 사람이 닫은 것도, 메시지 앱이 실패한 것도, 결과를 모르는 것도 아니다. 넷이 갈려야 한다.
  assert.notEqual(abandoned.errorCode, USER_CANCELLED);
  assert.notEqual(abandoned.errorCode, 'IOS_SEND_FAILED');
  assert.notEqual(abandoned.errorCode, 'IOS_OUTCOME_UNKNOWN');
  // 네이티브 표와 발송 루프가 같은 글자를 써야 한다 — 한쪽만 바뀌면 확인 필요로 덮인다.
  assert.equal(iosResult.IOS_COMPOSER_ABANDONED, IOS_COMPOSER_ABANDONED);
  assert.equal(knownNotSent(abandoned), true);
  // 확인 필요가 아니므로 사람 손을 거치지 않고 다시 보낼 수 있다.
  assert.equal(runnerModule.needsOutcomeReview({ status: 'FAILED', errorCode: IOS_COMPOSER_ABANDONED }), false);
});
test('매달린 약속이 정리되면 다음 사람으로 이어지고 다음 발송도 열린다', async () => {
  const h = setup(3, { outcomes: ['abandoned', 'sent', 'sent'] });
  await h.runner.run('c1', { subscriptionId: 0, confirm: async () => 'send' });
  // 한 건이 사라졌다고 25명짜리 발송 전체가 서지 않는다.
  assert.deepEqual(sends(h), ['r0', 'r1', 'r2']);
  assert.equal(h.rows[0].status, 'FAILED');
  assert.equal(h.rows[0].errorCode, IOS_COMPOSER_ABANDONED);
  assert.notEqual(h.rows[0].errorCode, 'OUTCOME_UNKNOWN');
  assert.equal(h.runner.getSnapshot().running, false);
  // 정리된 사람은 미발송으로 남아 그대로 다시 보낼 수 있다.
  assert.equal(recipientOutcome(h.rows[0]), 'UNSENT');
  await h.runner.run('c1', { subscriptionId: 0, retryRecipientIds: [h.rows[0].id], confirm: async () => 'send' });
  assert.deepEqual(sends(h), ['r0', 'r1', 'r2', 'r0']);
  assert.equal(h.rows[0].status, 'SENT');
});

/*
  실패와 미발송 가르기.

  🔴 서버 status 는 `SENT|FAILED` 둘뿐이라 통과·중단·시트 취소까지 전부 FAILED 로 들어온다.
  실기기에서 두 명짜리 캠페인을 처음부터 중단했더니 「성공 0 · 실패 1 · 대기 1」에 「미발송
  계속 보내기」와 「실패 다시 보내기」가 나란히 서서, 어느 쪽을 눌러야 하는지 알 수 없었다.
*/
test('중단·통과·시트 취소·정리는 실패가 아니라 미발송이다', () => {
  assert.equal(recipientOutcome({ status: 'SENT', errorCode: null }), 'SENT');
  assert.equal(recipientOutcome({ status: 'READY', errorCode: null }), 'PENDING');
  for (const code of [USER_SKIPPED, USER_CANCELLED, CANCELLED_BEFORE_SEND, IOS_COMPOSER_ABANDONED]) {
    assert.equal(recipientOutcome({ status: 'FAILED', errorCode: code }), 'UNSENT', code);
    // 두 파일이 같은 글자를 써야 한다. 한쪽만 바뀌면 그 사유가 조용히 「실패」로 돌아간다.
    assert.ok(NOT_SENT_CODES.includes(code), code);
  }
  // 통신사·기기가 거절한 것은 그대로 실패다 — 이것만 「다시 보내기」가 가리킨다.
  for (const code of ['IOS_SEND_FAILED', 'SMS_FAILED', 'GENERIC_FAILURE', null]) {
    assert.equal(recipientOutcome({ status: 'FAILED', errorCode: code }), 'FAILED', String(code));
  }
  // 나갔는지 모르는 것은 어느 쪽도 아니다. 미발송으로 세면 이미 나간 문자를 다시 보내게 된다.
  assert.equal(recipientOutcome({ status: 'UNKNOWN', errorCode: null }), 'REVIEW');
  assert.equal(recipientOutcome({ status: 'SENDING', errorCode: null }), 'REVIEW');
  assert.equal(recipientOutcome({ status: 'FAILED', errorCode: 'OUTCOME_UNKNOWN' }), 'REVIEW');
  assert.equal(recipientOutcome({ status: 'FAILED', errorCode: 'PARTIAL_SENT' }), 'REVIEW');
});
test('두 버튼은 같은 사람을 가리키지 않는다', () => {
  const rows = [
    { id: 'r0', status: 'FAILED', errorCode: CANCELLED_BEFORE_SEND },
    { id: 'r1', status: 'READY', errorCode: null },
    { id: 'r2', status: 'FAILED', errorCode: 'IOS_SEND_FAILED' },
    { id: 'r3', status: 'SENT', errorCode: null },
    { id: 'r4', status: 'FAILED', errorCode: 'OUTCOME_UNKNOWN' },
  ];
  assert.deepEqual(plain(countOutcomes(rows)), { sent: 1, failed: 1, unsent: 2, review: 1 });
  // 미발송은 대기와 내가 닫은 사람을 한 묶음으로 — 버튼 하나가 이 목록을 그대로 보낸다.
  assert.deepEqual(plain(unsentTargets(rows)), ['r0', 'r1']);
  assert.deepEqual(plain(retryTargets(rows)), ['r2']);
  const overlap = unsentTargets(rows).filter(id => retryTargets(rows).includes(id));
  assert.deepEqual(plain(overlap), []);
  // 한 사람은 정확히 한 칸에만 든다. 어느 칸에도 없는 사람도 없다.
  const counts = countOutcomes(rows);
  assert.equal(counts.sent + counts.failed + counts.unsent + counts.review, rows.length);
  assert.equal(hasClosedUnsent(rows), true);
  assert.equal(hasClosedUnsent([{ id: 'r1', status: 'READY', errorCode: null }]), false);
});
test('안드로이드 사유는 예전과 같게 실패로 센다', () => {
  // 🔴 안드로이드에는 통과도 한 건 확인창도 없다. 분류가 생겼다고 세는 값이 달라지면 안 된다.
  const rows = [
    { id: 'r0', status: 'SENT', errorCode: null },
    { id: 'r1', status: 'FAILED', errorCode: 'SMS_FAILED' },
    { id: 'r2', status: 'FAILED', errorCode: 'GENERIC_FAILURE' },
    { id: 'r3', status: 'FAILED', errorCode: 'NO_SERVICE' },
    { id: 'r4', status: 'READY', errorCode: null },
  ];
  assert.deepEqual(plain(countOutcomes(rows)), { sent: 1, failed: 3, unsent: 1, review: 0 });
  assert.deepEqual(plain(retryTargets(rows)), ['r1', 'r2', 'r3']);
  assert.deepEqual(plain(unsentTargets(rows)), ['r4']);
  assert.equal(hasClosedUnsent(rows), false);
});
test('「미발송 보내기」는 대기와 내가 닫은 사람을 한 번에 보낸다', async () => {
  const h = setup(3);
  // 첫 사람에서 중단 → r0 은 닫히고(FAILED) r1·r2 는 대기로 남는다.
  const choices = ['stop'];
  await h.runner.run('c1', { subscriptionId: 0, confirm: async () => choices.shift() ?? 'send' });
  assert.equal(recipientOutcome(h.rows[0]), 'UNSENT');
  const resume = unsentTargets(h.rows);
  assert.deepEqual(plain(resume), ['r0', 'r1', 'r2']);
  // 다시 보낼 「실패」는 하나도 없다. 버튼도 하나만 선다.
  assert.deepEqual(plain(retryTargets(h.rows)), []);
  await h.runner.run('c1', { subscriptionId: 0, retryRecipientIds: resume, confirm: async () => 'send' });
  assert.deepEqual(sends(h), ['r0', 'r1', 'r2']);
  assert.ok(h.rows.every(r => r.status === 'SENT'));
});
