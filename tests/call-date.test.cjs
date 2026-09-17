const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('src/lib/call-date.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${source}\n})`, { Error, Date, Number, String, RegExp })(mod.exports);
const { CALL_CLOCK_SKEW_MS, callLocalTime, parseCallTime, defaultCallTime, toDateTimeInput, fromDateTimeInput } = mod.exports;

test('통화일시는 현지시각을 ISO로 변환하며 형식·존재하지 않는 날짜·미래를 거절한다', () => {
  const now = new Date(2026, 8, 17, 15, 0);
  assert.equal(parseCallTime('2026-09-17 14:20', now), new Date(2026, 8, 17, 14, 20).toISOString());
  assert.equal(callLocalTime(new Date(2026, 0, 2, 3, 4)), '2026-01-02 03:04');
  // 기기 시계 여유(5분) 안쪽은 받아 준다. 서버도 같은 여유를 둔다.
  assert.equal(CALL_CLOCK_SKEW_MS, 5 * 60_000);
  assert.equal(parseCallTime('2026-09-17 15:05', now), new Date(2026, 8, 17, 15, 5).toISOString());
  assert.throws(() => parseCallTime('2026-09-17 15:06', now), /미래/);
  for (const value of ['', '2026-09-17', '2026-9-17 14:20', '2026-09-17T14:20', '내일 두시']) assert.throws(() => parseCallTime(value, now), /형식/);
  for (const value of ['2026-02-30 12:00', '2026-13-01 00:00', '2026-09-17 24:00', '0999-01-01 00:00']) assert.throws(() => parseCallTime(value, now), /유효한/);
});

test('파일 시각은 기본값이 되고, 없거나 미래면 비워 둔다', () => {
  const now = new Date(2026, 8, 17, 15, 0);
  assert.equal(defaultCallTime(new Date(2026, 8, 17, 14, 20).getTime(), now), '2026-09-17 14:20');
  // 시계 여유 안쪽의 앞선 시각은 기기 시계 오차로 보고 받아 준다.
  assert.equal(defaultCallTime(now.getTime() + 60_000, now), callLocalTime(new Date(now.getTime() + 60_000)));
  assert.equal(defaultCallTime(now.getTime() + 6 * 60_000, now), '');
  for (const value of [undefined, null, 0, -1, NaN, Infinity, '2026-09-17']) assert.equal(defaultCallTime(value, now), '');
});

test('datetime-local 입력 값과 화면 값이 서로 오간다', () => {
  assert.equal(toDateTimeInput('2026-09-17 14:20'), '2026-09-17T14:20');
  for (const value of ['', '2026-09-17', '아무거나']) assert.equal(toDateTimeInput(value), '');
  assert.equal(fromDateTimeInput('2026-09-17T14:20'), '2026-09-17 14:20');
  // 초를 붙여 주는 브라우저가 있다. 분까지만 쓴다.
  assert.equal(fromDateTimeInput('2026-09-17T14:20:00'), '2026-09-17 14:20');
  for (const value of ['', '2026-09-17', '14:20']) assert.equal(fromDateTimeInput(value), '');
});
