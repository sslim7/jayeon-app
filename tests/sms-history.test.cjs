// 🔴 **시간대를 먼저 고정한다.** 이 파일의 핵심 주장이 「UTC 가 아니라 **로컬** 날짜로 자른다」
// 라서, 돌리는 기계의 시간대에 따라 통과·실패가 갈리면 주장 자체가 무의미해진다. Node 는 처음
// Date 를 만들 때 TZ 를 읽어 캐시하므로 require 보다 위에 있어야 한다.
process.env.TZ = 'Asia/Seoul';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const compiled = ts.transpileModule(fs.readFileSync('src/lib/sms-history-groups.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
// ⚠️ `runInThisContext` 다. 새 컨텍스트에서 만든 배열·객체는 프로토타입이 달라
// `deepStrictEqual` 이 「모양은 같은데 같지 않다」로 떨어진다.
vm.runInThisContext(`(function(exports, require){${compiled}\n})`)(mod.exports, () => ({}));
const { historyDateKey, historyGroupKey, groupSmsHistory } = mod.exports;

/** 수신자 한 줄. 화면이 쓰는 나머지 필드는 묶음 판정과 무관해서 넣지 않는다. */
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
