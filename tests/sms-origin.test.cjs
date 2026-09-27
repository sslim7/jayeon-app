/**
 * 문자 화면을 닫으면 **어디로 돌아가 무슨 말을 하는가**(→ `src/lib/sms-origin.ts`).
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **여기서 지키는 한 줄은 「화면이 사용자에게 없던 일을 말하지 않는다」다.** 실기기에서   │
 * │ 「문자 보내기」로 2명을 골라 발송을 중단하고 닫았더니 「예약 문자 보내기」가 떴고, 거기    │
 * │ 「2명의 예약을 취소했어요」가 그대로 보였다 — 예약은 손도 대지 않았는데.                 │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 판정이 화면 안에 있으면 `node --test` 가 닿지 않아, 이 증상을 사람이 실기기로 다시 겪어야만
 * 알 수 있다. 그래서 「돌아갈 곳」과 「그곳에서 할 말」을 순수 함수로 빼 두고 여기서 못 박는다.
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

const { readSmsOrigin, readSmsLeave, readSmsOnlyIds, smsExit, SMS_ORIGIN_ROUTE, SMS_ORIGIN_PARAM, SMS_LEAVE_PARAM, SMS_ONLY_PARAM } =
  load('src/lib/sms-origin.ts');

test('출처를 읽는다 — 모르는 값은 문자 보내기다', () => {
  assert.equal(readSmsOrigin('reserved'), 'reserved');
  assert.equal(readSmsOrigin('history'), 'history');
  assert.equal(readSmsOrigin('send'), 'send');
  // 웹 새로고침·딥링크처럼 파라미터가 없을 때. 나갈 길을 잃지 않는 것이 먼저다.
  assert.equal(readSmsOrigin(undefined), 'send');
  assert.equal(readSmsOrigin(''), 'send');
  assert.equal(readSmsOrigin('RESERVED'), 'send');
  assert.equal(readSmsOrigin('/sms/reserved'), 'send');
  assert.equal(readSmsOrigin(42), 'send');
  // expo-router 는 같은 이름이 둘이면 배열로 준다. 첫 값만 본다.
  assert.equal(readSmsOrigin(['reserved', 'send']), 'reserved');
});

test('「닫고 돌아왔다」 흔적이 없으면 아무 말도 하지 않는다', () => {
  assert.equal(readSmsLeave('detail'), 'detail');
  assert.equal(readSmsLeave('compose'), 'compose');
  assert.equal(readSmsLeave(undefined), null);
  assert.equal(readSmsLeave('1'), null);
  assert.equal(readSmsLeave(['compose']), 'compose');
});

test('🔴 출처가 다르면 돌아가는 곳이 갈린다', () => {
  assert.equal(smsExit('send', 'detail').route, '/sms/new');
  assert.equal(smsExit('reserved', 'detail').route, '/sms/reserved');
  assert.equal(smsExit('history', 'detail').route, '/sms');
  // 실기기에서 겪은 그 장면: 문자 보내기에서 들어왔으면 **절대** 예약함으로 나가지 않는다.
  assert.notEqual(smsExit('send', 'detail').route, smsExit('reserved', 'detail').route);
});

test('🔴 출처가 다르면 안내 문구도 갈린다 — 예약 이야기는 예약 흐름에서만', () => {
  const fromSend = smsExit('send', 'detail').notice;
  const fromReserved = smsExit('reserved', 'detail').notice;
  assert.notEqual(fromSend, fromReserved);
  // 「2명의 예약을 취소했어요」가 문자 보내기 흐름에 뜨던 자리.
  assert.ok(!fromSend.includes('예약'), fromSend);
  assert.ok(fromReserved.includes('예약'), fromReserved);
  // 예약함으로 돌아온 사람에게 가장 먼저 밝혀야 할 것: 취소한 게 아니다.
  assert.ok(fromReserved.includes('취소한 것이 아니'), fromReserved);
  // 어느 쪽도 「취소했어요」라고 말하지 않는다 — 닫기는 아무것도 취소하지 않는다.
  for (const origin of ['send', 'reserved', 'history']) {
    for (const leave of ['compose', 'detail']) {
      assert.ok(!smsExit(origin, leave).notice.includes('취소했어요'), `${origin}/${leave}`);
    }
  }
});

test('작성을 그만둔 것과 이미 만들어진 문자를 닫은 것은 다른 말이다', () => {
  const compose = smsExit('send', 'compose', 2);
  assert.equal(compose.notice, '2명에게 보내려던 문자를 그만뒀어요. 문자는 보내지 않았어요.');
  // 인원을 모르면 숫자 없이 말한다. 「0명에게」라고 적으면 그 자체가 거짓말이 된다.
  assert.ok(!smsExit('send', 'compose').notice.includes('0명'));
  assert.ok(!smsExit('send', 'compose', 0).notice.includes('0명'));
  // 상세를 닫아도 만들어진 캠페인은 남는다 — 어디서 다시 찾는지까지 적는다.
  assert.ok(smsExit('send', 'detail').notice.includes('발송 이력'));
  assert.notEqual(smsExit('send', 'compose', 2).notice, smsExit('send', 'detail').notice);
});

test('닫고 갈 주소에는 흔적이 달려 있다 — 도착한 화면이 그 한 줄을 세운다', () => {
  assert.equal(smsExit('reserved', 'detail').href, `/sms/reserved?${SMS_LEAVE_PARAM}=detail`);
  assert.equal(smsExit('send', 'compose').href, `/sms/new?${SMS_LEAVE_PARAM}=compose`);
  // 주소로 나르는 것은 흔적뿐이다. 문구의 주인은 도착한 화면이라 주소창에 한국어가 서지 않는다.
  for (const origin of ['send', 'reserved', 'history']) {
    const exit = smsExit(origin, 'detail');
    assert.ok(exit.href.startsWith(`${exit.route}?`), exit.href);
    assert.ok(!exit.href.includes(exit.notice));
  }
});

test('🔴 출처가 가리키는 화면이 실제로 있어야 한다', () => {
  // 경로를 문자열로 들고 다니므로, 라우트 파일 이름이 바뀌면 여기서 먼저 걸린다.
  const file = { '/sms/new': 'new', '/sms/reserved': 'reserved', '/sms': 'index' };
  for (const route of Object.values(SMS_ORIGIN_ROUTE)) {
    assert.ok(fs.existsSync(`src/app/sms/${file[route]}.tsx`), route);
  }
});

test('파라미터 이름은 한 자리에서만 정한다', () => {
  // 싣는 쪽과 읽는 쪽이 같은 글자를 보게 한다. 한쪽만 바뀌면 출처가 조용히 사라진다.
  assert.equal(SMS_ORIGIN_PARAM, 'from');
  assert.equal(SMS_LEAVE_PARAM, 'closed');
  const screens = ['src/app/sms/[id].tsx', 'src/app/sms/new.tsx', 'src/app/sms/reserved.tsx', 'src/app/sms/index.tsx'];
  for (const screen of screens) {
    const source = fs.readFileSync(screen, 'utf8');
    // 상수를 두고도 글자를 직접 적으면 다시 갈라진다.
    assert.ok(!/params:\s*{[^}]*\bfrom:\s*'/.test(source), screen);
  }
});

/*
 * 「이 사람들에게만 보낸다」를 주소에서 읽는다.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 이 값은 **실제로 문자가 나가는 대상**이 된다. 화면이 주소 한 줄을 그대로 믿으면, 이상한 │
 * │ 링크 하나가 엉뚱한 사람에게 문자를 보낸다. 모양이 아니면 「없는 것」으로 떨어뜨린다.        │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ 「없는 것」은 전원이라 떨어뜨리는 쪽도 공짜가 아니다. 그래서 좁힌 인원수를 화면이 적고,
 * 좁힌 뒤에도 보낼 수 있는 상태인지는 `lib/sms-outcome.ts` 의 `narrowTargets` 가 다시 본다.
 */
