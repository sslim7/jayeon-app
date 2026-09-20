/**
 * 껍데기가 **웹의 말을 듣고 열어 주는 화면**의 허용 목록(→ `src/lib/shell-routes.ts`).
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **여기가 보안 경계다.** 웹뷰가 여는 페이지는 바깥 서버가 주는 것이라, 이 판정이       │
 * │ 느슨해지면 「웹이 시키는 대로 껍데기의 아무 화면이나 연다」가 된다. 그래서 판정을        │
 * │ `components/web-shell.tsx` 안이 아니라 순수 모듈에 두고 여기서 확인한다 — 웹뷰를       │
 * │ 끌고 들어오는 파일은 `node --test` 가 닿지 못한다.                                │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ 파일 이름이 `call-` 로 시작하는 것은 `npm run test:calls` 가 집어 가게 하려는 것이다.
 * 이 허용 목록이 여는 화면(통화 등록·받아쓰기)이 전부 통화분석 흐름이다.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const realms = { Error, Set, Map, JSON, Date, Number, Math, RegExp, String, Object, Array };

const mod = { exports: {} };
vm.runInNewContext(`(function(exports){${compile('src/lib/shell-routes.ts')}\n})`, { ...realms })(mod.exports);
const { SHELL_NATIVE_ROUTES, CALL_CREATE_PATH, shellNavigateTarget } = mod.exports;

/** 목적지 하나를 「경로 + 통화 ID」 한 줄로 납작하게 만든다. realm 이 달라 객체를 직접 비교하지 않는다. */
const flat = target => (target === null ? 'null' : `${target.path}|${target.params ? target.params.callId : ''}`);

test('허용 목록에 있는 화면만 연다', () => {
  assert.equal(flat(shellNavigateTarget('/asr-setup')), '/asr-setup|');
  assert.equal(flat(shellNavigateTarget('/call-create')), '/call-create|');
  assert.equal(flat(shellNavigateTarget('/asr-bench')), '/asr-bench|');
  // 🔴 앱에 실제로 있는 화면이어도 목록에 없으면 열지 않는다. 열 수 있는 것을 늘리는 일은
  // 「경로를 안다」가 아니라 **목록을 고치는 일**이어야 한다.
  assert.equal(shellNavigateTarget('/settings'), null);
  assert.equal(shellNavigateTarget('/devices'), null);
  assert.equal(shellNavigateTarget('/shell'), null);
  assert.equal(shellNavigateTarget('/'), null);
});

test('허용 목록은 통화 등록 화면의 경로와 같은 글자를 쓴다', () => {
  // 🔴 입구(웹 시트)와 껍데기가 다른 글자를 보면, 눌러도 아무 일이 없는 버튼이 된다.
  assert.equal(CALL_CREATE_PATH, '/call-create');
  assert.ok(SHELL_NATIVE_ROUTES.includes(CALL_CREATE_PATH));
  // 목록이 늘거나 줄면 이 줄이 먼저 깨진다 — 허용 목록은 눈으로 확인하고 고치는 값이다.
  assert.equal([...SHELL_NATIVE_ROUTES].join(','), '/asr-setup,/asr-run,/call-create,/asr-bench');
});

test('앱 밖으로 나가는 모양은 전부 버린다', () => {
  assert.equal(shellNavigateTarget('https://evil.com/asr-setup'), null);
  assert.equal(shellNavigateTarget('//evil.com/asr-setup'), null);
  assert.equal(shellNavigateTarget('/asr-setup/../../settings'), null);
  assert.equal(shellNavigateTarget('asr-setup'), null);
  // 접두사만 맞는 경로도 남이다. `startsWith` 로 때웠다면 여기서 통과해 버린다.
  assert.equal(shellNavigateTarget('/asr-setupX'), null);
  assert.equal(shellNavigateTarget('/asr-setup/extra'), null);
});

test('경로가 아닌 값은 던지지 않고 null 이다', () => {
  // 브리지로 들어오는 값이라 무엇이든 올 수 있다. 🔴 여기서 던지면 껍데기의 메시지 처리가 멈춘다.
  assert.equal(shellNavigateTarget(undefined), null);
  assert.equal(shellNavigateTarget(null), null);
  assert.equal(shellNavigateTarget(''), null);
  assert.equal(shellNavigateTarget(42), null);
  assert.equal(shellNavigateTarget({ path: '/asr-setup' }), null);
  // 아주 긴 문자열도 그냥 버린다.
  assert.equal(shellNavigateTarget('/asr-setup?' + 'a'.repeat(1000)), null);
});

test('받아쓰기 진행 화면은 통화 ID 를 함께 받는다', () => {
  assert.equal(flat(shellNavigateTarget('/asr-run?callId=call-1')), '/asr-run|call-1');
  assert.equal(flat(shellNavigateTarget('/asr-run?callId=' + 'a'.repeat(128))), '/asr-run|' + 'a'.repeat(128));
});

test('통화 ID 가 없거나 이상하면 진행 화면을 열지 않는다', () => {
  // 🔴 통화 ID 없이 열면 빈 진행 화면이 선다. 「경로는 맞다」로 통과시키지 않는다.
  assert.equal(shellNavigateTarget('/asr-run'), null);
  assert.equal(shellNavigateTarget('/asr-run?'), null);
  assert.equal(shellNavigateTarget('/asr-run?callId='), null);
  // 🔴 이 값은 곧 파일 이름이 된다(→ `lib/asr-local.ts`). `../` 가 섞이면 앱 저장소 밖이다.
  assert.equal(shellNavigateTarget('/asr-run?callId=../secret'), null);
  assert.equal(shellNavigateTarget('/asr-run?callId=%2e%2e%2fsecret'), null);
  assert.equal(shellNavigateTarget('/asr-run?callId=a b'), null);
  assert.equal(shellNavigateTarget('/asr-run?callId=' + 'a'.repeat(129)), null);
  // 아는 이름 하나만 받는다. 다른 파라미터를 끼워 넣지 못한다.
  assert.equal(shellNavigateTarget('/asr-run?id=call-1'), null);
  assert.equal(shellNavigateTarget('/asr-run?uri=file:///x&callId=call-1'), null);
  assert.equal(shellNavigateTarget('/asr-run?callId=call-1&uri=file:///x'), null);
});

test('파라미터를 받지 않는 화면에 붙은 쿼리·해시는 통째로 거절한다', () => {
  // 조용히 떼어 내면 보낸 쪽은 전달됐다고 믿는다.
  assert.equal(shellNavigateTarget('/asr-setup?callId=call-1'), null);
  assert.equal(shellNavigateTarget('/call-create?model=q8_0'), null);
  assert.equal(shellNavigateTarget('/asr-setup#x'), null);
  assert.equal(shellNavigateTarget('/asr-run?callId=call-1#x'), null);
});
