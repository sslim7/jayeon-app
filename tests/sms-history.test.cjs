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
const { historyDateKey, historyGroupKey, groupSmsHistory, historyTime, withinPeriod, needsAttention, outcomeSummary } = load('src/lib/sms-history-groups.ts');

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
  // 기간을 고르면 그 100년 전 것은 빠진다. 기본값(3개월)이 하는 일이 이것이다.
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
// 「확인이 필요한 발송」 판정
// ─────────────────────────────────────────────────────────────────────────────

test('🔴 「확인이 필요한 발송」에 중단(CANCELLED)은 들어가지 않는다', () => {
  // 운영에서 멈춰 세운 발송 3건을 취소 처리했더니 `status !== COMPLETED` 필터가 그것들을 전부
  // 「미완료」로 올렸다. 중단은 사용자가 이미 결론을 낸 것이라 손볼 일이 없다.
  assert.equal(needsAttention({ status: 'CANCELLED' }), false);
  assert.equal(needsAttention({ status: 'COMPLETED' }), false);
  assert.deepEqual(['READY', 'SENDING', 'PARTIAL_FAILED'].map((status) => needsAttention({ status })), [true, true, true]);
  // ⚠️ 들여보내는 쪽을 적어 두었다 — 새 상태는 그 목록을 지나야 화면에 선다. 조용히 섞이지 않는다.
  assert.equal(needsAttention({ status: 'SOMETHING_NEW' }), false);
  const listed = [{ status: 'READY' }, { status: 'CANCELLED' }, { status: 'COMPLETED' }, { status: 'PARTIAL_FAILED' }].filter(needsAttention);
  assert.deepEqual(listed.map((item) => item.status), ['READY', 'PARTIAL_FAILED']);
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
  assert.deepEqual(groups[0].counts, { sent: 2, failed: 1, unsent: 1, review: 1 });
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
  assert.deepEqual(groups[0].counts, { sent: 0, failed: 1, unsent: 2, review: 0 });
  assert.equal(outcomeSummary(groups[0].counts), '실패 1 · 미발송 2');
});

test('⚠️ 결과 요약에서 0인 칸은 적지 않는다', () => {
  assert.equal(outcomeSummary({ sent: 24, failed: 0, unsent: 0, review: 0 }), '성공 24');
  assert.equal(outcomeSummary({ sent: 21, failed: 3, unsent: 0, review: 0 }), '성공 21 · 실패 3');
  assert.equal(outcomeSummary({ sent: 1, failed: 2, unsent: 3, review: 4 }), '성공 1 · 실패 2 · 미발송 3 · 확인 필요 4');
  // 다 0이면 빈 글자 대신 `0건`. 머리에 아무 글자도 없는 묶음이 서는 것보다 낫다.
  assert.equal(outcomeSummary({ sent: 0, failed: 0, unsent: 0, review: 0 }), '0건');
});
