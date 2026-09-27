// 🔴 **시간대를 먼저 고정한다.** 이 파일의 핵심 주장이 「UTC 가 아니라 **로컬** 날짜로 자른다」
// 라서, 돌리는 기계의 시간대에 따라 통과·실패가 갈리면 주장 자체가 무의미해진다. Node 는 처음
// Date 를 만들 때 TZ 를 읽어 캐시하므로 require 보다 위에 있어야 한다.
process.env.TZ = 'Asia/Seoul';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
/**
 * 순수 모듈을 번들러 없이 불러오기.
 *
 * ⚠️ `runInThisContext` 다. 새 컨텍스트에서 만든 배열·객체는 프로토타입이 달라
 * `deepStrictEqual` 이 「모양은 같은데 같지 않다」로 떨어진다.
 *
 * 🔴 **`@/` 알리아스를 직접 되돌린다.** 이력 모듈은 결과 집계를 `lib/sms-outcome.ts` 에 맡긴다
 * (발송 상세와 **같은 모듈로 같은 낱말을 써야 하기 때문**). require 를 빈 객체로 메우면
 * `countOutcomes` 가 undefined 가 되어 집계가 통째로 어긋난다. 집계를 여기서 다시 짜지 않고
 * 진짜 모듈을 같이 여는 것이 요점이다 — 짜는 순간 「상세와 같은 숫자」를 증명하지 못한다.
 */