test('파라미터 이름은 주소에 싣는 쪽과 읽는 쪽이 한 자리를 본다', () => {
  assert.equal(SMS_ONLY_PARAM, 'only');
});

test('🔴 고른 사람 목록은 쉼표로 이은 id 일 때만 읽는다', () => {
  assert.deepEqual(readSmsOnlyIds('abc123'), ['abc123']);
  assert.deepEqual(readSmsOnlyIds('abc123,DEF456,g-h_i'), ['abc123', 'DEF456', 'g-h_i']);
  // 배열로 올 수도 있다(같은 이름의 파라미터가 둘). 첫 값만 본다 — 출처를 읽을 때와 같은 태도다.
  assert.deepEqual(readSmsOnlyIds(['r1,r2', 'r9']), ['r1', 'r2']);
  // 같은 사람이 두 번 실려 와도 한 번만 센다 — 화면의 인원수가 실제 대상보다 부풀면 안 된다.
  assert.deepEqual(readSmsOnlyIds('r1,r1,r2'), ['r1', 'r2']);
});

test('🔴 기대한 모양이 아니면 「없는 것」으로 친다', () => {
  // 파라미터가 아예 없는 평소 경로. 여기서 빈 배열을 돌려주면 「아무도 아니다」가 되어
  // 발송 이력·문자 보내기에서 들어온 화면이 한 명도 못 보내게 된다.
  assert.equal(readSmsOnlyIds(undefined), null);
  assert.equal(readSmsOnlyIds(''), null);
  assert.equal(readSmsOnlyIds(null), null);
  assert.equal(readSmsOnlyIds(123), null);
  // 빈 칸이 섞인 목록(`a,,b`, `a,`)은 무엇을 뜻하는지 알 수 없다 — 짐작하지 않는다.
  assert.equal(readSmsOnlyIds(','), null);
  assert.equal(readSmsOnlyIds('a,,b'), null);
  assert.equal(readSmsOnlyIds('a,'), null);
  // id 에 없는 글자가 섞인 값. 주소를 손으로 고쳐 들어온 경우가 여기다.
  assert.equal(readSmsOnlyIds('r1 r2'), null);
  assert.equal(readSmsOnlyIds('r1,../admin'), null);
  assert.equal(readSmsOnlyIds('r1,<script>'), null);
  assert.equal(readSmsOnlyIds('사람'), null);
  assert.equal(readSmsOnlyIds('a'.repeat(65)), null);
});
