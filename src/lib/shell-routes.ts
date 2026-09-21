/**
 * 껍데기가 **웹의 말을 듣고 열어 주는 네이티브 화면** — 그 허용 목록과 경로 해석.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **웹이 준 경로를 그대로 라우터에 넘기지 않는다.** 웹뷰가 여는 페이지는 바깥 서버가    │
 * │ 주는 것이라, 임의 경로를 받으면 껍데기의 아무 화면이나 여는 통로가 된다. 그래서 열 수   │
 * │ 있는 것을 **여기 적힌 것만으로** 못 박는다 — 화면을 늘리려면 이 목록을 고쳐야 한다.     │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 판정을 화면이 아니라 이 파일에 두는 이유는 두 가지다. 첫째, `components/web-shell.tsx` 는
 * react-native-webview 를 끌고 들어와 `node --test` 로 확인할 수 없다 — 보안 판정이 테스트가
 * 닿지 않는 자리에 있으면 안 된다. 둘째, **껍데기는 이 목록을 웹에도 알려 준다**: 껍데기가
 * 자기가 열 수 있는 화면을 스스로 밝혀야, 옛 껍데기를 쓰는 사람에게 눌러도 아무 일이 없는
 * 입구가 서지 않는다(→ `lib/native-bridge.web.ts` 의 `nativeShellCanOpen`).
 */

/**
 * 웹이 열어 달라고 말할 수 있는 네이티브 화면 전부.
 *
 * ⚠️ `/asr-bench` 는 측정용 임시 화면이다(→ `components/asr-bench.tsx`). 측정이 끝나면 그
 * 화면과 함께 이 한 줄만 지운다 — 나머지는 제품 코드다.
 */
export const SHELL_NATIVE_ROUTES = ['/asr-setup', '/asr-run', '/call-create', '/asr-bench'] as const;

export type ShellNativeRoute = (typeof SHELL_NATIVE_ROUTES)[number];

/**
 * 네이티브 통화 등록 화면의 경로.
 *
 * 입구(웹 등록 시트)와 허용 목록이 **같은 글자**를 보게 둔다 — 한쪽만 바뀌면 입구는 그대로
 * 있는데 껍데기가 못 알아들어, 눌러도 아무 일이 없는 버튼이 된다.
 */
export const CALL_CREATE_PATH = '/call-create' as const;

/**
 * 통화 ID 로 쓸 수 있는 글자. 🔴 **`lib/asr-local.ts` 의 `CALL_ID` 와 같은 규칙이어야 한다** —
 * 이 값은 곧 그쪽에서 파일 이름이 되므로, 여기서 느슨하게 받으면 `../` 가 앱 저장소 밖을
 * 건드리는 길이 열린다.
 */
const CALL_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * 웹이 보낸 경로를 **껍데기가 실제로 열 값**으로 바꾼 결과. 못 읽으면 `null` 이다.
 *
 * 🔴 파라미터를 받는 화면을 타입으로 갈라 둔다. `/asr-run` 은 통화 ID 없이 열면 빈 화면이라,
 * 「경로는 맞는데 파라미터가 없다」를 통과시키면 사용자는 아무것도 없는 진행 화면을 본다.
 */
export type ShellNavTarget =
  | { path: '/asr-run'; params: { callId: string } }
  | { path: Exclude<ShellNativeRoute, '/asr-run'>; params?: undefined };

/**
 * 이 경로가 **껍데기가 열어 준 네이티브 화면**인가.
 *
 * 🔴 허용 목록을 읽는 자리가 하나 더 있다 — 껍데기 모드의 **앱 헤더**다(→ `app/_layout.tsx`).
 * 껍데기 모드에서는 로그인 뒤 모든 화면이 웹뷰라 앱 헤더를 통째로 걷는데, 그러면 여기 적힌
 * 화면들은 **제목도 나가는 버튼도 없이** 열려 사용자가 앱을 강제 종료해야 벗어난다.
 * 실기기에서 `/asr-setup` 이 정확히 그랬다. 그래서 목록을 화면 쪽에서도 볼 수 있게 내보낸다.
 */
export function isShellNativeRoute(path: string): path is ShellNativeRoute {
  return (SHELL_NATIVE_ROUTES as readonly string[]).includes(path);
}

/**
 * 스택에 앞 화면이 없을 때 **어디로 나가는가.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **껍데기에서 열린 화면은 웹뷰(`/shell`)로 돌아간다 — 사용자가 거기서 왔기 때문이다.** │
 * │ 껍데기 모드에서는 `/settings`·`/calls` 같은 화면이 웹뷰 안에 있어, 그 경로로 나가면    │
 * │ 네이티브 라우터가 **빈 화면**을 세우거나 `/shell` 되돌림에 한 번 더 튕긴다             │
 * │ (→ `app/_layout.tsx`). 껍데기가 아니면 그 화면들이 진짜 네이티브라 그대로 맞다.        │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **돌아갈 기록이 있으면 이 값을 쓰지 않는다.** 부르는 쪽이 `router.canGoBack()` 을 먼저
 * 본다(→ `hooks/use-shell-exit.ts`) — 웹뷰를 `replace` 로 다시 세우면 페이지가 처음부터
 * 로드되어 사용자가 보던 목록·검색어·스크롤이 전부 사라진다.
 */
export function shellExitPath<T>(webShell: boolean, fallback: T): T | '/shell' {
  return webShell ? '/shell' : fallback;
}

/**
 * 쿼리에서 통화 ID 를 읽는다. **모양이 정확히 `callId=<값>` 일 때만** 받는다.
 *
 * ⚠️ `URLSearchParams` 를 쓰지 않는다 — RN 의 것은 폴리필이고, 무엇보다 여기서 필요한 것은
 * 「무엇이든 관대하게 읽기」가 아니라 **아는 모양 하나만 받기**다. 값에 `%` 가 들어올 수 없어
 * (아래 글자 규칙) 디코딩도 하지 않는다: 디코딩을 넣는 순간 `%2e%2e` 같은 우회가 생긴다.
 */
function readCallId(query: string): string | null {
  const prefix = 'callId=';
  if (!query.startsWith(prefix)) return null;
  const value = query.slice(prefix.length);
  return CALL_ID.test(value) ? value : null;
}

/**
 * 웹이 보낸 경로를 해석한다. **허용 목록에 없거나 조금이라도 읽기 애매하면 `null` 이다.**
 *
 * 받는 모양은 둘뿐이다 — `/화면` 과 `/asr-run?callId=<통화 ID>`. 해시(`#`)가 붙은 값은
 * 통째로 버린다: 여기서 뜻이 없는데 받아 주면 「경로처럼 보이는 문자열」의 폭만 넓어진다.
 */
export function shellNavigateTarget(raw: unknown): ShellNavTarget | null {
  // 길이를 먼저 막는다. 뒤의 정규식이 아주 긴 문자열을 훑을 이유가 없다.
  if (typeof raw !== 'string' || !raw || raw.length > 512) return null;
  if (raw.includes('#')) return null;

  const mark = raw.indexOf('?');
  const path = mark < 0 ? raw : raw.slice(0, mark);
  const query = mark < 0 ? '' : raw.slice(mark + 1);
  if (!isShellNativeRoute(path)) return null;

  if (path === '/asr-run') {
    const callId = readCallId(query);
    return callId ? { path, params: { callId } } : null;
  }
  // 나머지 화면은 파라미터를 받지 않는다. 붙어 온 것은 **버리지 않고 통째로 거절한다** —
  // 조용히 떼어 내면 보낸 쪽은 전달됐다고 믿는다.
  return query ? null : { path, params: undefined };
}