const loaded = new Map();
function load(file) {
  const found = loaded.get(file);
  if (found) return found;
  const mod = { exports: {} };
  loaded.set(file, mod.exports);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(exports, require){${compiled}\n})`)(mod.exports, (id) => (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : {}));
  return mod.exports;
}
const { historyDateKey, historyGroupKey, groupSmsHistory, historyTime, withinPeriod, outcomeSummary, historyCampaignRecipientId, currentByRecipient } = load('src/lib/sms-history-groups.ts');
const { recipientOutcome, retryTargets, unsentTargets, countOutcomes, NOT_SENT_CODES } = load('src/lib/sms-outcome.ts');

/**
 * 수신자 한 줄. 화면이 쓰는 나머지 필드는 묶음 판정과 무관해서 넣지 않는다.
 * ⚠️ 결과 집계를 볼 때는 `extra` 로 `status`/`errorCode` 를 준다 — 주지 않으면 「아직 안 보낸
 * 줄」로 세어지는데(`recipientOutcome` 의 기본값), 묶기만 보는 아래 시험들에는 상관이 없다.
 */
const row = (campaignTitle, sentAt, extra = {}) => ({ campaignTitle, sentAt, failedAt: null, updatedAt: sentAt, ...extra });

test('성공은 sentAt, 실패는 failedAt, 둘 다 없으면 updatedAt 으로 날짜를 잡는다', () => {
  assert.equal(historyDateKey({ sentAt: '2026-09-20T01:00:00.000Z', failedAt: null, updatedAt: '2026-09-25T01:00:00.000Z' }), '2026-09-20');
  assert.equal(historyDateKey({ sentAt: null, failedAt: '2026-09-21T01:00:00.000Z', updatedAt: '2026-09-25T01:00:00.000Z' }), '2026-09-21');
  assert.equal(historyDateKey({ sentAt: null, failedAt: null, updatedAt: '2026-09-22T01:00:00.000Z' }), '2026-09-22');
});

test('🔴 날짜는 UTC 가 아니라 로컬(한국 시간) 기준으로 자른다', () => {
  // 한국 시간 9월 27일 밤 11시 30분 = UTC 같은 날 14:30. 그날 묶음에 들어가야 한다.
  const lateNight = { sentAt: '2026-09-27T14:30:00.000Z', failedAt: null, updatedAt: '2026-09-27T14:30:00.000Z' };
  assert.equal(historyDateKey(lateNight), '2026-09-27');

  // 🔴 여기가 UTC 로 자르면 조용히 틀리는 자리다. UTC 27일 23:30 은 한국에서는 **28일 아침
  // 8시 30분**이다. ISO 문자열을 slice(0, 10) 하면 27일로 묶여, 사용자가 「오늘 아침에 보낸 것」
  // 으로 기억하는 발송이 어제 묶음 안에 숨는다.
  const utcRollover = { sentAt: '2026-09-27T23:30:00.000Z', failedAt: null, updatedAt: '2026-09-27T23:30:00.000Z' };
  assert.equal(utcRollover.sentAt.slice(0, 10), '2026-09-27');
  assert.equal(historyDateKey(utcRollover), '2026-09-28');

  // 그리고 같은 한국 날짜의 두 발송은 UTC 로 날이 갈려도 **한 묶음**이어야 한다.
  const groups = groupSmsHistory([
    row('더메이', '2026-09-27T23:30:00.000Z'), // 한국 28일 08:30
    row('더메이', '2026-09-28T10:00:00.000Z'), // 한국 28일 19:00
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].date, '2026-09-28');
  assert.equal(groups[0].count, 2);
});

test('같은 날 같은 템플릿은 한 묶음이 되고 건수가 인원수와 같다', () => {
  const groups = groupSmsHistory([
    row('더메이', '2026-09-27T01:00:00.000Z'),
    row('더메이', '2026-09-27T01:00:01.000Z'),
    row('더메이', '2026-09-27T01:00:02.000Z'),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual([groups[0].date, groups[0].title, groups[0].count, groups[0].items.length], ['2026-09-27', '더메이', 3, 3]);
});

test('하루에 같은 템플릿을 두 번 보내도 한 묶음이다', () => {
  // ⚠️ 의도한 동작이다. 사용자가 고른 기준이 「일자, 발송템플릿」이고, 펼치면 수신자 줄에
  // 각자의 발송 일시가 적혀 있어 두 번 나간 것은 그 자리에서 보인다.
  const groups = groupSmsHistory([
    row('더메이', '2026-09-27T01:00:00.000Z'),
    row('더메이', '2026-09-27T09:00:00.000Z'),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
});

test('날짜가 다르거나 템플릿이 다르면 묶음이 갈라진다', () => {
  const byDate = groupSmsHistory([row('더메이', '2026-09-27T01:00:00.000Z'), row('더메이', '2026-09-26T01:00:00.000Z')]);
  assert.deepEqual(byDate.map((group) => group.date), ['2026-09-27', '2026-09-26']);
  const byTitle = groupSmsHistory([row('더메이', '2026-09-27T01:00:00.000Z'), row('9월 안내', '2026-09-27T01:00:00.000Z')]);
  assert.equal(byTitle.length, 2);
  assert.deepEqual(byTitle.map((group) => group.count), [1, 1]);
});

test('묶음은 최근 일자 먼저, 같은 일자 안에서는 최근 발송이 먼저다', () => {
  const groups = groupSmsHistory([
    row('오래된 날', '2026-09-20T05:00:00.000Z'),
    row('같은 날 이른 것', '2026-09-27T01:00:00.000Z'),
    row('가장 최근 날', '2026-09-28T05:00:00.000Z'),
    row('같은 날 늦은 것', '2026-09-27T09:00:00.000Z'),
  ]);
  assert.deepEqual(groups.map((group) => group.title), ['가장 최근 날', '같은 날 늦은 것', '같은 날 이른 것', '오래된 날']);
});

test('묶음 안의 줄 순서는 받은 순서(서버의 최근 발송 순) 그대로다', () => {
  const groups = groupSmsHistory([
    row('더메이', '2026-09-27T09:00:00.000Z', { name: '나중' }),
    row('더메이', '2026-09-27T01:00:00.000Z', { name: '먼저' }),
  ]);
  assert.deepEqual(groups[0].items.map((item) => item.name), ['나중', '먼저']);
});

test('⚠️ 템플릿 이름에 구분자(|)가 들어가도 키가 충돌하지 않는다', () => {
  // 구분자로만 이어 붙이면 '2026-09-27' + '|' + 'a|b' 와 '2026-09-27|a' + '|' + 'b' 가 같은
  // 글자가 된다. 길이를 앞에 적어 두면 이름이 어디서 시작하는지가 글자와 무관하게 정해진다.
  assert.notEqual(historyGroupKey('2026-09-27', 'a|b'), historyGroupKey('2026-09-27|a', 'b'));
  const groups = groupSmsHistory([row('9월|정기', '2026-09-27T01:00:00.000Z'), row('9월', '2026-09-27T01:00:00.000Z')]);
  assert.equal(groups.length, 2);
  assert.equal(new Set(groups.map((group) => group.key)).size, 2);
  assert.deepEqual(groups.map((group) => group.count), [1, 1]);
});

test('빈 목록은 빈 묶음이다', () => {
  assert.deepEqual(groupSmsHistory([]), []);
});

test('시각을 읽을 수 없는 줄도 NaN 날짜로 목록 머리에 서지 않는다', () => {
  const groups = groupSmsHistory([row('더메이', ''), row('더메이', '2026-09-27T01:00:00.000Z')]);
  assert.ok(groups.every((group) => !group.date.includes('NaN')));
  // 최근 일자가 먼저이므로 읽을 수 있는 날짜가 위에 선다.
  assert.equal(groups[0].date, '2026-09-27');
});


// ─────────────────────────────────────────────────────────────────────────────
// 기간 거르기 — 「조회 순서가 뭐야? 100년 전 것도?」에 답하는 자리
// ─────────────────────────────────────────────────────────────────────────────

/** 시험의 「지금」. 기간 계산은 기준 시각이 정해져야 경계를 짚을 수 있다. */
const NOW = new Date('2026-09-27T12:00:00+09:00');

test('🔴 최근 3개월의 경계는 정확히 3개월 전 같은 시각이다(그 시각은 포함)', () => {
  const inside = row('더메이', '2026-06-27T12:00:00+09:00');
  const outside = row('더메이', '2026-06-27T11:59:00+09:00');
  assert.deepEqual(withinPeriod([inside, outside], 3, NOW).map((item) => item.sentAt), [inside.sentAt]);
});

test('전체(months = null)는 아무것도 거르지 않는다 — 100년 전 것까지 나온다', () => {
  const ancient = row('100년 전', '1926-09-27T12:00:00+09:00');
  const recent = row('더메이', '2026-09-27T01:00:00.000Z');
  assert.deepEqual(withinPeriod([ancient, recent], null, NOW), [ancient, recent]);
  // 기간을 고르면 그 100년 전 것은 빠진다. 기간 기본값이 하는 일이 이것이다.
  assert.deepEqual(withinPeriod([ancient, recent], 6, NOW).map((item) => item.campaignTitle), ['더메이']);
});

test('⚠️ 말일에서 1개월을 빼도 경계가 뒤로 밀리지 않는다', () => {
  // `setMonth` 에 그냥 맡기면 3월 31일 - 1개월이 「2월 31일」 → 3월 3일이 되어, 2월 28일에
  // 보낸 발송이 「최근 1개월」에서 조용히 빠진다. 화면에는 그럴듯한 목록이 떠서 틀린 줄도 모른다.
  const endOfMarch = new Date('2026-03-31T12:00:00+09:00');
  assert.equal(withinPeriod([row('더메이', '2026-02-28T12:00:00+09:00')], 1, endOfMarch).length, 1);
  // 경계를 넓힌 것이 아니라 제자리에 둔 것이다 — 그 앞은 그대로 걸러진다.
  assert.equal(withinPeriod([row('더메이', '2026-02-27T12:00:00+09:00')], 1, endOfMarch).length, 0);
});

test('🔴 기간 거르기는 묶기와 **같은 시각**을 본다 — 실패만 있는 줄에서 갈린다', () => {
  // `sentAt` 이 비고 `failedAt` 만 있는 줄. 거르는 쪽이 `sentAt` 이나 `updatedAt` 만 보면
  // 이 줄의 시각을 잘못 읽어, 「목록엔 있는데 그 묶음이 없다」(또는 그 반대)가 된다.
  const failedInside = { campaignTitle: '더메이', sentAt: null, failedAt: '2026-09-20T01:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' };
  const failedOutside = { campaignTitle: '더메이', sentAt: null, failedAt: '2026-01-20T01:00:00.000Z', updatedAt: '2026-09-27T01:00:00.000Z' };
  assert.equal(historyTime(failedInside), failedInside.failedAt);
  assert.deepEqual(withinPeriod([failedInside, failedOutside], 3, NOW), [failedInside]);
  // 그리고 남은 줄이 묶일 때도 같은 시각을 쓴다.
  const groups = groupSmsHistory(withinPeriod([failedInside, failedOutside], 3, NOW));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].date, historyDateKey(failedInside));
  assert.equal(groups[0].date, '2026-09-20');
});

test('시각을 못 읽는 줄은 기간 거르기에서 버리지 않는다', () => {
  // 어느 기간에 속하는지 판단할 근거가 없는 줄이다. 없는 셈 치면 사용자는 「전체」를 고르기
  // 전까지 그 줄을 영원히 볼 수 없다. 묶기도 같은 태도다(→ `historyDateKey`).
  assert.equal(withinPeriod([row('더메이', '')], 1, NOW).length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 묶음의 결과 집계 — 「24건」이 아니라 「성공 21 · 실패 3」
// ─────────────────────────────────────────────────────────────────────────────

test('묶음의 숫자는 결과별로 갈라지고 합은 줄 수와 같다', () => {
  const at = '2026-09-27T01:00:00.000Z';
  const groups = groupSmsHistory([
    row('더메이', at, { status: 'SENT' }),
    row('더메이', at, { status: 'SENT' }),
    row('더메이', at, { status: 'FAILED', errorCode: 'CARRIER_REJECTED' }),
    row('더메이', at, { status: 'READY' }),
    row('더메이', at, { status: 'UNKNOWN' }),
  ]);
  assert.equal(groups[0].count, 5);
  assert.deepEqual(groups[0].counts, { sent: 2, failed: 1, unsent: 1, review: 1, sending: 0 });
});

test('🔴 사람이 일부러 안 보낸 FAILED 는 「실패」가 아니라 「미발송」으로 센다', () => {
  // 서버 `status` 는 `SENT|FAILED` 둘뿐이라 통과·중단·시트 취소도 전부 FAILED 로 들어온다.
  // 그걸 실패로 세면 「보내려다 안 간 것」과 「아예 안 보낸 것」이 한 칸에 섞여, 사용자가 무엇을
  // 해야 하는지 알 수 없다. 발송 상세와 **같은 모듈**로 세야 두 화면의 숫자가 같다.
  const at = '2026-09-27T01:00:00.000Z';
  const groups = groupSmsHistory([
    row('더메이', at, { status: 'FAILED', errorCode: 'USER_SKIPPED' }),
    row('더메이', at, { status: 'FAILED', errorCode: 'IOS_COMPOSER_ABANDONED' }),
    row('더메이', at, { status: 'FAILED', errorCode: 'CARRIER_REJECTED' }),
  ]);
  assert.deepEqual(groups[0].counts, { sent: 0, failed: 1, unsent: 2, review: 0, sending: 0 });
  assert.equal(outcomeSummary(groups[0].counts), '실패 1 · 미발송 2');
});

test('⚠️ 결과 요약에서 0인 칸은 적지 않는다', () => {
  assert.equal(outcomeSummary({ sent: 24, failed: 0, unsent: 0, review: 0, sending: 0 }), '성공 24');
  assert.equal(outcomeSummary({ sent: 21, failed: 3, unsent: 0, review: 0, sending: 0 }), '성공 21 · 실패 3');
  assert.equal(outcomeSummary({ sent: 1, failed: 2, unsent: 3, review: 4, sending: 5 }), '성공 1 · 실패 2 · 미발송 3 · 발송중 5 · 확인 필요 4');
  // 다 0이면 빈 글자 대신 `0건`. 머리에 아무 글자도 없는 묶음이 서는 것보다 낫다.
  assert.equal(outcomeSummary({ sent: 0, failed: 0, unsent: 0, review: 0, sending: 0 }), '0건');
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 한 사람이 두 줄로 온다 — 「미발송 2명이 누구인지 안 보여준다?」가 시작된 자리
//
// 서버는 재시도한 사람에 대해 「지난 실패 줄」과 「지금 대기 줄」을 **둘 다** 내려준다. 이력이니
// 의도한 동작이다. 그래서 서버의 `total` 은 사람 수가 아니라 줄 수고, 화면이 줄을 그대로 세면
// 한 사람이 두 명이 된다.
// ─────────────────────────────────────────────────────────────────────────────

/** 캠페인 `c1` 안의 수신자 한 줄. `id` 는 서버가 만드는 모양 그대로다. */
const line = (id, extra) => ({
  id, campaignId: 'c1', campaignTitle: '더메이', name: '박새롬',
  sentAt: null, failedAt: null, updatedAt: null, status: 'READY', errorCode: null, ...extra,
});
/** 「지난 실패」 줄. 완료된 시도라 `{campaignId}_{campaignRecipientId}_{attemptId}` 다. */
const failedLine = (recipientId, campaignRecipientId, at) => line(`c1_${campaignRecipientId}_attempt-1`, {
  recipientId, status: 'FAILED', errorCode: 'CARRIER_REJECTED', failedAt: at, updatedAt: at,
});
/** 「지금 대기」 줄. 아직 시도가 없어 `#pending` 이 붙는다. */
const pendingLine = (recipientId, campaignRecipientId, at) => line(`c1_${campaignRecipientId}#pending`, {
  recipientId, status: 'READY', updatedAt: at,
});

