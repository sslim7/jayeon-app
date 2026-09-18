const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

/*
 * 기기 목록의 **표기 규칙**만 따로 붙잡는다.
 *
 * 🔴 여기 있는 규칙은 화면에서는 눈에 잘 띄지 않는데 틀리면 조용히 거짓말이 된다:
 * 마지막 접속은 날짜까지만(시:분을 적으면 뒤처진 기록을 정확한 시각인 양 말하게 된다),
 * 한계 시각은 날이 넘어가면 날짜까지(「오전 12:10까지」만 적으면 **이미 지난 시각**으로
 * 읽혀 사용자가 안심한다). 화면 테스트로는 그 경계(자정 근처)를 만들기 어렵다.
 */
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('src/lib/session-api.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
// 표기 함수는 api 를 부르지 않는다 — 불러오기만 만족시키면 된다.
const stubs = {
  '@/lib/api': { api: {}, ApiError: class ApiError extends Error {} },
  '@/lib/api-errors': { ContractError: class ContractError extends Error {}, readApiErrorMessage: () => '' },
};
vm.runInNewContext(`(function(exports, require){${source}\n})`, { Error, Date, Number, String, RegExp, Math })(
  mod.exports,
  (name) => stubs[name],
);
const { ACCESS_TOKEN_TTL_MS, sessionDayLabel, sessionClockLabel, revokedText } = mod.exports;

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

test('마지막 접속은 날짜까지만 적고 시:분을 흘리지 않는다', () => {
  const now = new Date(2026, 8, 19, 15, 30);
  assert.equal(sessionDayLabel(at(2026, 9, 19, 2, 5), now), '오늘');
  assert.equal(sessionDayLabel(at(2026, 9, 18, 23, 59), now), '어제');
  assert.equal(sessionDayLabel(at(2026, 9, 17), now), '2026.09.17');
  assert.equal(sessionDayLabel(at(2026, 1, 3), now), '2026.01.03');
  // 🔴 어떤 입력에서도 시:분이 새어 나오면 안 된다.
  for (const value of [at(2026, 9, 19, 0, 1), at(2026, 9, 18), at(2025, 12, 31)]) {
    assert.doesNotMatch(sessionDayLabel(value, now), /:|오전|오후/);
  }
  // 읽을 수 없는 값은 빈 문자열이다 — `Invalid Date` 를 그리면 앱이 고장 난 것으로 읽힌다.
  for (const value of [null, undefined, '', '어제', 'not-a-date']) assert.equal(sessionDayLabel(value, now), '');
});

test('한계 시각은 시:분으로 적되 날이 넘어가면 날짜를 앞에 붙인다', () => {
  const now = new Date(2026, 8, 19, 23, 55);
  assert.equal(sessionClockLabel(at(2026, 9, 19, 23, 58), now), '오후 11:58');
  // 🔴 자정을 넘긴 한계를 「오전 12:10」으로만 적으면 이미 지난 시각으로 읽힌다.
  assert.equal(sessionClockLabel(at(2026, 9, 20, 0, 10), now), '내일 오전 12:10');
  assert.equal(sessionClockLabel(at(2026, 9, 21, 9, 5), now), '9월 21일 오전 9:05');
  assert.equal(sessionClockLabel(at(2026, 9, 19, 12, 0), now), '오후 12:00');
  assert.equal(sessionClockLabel(at(2026, 9, 19, 0, 0), now), '오전 12:00');
  for (const value of [null, undefined, '', 'nope']) assert.equal(sessionClockLabel(value, now), '');
});

test('끊긴 기기는 「늦어도」를 달고, 한계가 지나면 지났다고 말한다', () => {
  const now = new Date(2026, 8, 19, 15, 30);
  const soon = revokedText({ accessibleUntilAtMost: at(2026, 9, 19, 15, 44) }, now);
  assert.match(soon, /늦어도 오후 3:44까지/);
  // ⚠️ 상한이라는 성격이 문장에서 사라지면 그 시각에 정확히 끊긴다고 읽힌다.
  assert.match(soon, /늦어도/);
  assert.match(revokedText({ accessibleUntilAtMost: at(2026, 9, 19, 15, 0) }, now), /이제 이 기기에서는 다시 로그인해야/);
  // 🔴 값이 없으면 시각을 지어내지 않는다.
  assert.equal(revokedText({ accessibleUntilAtMost: null }, now), '끊었어요.');
  assert.equal(revokedText({ accessibleUntilAtMost: 'nope' }, now), '끊었어요.');
});

test('확인 문구가 쓰는 상한은 서버의 액세스 토큰 수명과 같은 15분이다', () => {
  // 🔴 서버의 AccessTokenTTL(§jayeon-was/internal/auth/token.go)과 어긋나면 확인 문구만 조용히 틀린다.
  assert.equal(ACCESS_TOKEN_TTL_MS, 15 * 60_000);
});
