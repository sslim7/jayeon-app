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
const { SHELL_NATIVE_ROUTES, CALL_CREATE_PATH, isShellNativeRoute, shellExitPath, shellNavigateTarget } = mod.exports;

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

/*
 * 🔴 **껍데기가 열 수 있는 경로는 `/shell` 되돌림에서도 반드시 면제돼야 한다.**
 *
 * 둘이 어긋나면 화면은 열렸다가 **곧바로 웹뷰로 되돌려진다.** 사용자가 보는 것은
 * 「스플래시가 잠깐 뜨고 문자 보내기가 나온다」뿐이라, 원인이 이동이 아니라 되돌림이라는
 * 사실이 화면에 전혀 드러나지 않는다. 실기기에서 `/asr-setup` 이 정확히 이렇게 당했다 —
 * 허용 목록에는 있는데 면제 목록에 없었고, 타입도 다른 테스트도 그것을 잡지 못했다.
 *
 * 이 검사는 `_layout.tsx` 의 **소스를 직접 읽는다.** 되돌림은 효과(effect) 안에서 일어나
 * 순수 함수로 뺄 수 없고, 목록이 두 파일에 나뉘어 있는 한 서로를 보는 방법은 이것뿐이다.
 */
const nodePath = require('node:path');
test('껍데기가 여는 경로는 전부 /shell 되돌림에서 면제된다', () => {
  const layout = fs.readFileSync(nodePath.join(__dirname, '..', 'src', 'app', '_layout.tsx'), 'utf8');
  const exempt = new Set(
    Array.from(layout.matchAll(/pathname === '(\/[a-z-]+)'/g), (m) => m[1]),
  );
  const missing = SHELL_NATIVE_ROUTES.filter((route) => !exempt.has(route));
  // ⚠️ `deepStrictEqual` 은 쓰지 않는다 — 이 파일의 모듈은 vm 안에서 돌아 배열 프로토타입이
  // 달라서 「모양은 같은데 같지 않다」로 떨어진다. 길이로 본다.
  assert.equal(
    missing.length, 0,
    `면제가 빠진 경로: ${missing.join(', ')} — 이 화면들은 열리자마자 웹뷰로 튕긴다`,
  );
});

/*
 * 🔴 **껍데기가 연 화면에는 「나갈 길」이 있어야 한다.**
 *
 * 껍데기 모드에서는 로그인 뒤 모든 화면이 웹뷰라 앱 헤더를 통째로 걷었는데, 그 바람에 이
 * 목록의 화면들은 **제목도 닫기도 없이** 열렸다. 스택에 앞 화면이 없을 수 있어 뒤로 밀어도
 * 아무 일이 없고, 실기기에서 사용자는 **앱을 강제 종료해야** 벗어날 수 있었다.
 *
 * ⚠️ 이 검사도 소스를 직접 읽는다. 머리를 세우는 일은 라우터·컨텍스트가 얽힌 렌더 시점의
 * 일이라 순수 함수로 뺄 수 없고, `node --test` 는 RN 컴포넌트를 그릴 수 없다. 대신 **목록이
 * 늘면 자동으로 새 화면까지 검사**한다 — 화면을 더하는 사람이 이 파일을 고칠 필요는 없다.
 */
const nodeFs = require('node:fs');

/** 라우트 파일과 그것이 부르는 같은 저장소의 화면 컴포넌트를 한 덩이로 읽는다. */
const screenSource = (route) => {
  const routeFile = nodePath.join(__dirname, '..', 'src', 'app', `${route.slice(1)}.tsx`);
  assert.ok(nodeFs.existsSync(routeFile), `${route}: 라우트 파일이 없다 (${routeFile})`);
  const text = nodeFs.readFileSync(routeFile, 'utf8');
  const parts = [text];
  // 라우트가 얇은 껍질인 화면(`/asr-run` 등)은 머리도 알맹이 쪽에 있다 — 거기까지 본다.
  for (const [, name] of text.matchAll(/from '@\/components\/([a-z0-9-]+)'/g)) {
    const child = nodePath.join(__dirname, '..', 'src', 'components', `${name}.tsx`);
    if (nodeFs.existsSync(child)) parts.push(nodeFs.readFileSync(child, 'utf8'));
  }
  return parts.join('\n');
};

test('껍데기가 여는 화면에는 전부 나갈 길이 있다', () => {
  for (const route of SHELL_NATIVE_ROUTES) {
    const source = screenSource(route);
    // 🔴 `router.back()` 만으로는 부족하다 — 껍데기가 바로 연 화면에는 돌아갈 기록이 없어
    // 아무 일도 일어나지 않는다. 그 갈래는 `useShellExit` 하나에만 적혀 있다.
    assert.ok(
      source.includes('useShellExit('),
      `${route}: 나가는 길이 없다 — 껍데기에서 열리면 앱을 강제 종료해야 벗어난다`,
    );
    // 그리고 그 길이 **화면에 보여야** 한다. 머리의 「닫기」가 그 자리다.
    assert.ok(
      source.includes('useScreenHeader('),
      `${route}: 머리를 올리지 않는다 — 제목도 닫기도 없는 화면이 된다`,
    );
  }
});

test('껍데기 모드에서도 이 화면들에는 앱 헤더가 선다', () => {
  const layout = nodeFs.readFileSync(nodePath.join(__dirname, '..', 'src', 'app', '_layout.tsx'), 'utf8');
  // 🔴 허용 목록을 그대로 읽어야 화면이 늘어도 따라온다. 경로를 손으로 또 적으면 언젠가
  // 한쪽만 늘고, 빠진 화면은 「나갈 길 없는 화면」으로 돌아온다.
  assert.ok(
    /enabled=\{[^}]*isShellNativeRoute\(pathname\)/.test(layout),
    '앱 헤더가 껍데기 모드에서 이 경로들을 빼고 있다',
  );
  // ⚠️ ☰ 서랍은 껍데기에서 뜻이 없다(목적지가 전부 웹뷰 안이다). 왼쪽 ☰ 대신 오른쪽 「닫기」다.
  assert.ok(layout.includes('drawer={!ENV.webShell}'), '껍데기 모드에서 서랍이 꺼져 있지 않다');
});

test('스택이 비었을 때 껍데기는 웹뷰로, 아니면 제자리로 돌아간다', () => {
  // 🔴 껍데기에서 열린 화면은 사용자가 웹뷰에서 왔다 — `/settings` 로 보내면 빈 화면이거나
  // `/shell` 되돌림에 한 번 더 튕긴다.
  assert.equal(shellExitPath(true, '/settings'), '/shell');
  assert.equal(shellExitPath(true, '/calls'), '/shell');
  // 껍데기가 아니면 그 화면들이 진짜 네이티브라 그대로 맞다(아이폰 검증 빌드).
  assert.equal(shellExitPath(false, '/settings'), '/settings');
  assert.equal(shellExitPath(false, '/calls'), '/calls');
});

test('허용 목록 판정은 목록에 있는 경로만 참이다', () => {
  for (const route of SHELL_NATIVE_ROUTES) assert.equal(isShellNativeRoute(route), true);
  assert.equal(isShellNativeRoute('/settings'), false);
  assert.equal(isShellNativeRoute('/shell'), false);
  assert.equal(isShellNativeRoute('/asr-setupX'), false);
  assert.equal(isShellNativeRoute(''), false);
});