test('🔴 실패했다가 재시도로 대기가 된 사람은 **한 명**으로 세어진다', () => {
  // 그대로 세면 「실패 1 · 미발송 1」 — 한 사람인데 두 명이다. 사용자가 「미발송 2명」을 찾다가
  // 막힌 자리가 정확히 이것이다.
  const groups = groupSmsHistory([
    failedLine('r1', 'cr1', '2026-09-23T01:00:00.000Z'),
    pendingLine('r1', 'cr1', '2026-09-23T02:00:00.000Z'),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].counts, { sent: 0, failed: 0, unsent: 1, review: 0, sending: 0 });
  assert.equal(outcomeSummary(groups[0].counts), '미발송 1');
});

test('🔴 그런데 **목록에는 두 줄 다 남는다** — 「지난 실패」도 보여야 이력이다', () => {
  const rows = [
    failedLine('r1', 'cr1', '2026-09-23T01:00:00.000Z'),
    pendingLine('r1', 'cr1', '2026-09-23T02:00:00.000Z'),
  ];
  const groups = groupSmsHistory(rows);
  // 접는 것은 **세는 일**뿐이다. 실패 줄이 사라지면 사용자는 왜 다시 보내야 하는지 알 수 없다.
  assert.deepEqual(groups[0].items.map((item) => item.id), rows.map((item) => item.id));
  assert.equal(groups[0].count, 2);
  // 줄 수(`count` 2)와 사람 수(`counts` 합 1)는 서로 다른 것을 센다.
  assert.equal(groups[0].counts.sent + groups[0].counts.failed + groups[0].counts.unsent + groups[0].counts.review + groups[0].counts.sending, 1);
});

test('🔴 시각이 같으면 **대기 줄**이 지금 상태다 — 재시도는 실패 뒤에 온다', () => {
  // 대기 줄의 시각(`updatedAt`)이 되돌린 그 순간이라 실패 시각과 같은 밀리초일 수 있다. 여기서
  // 실패 줄을 골라 버리면 재시도를 눌러 둔 사람이 「실패 1」로 남아 미발송 수에서 빠진다.
  const at = '2026-09-23T01:00:00.000Z';
  const groups = groupSmsHistory([pendingLine('r1', 'cr1', at), failedLine('r1', 'cr1', at)]);
  assert.deepEqual(groups[0].counts, { sent: 0, failed: 0, unsent: 1, review: 0, sending: 0 });
  // 순서를 뒤집어도 같다.
  const flipped = groupSmsHistory([failedLine('r1', 'cr1', at), pendingLine('r1', 'cr1', at)]);
  assert.deepEqual(flipped[0].counts, { sent: 0, failed: 0, unsent: 1, review: 0, sending: 0 });
});

test('다른 사람은 각각 센다 — 접는 기준은 「같은 발송 · 같은 사람」이다', () => {
  const groups = groupSmsHistory([
    failedLine('r1', 'cr1', '2026-09-23T01:00:00.000Z'),
    pendingLine('r1', 'cr1', '2026-09-23T02:00:00.000Z'),
    pendingLine('r2', 'cr2', '2026-09-23T02:00:00.000Z'),
  ]);
  assert.deepEqual(groups[0].counts, { sent: 0, failed: 0, unsent: 2, review: 0, sending: 0 });
  assert.equal(groups[0].count, 3);
});

test('⚠️ 하루에 같은 템플릿을 두 번 보내면 같은 사람도 두 번 센다 — 발송이 다르기 때문이다', () => {
  // 수신자 id 만으로 접으면 20명에게 두 번 보낸 40건이 「성공 20」으로 줄어든다. 접어야 하는
  // 것은 **한 발송 안에서** 같은 사람이 남긴 여러 줄뿐이다.
  const morning = { ...line('c1_cr1_a1', { recipientId: 'r1', status: 'SENT', sentAt: '2026-09-23T01:00:00.000Z', updatedAt: '2026-09-23T01:00:00.000Z' }) };
  const evening = { ...line('c2_cr9_a2', { recipientId: 'r1', status: 'SENT', sentAt: '2026-09-23T09:00:00.000Z', updatedAt: '2026-09-23T09:00:00.000Z' }), campaignId: 'c2' };
  const groups = groupSmsHistory([morning, evening]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].counts, { sent: 2, failed: 0, unsent: 0, review: 0, sending: 0 });
});

test('⚠️ `recipientId`(또는 `campaignId`)가 없는 줄은 접히지 않는다 — 외부 발송 기록이 그렇다', () => {
  // 누구인지 확신할 수 없는 줄을 남의 줄과 합치면 사람 수가 조용히 줄어든다.
  const at = '2026-09-23T01:00:00.000Z';
  const external = { campaignTitle: '외부 발송 등록', sentAt: at, failedAt: null, updatedAt: at, status: 'SENT', errorCode: null, id: 'x1', source: 'EXTERNAL' };
  const groups = groupSmsHistory([external, { ...external, id: 'x2' }]);
  assert.deepEqual(groups[0].counts, { sent: 2, failed: 0, unsent: 0, review: 0, sending: 0 });
  // 캠페인은 있는데 수신자 id 만 없는 줄도 마찬가지다.
  const noRecipient = line('c1_cr1#pending', { updatedAt: at });
  assert.equal(currentByRecipient([noRecipient, { ...noRecipient, id: 'c1_cr2#pending' }]).length, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 캠페인 수신자 id 뽑기 — 여기가 틀리면 **엉뚱한 사람에게 문자가 간다**
// ─────────────────────────────────────────────────────────────────────────────

test('🔴 대기 줄 `id` 에서 캠페인 수신자 id 를 뽑는다(`#pending` 을 뗀다)', () => {
  assert.equal(historyCampaignRecipientId({ id: 'c1_cr1#pending', campaignId: 'c1' }), 'cr1');
  // 완료된 시도 줄은 뒤에 시도 id 가 붙는다.
  assert.equal(historyCampaignRecipientId({ id: 'c1_cr1_attempt-1', campaignId: 'c1' }), 'cr1');
});

test('🔴 시도 id 안의 `_` 에 걸리지 않는다 — 앞에서부터 첫 `_` 까지가 캠페인 수신자 id 다', () => {
  // 캠페인 수신자 id 는 Firestore 가 만든 `[A-Za-z0-9]{20}` 이라 `_` 를 담지 않는 반면,
  // 시도 id 는 담을 수 있다. 뒤에서 자르면 여기서 조용히 틀린다.
  assert.equal(historyCampaignRecipientId({ id: 'c1_cr1_sms_1727_3_abc', campaignId: 'c1' }), 'cr1');
});

test('🔴 모양이 다르면 짐작하지 않고 `null` 이다 — 잘못 뽑느니 버튼을 안 세우는 편이 낫다', () => {
  // 캠페인을 모르는 줄(외부 발송 기록)은 앞을 잘라 낼 기준이 없다.
  assert.equal(historyCampaignRecipientId({ id: 'x1' }), null);
  assert.equal(historyCampaignRecipientId({ id: 'c1_cr1#pending', campaignId: '' }), null);
  // 앞이 이 캠페인의 것이 아니다.
  assert.equal(historyCampaignRecipientId({ id: 'other_cr1_a1', campaignId: 'c1' }), null);
  // 구분자가 없어 어디까지가 수신자 id 인지 알 수 없다.
  assert.equal(historyCampaignRecipientId({ id: 'c1_cr1', campaignId: 'c1' }), null);
  assert.equal(historyCampaignRecipientId({ id: 'c1_#pending', campaignId: 'c1' }), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 「나갔는지 모르는 줄」에는 재발송 버튼을 달지 않는다
// ─────────────────────────────────────────────────────────────────────────────

test('🔴 `REVIEW` 줄은 재발송 대상이 아니다 — 이미 나간 문자를 또 보내게 된다', () => {
  // 화면의 버튼 표(`app/sms/history.tsx` 의 `SEND_LABELS`)는 `UNSENT`·`PENDING`·`FAILED` 에만
  // 글자를 둔다. 그 판정이 여기 `recipientOutcome` 과 **같은 모듈**이라는 것이 요점이다.
  const unknown = { id: 'c1_cr1_a1', status: 'UNKNOWN', errorCode: null };
  const partial = { id: 'c1_cr2_a2', status: 'FAILED', errorCode: 'PARTIAL_SENT' };
  const sending = { id: 'c1_cr3_a3', status: 'SENDING', errorCode: null };
  assert.deepEqual([unknown, partial, sending].map(recipientOutcome), ['REVIEW', 'REVIEW', 'SENDING']);
  assert.deepEqual(retryTargets([unknown, partial, sending]), []);
  assert.deepEqual(unsentTargets([unknown, partial, sending]), []);
  // 성공한 줄도 마찬가지로 아무 목록에도 들지 않는다.
  const sent = { id: 'c1_cr4_a4', status: 'SENT', errorCode: null };
  assert.equal(recipientOutcome(sent), 'SENT');
  assert.deepEqual([...retryTargets([sent]), ...unsentTargets([sent])], []);
  // 그리고 묶음 집계에서는 「확인 필요」 칸으로 간다 — 미발송에 섞이지 않는다.
  const groups = groupSmsHistory([line('c1_cr1_a1', { recipientId: 'r1', status: 'UNKNOWN', updatedAt: '2026-09-23T01:00:00.000Z' })]);
  assert.deepEqual(groups[0].counts, { sent: 0, failed: 0, unsent: 0, review: 1, sending: 0 });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 「발송중」은 「확인 필요」와 다른 말이다
//
// 서버는 발송용으로 잡아 둔 사람의 결과를 받지 못하면 그를 `SENDING` 인 채로 둔다 — 나갔는지
// 알 길이 없으므로 스스로 판정하지 않는다. 그 줄 하나 때문에 그 캠페인은 한 명도 더 보낼 수
// 없다(→ `lib/sms-runner.ts`). 그러니 「나갔는지 모름」과 한 칸에 묶어 두면, 사용자는 무엇을
// 확인하고 무엇을 풀어야 하는지 알 수 없다.
// ─────────────────────────────────────────────────────────────────────────────

test('🔴 `SENDING` 은 「확인 필요」가 아니라 그날 묶음에 「발송중」으로 선다', () => {
  const at = '2026-09-23T01:00:00.000Z';
  const groups = groupSmsHistory([
    line('c1_cr1_a1', { recipientId: 'r1', status: 'SENDING', updatedAt: at }),
    line('c1_cr2_a2', { recipientId: 'r2', status: 'UNKNOWN', updatedAt: at }),
    line('c1_cr3_a3', { recipientId: 'r3', status: 'SENT', sentAt: at, updatedAt: at }),
  ]);
  assert.deepEqual(groups[0].counts, { sent: 1, failed: 0, unsent: 0, review: 1, sending: 1 });
  assert.equal(outcomeSummary(groups[0].counts), '성공 1 · 발송중 1 · 확인 필요 1');
  // 갈라 놓아도 **재발송 대상이 아닌 것은 그대로다.** 미발송으로 세면 이미 나간 문자를 또 보낸다.
  const rows = [{ id: 'c1_cr1_a1', status: 'SENDING', errorCode: null }];
  assert.deepEqual(unsentTargets(rows), []);
  assert.deepEqual(retryTargets(rows), []);
});

test('🔴 사람이 「안 나간 것으로 표시」한 줄은 미발송으로 세어진다', () => {
  // 이력 화면이 그 줄을 닫을 때 쓰는 사유다(→ `app/sms/history.tsx` 의 `markNotSent`).
  // ⚠️ `NOT_SENT_CODES` 에 없으면 「실패」로 세어져 「다시 보내기」가 그 사람을 가리키고,
  // 「미발송」 칸에서는 사라진다 — 사용자가 방금 닫은 사람이 화면에서 증발한다.
  assert.ok(NOT_SENT_CODES.includes('USER_MARKED_NOT_SENT'));
  const closed = { id: 'c1_cr1_a1', status: 'FAILED', errorCode: 'USER_MARKED_NOT_SENT' };
  assert.equal(recipientOutcome(closed), 'UNSENT');
  assert.deepEqual(countOutcomes([closed]), { sent: 0, failed: 0, unsent: 1, review: 0, sending: 0 });
  // 그리고 그 사람은 곧장 다시 보낼 수 있다 — 닫는 것과 포기하는 것은 다르다.
  assert.deepEqual(unsentTargets([closed]), ['c1_cr1_a1']);
  assert.deepEqual(retryTargets([closed]), []);
});

test('🔴 발송중이던 사람을 닫으면 그 묶음의 「발송중」이 「미발송」으로 옮겨 간다', () => {
  // 화면에서 벌어지는 일 그대로다: 발송중 1건이 남아 캠페인이 막혀 있다가, 사람이 폰
  // 메시지함을 확인하고 닫으면 그 자리가 미발송으로 바뀌어 다시 보낼 수 있게 된다.
  const at = '2026-09-23T01:00:00.000Z';
  const before = groupSmsHistory([line('c1_cr1_a1', { recipientId: 'r1', status: 'SENDING', updatedAt: at })]);
  assert.equal(outcomeSummary(before[0].counts), '발송중 1');
  const after = groupSmsHistory([line('c1_cr1_a1', { recipientId: 'r1', status: 'FAILED', errorCode: 'USER_MARKED_NOT_SENT', failedAt: at, updatedAt: at })]);
  assert.equal(outcomeSummary(after[0].counts), '미발송 1');
});
