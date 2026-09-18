/**
 * 네이티브 껍데기와 주고받는 통로 — **웹 구현.**
 *
 * 이 파일이 도는 곳은 두 군데다: 보통의 브라우저, 그리고 **네이티브 껍데기의 웹뷰 안.**
 * 말을 걸 상대가 있는 것은 뒤쪽뿐이고, 앞쪽에서는 한 줄도 하는 일이 없어야 한다.
 *
 * 플랫폼이 갈리는 규칙과 그 이유는 짝인 `native-bridge.ts` 머리말에 적어 뒀다.
 *
 * 껍데기는 페이지 로드 **전에** `window.__NATURE_NATIVE__` 와 저장해 둔 토큰을 주입하고,
 * 웹 → 껍데기 통로로 `window.ReactNativeWebView.postMessage(string)` 을 놓아 둔다
 * (→ `@/components/web-shell.tsx`).
 *
 * 🔴 **모든 진입점을 `typeof window === 'undefined'` 로 지킨다.** 웹 출력은 정적으로
 * 프리렌더되는데 Node 에는 `window` 가 없다. 모듈 최상단에서 만지면 빌드가 그 자리에서 깨진다.
 */

import type { StoredTokens } from '@/lib/auth-tokens';

/**
 * `StoredTokens` 는 **반드시 `import type`** 이어야 한다. `auth-tokens` 는 토큰이 바뀔 때마다
 * 이 파일의 `postTokensToNative` 를 부르므로, 값으로 가져오면 진짜 순환 import 가 된다.
 * 타입은 런타임에 지워지므로 실제로 도는 방향은 auth-tokens → native-bridge 하나뿐이다.
 */

/** 껍데기가 웹에 보내는 이동 요청. 네이티브 스텁과 모양이 같아야 한다. */
export type NavigateRequest = { path: string };

type NativeWebView = { postMessage(data: string): void };
type NativeShellInfo = { platform: string; appVersion: string };

declare global {
  interface Window {
    ReactNativeWebView?: NativeWebView;
    __NATURE_NATIVE__?: NativeShellInfo;
    __NATURE_NATIVE_BRIDGE__?: { receive(raw: string): void };
    // 구형 네이티브 껍데기도 같은 웹을 열 수 있으므로 이전 수신구를 함께 유지한다.
    __JAYEON_NATIVE__?: NativeShellInfo;
    __JAYEON_NATIVE_BRIDGE__?: { receive(raw: string): void };
  }
}

/**
 * 웹 → 껍데기로 보내는 말. **껍데기의 메시지 핸들러와 1:1 이다.**
 *
 * 종류를 둘로 좁혀 둔 것은 의도다. 웹은 배포로 즉시 새것이 되지만 껍데기는 스토어를 거치므로
 * **「옛 껍데기가 새 웹을 연다」가 정상적으로 존재하는 조합**이고, 그 껍데기는 모르는 `type`
 * 을 로그 한 줄 남기고 버린다 — 새 메시지에 기능을 걸면 그 기능이 옛 껍데기에서 **조용히
 * 아무 일도 하지 않는 상태**가 된다. 종류를 늘려야 할 때는 껍데기가 자기 능력을 스스로 밝히는
 * 장치부터 세워라(형제 프로젝트의 `nativeShellSupports` →
 * `birdieup-app/src/lib/native-bridge.web.ts`).
 */
type OutboundMessage =
  | { type: 'tokens'; tokens: StoredTokens | null; reason?: 'password-changed' }
  | { type: 'ready' }
  // 🔧 **측정이 끝나면 이 줄과 openNativeScreen 을 함께 지운다**(→ `components/asr-bench.tsx`).
  // 받아쓰기는 네이티브 모듈이라 웹뷰 안에서 돌지 않는데, 사용자가 보는 메뉴는 웹이 그린다.
  // 그래서 웹 메뉴가 껍데기에게 「네이티브 화면을 열어라」고 말하는 통로가 필요하다.
  //
  // ⚠️ 위 머리말의 경고가 그대로 적용된다 — **옛 껍데기는 이 말을 모르고 조용히 버린다.**
  // 지금은 껍데기를 함께 새로 설치해 쓰는 측정용이라 그 상태를 감수한다. 실사용 기능을
  // 이 통로에 걸지 마라.
  | { type: 'navigate'; path: string };

// ──────────────────────────────────────────────────────────────
// 웹 → 껍데기
// ──────────────────────────────────────────────────────────────

/**
 * 껍데기에 한마디 보낸다. 껍데기 밖이면 **조용히 아무 일도 하지 않는다** — 브라우저에서
 * 도는 것이 정상이고 실패가 아니다.
 *
 * `postMessage` 가 던질 수 있다고 보고 감싼다(웹뷰가 이미 파기된 뒤에 불릴 수 있다).
 * 브리지가 깨졌다고 화면까지 멈추면 안 된다 — 다만 **조용히 삼키지는 않는다.** 껍데기가
 * 토큰을 못 받아도 화면은 멀쩡히 돌고, 그 결과는 한참 뒤 로그인이 풀리는 것으로만 나타난다
 * (→ `auth-tokens.ts` 의 `saveTokens`). 그때 원인을 찾을 단서가 이 로그 한 줄뿐이다.
 */
function post(message: OutboundMessage): void {
  if (typeof window === 'undefined') return;
  const shell = window.ReactNativeWebView;
  if (!shell) return;
  try {
    shell.postMessage(JSON.stringify(message));
  } catch (error) {
    console.warn('[native-bridge] 껍데기에 전하지 못했다', message.type, error);
  }
}

/**
 * 이 페이지가 네이티브 껍데기 웹뷰 안에서 돌고 있는가.
 *
 * 판정 근거는 껍데기가 **페이지 로드 전에** 주입하는 `__NATURE_NATIVE__` 다. 첫 렌더부터
 * 참이어야 하기 때문이다 — 이 값을 보고 숨는 화면 요소가 생기면, 뒤늦게 참이 되는 판정은
 * 껍데기 안에서 그 요소가 한 번 번쩍이고 사라지는 것으로 나타난다.
 *
 * 정적 프리렌더(`window` 없음)에서는 false. 그 HTML 은 브라우저용이기도 하므로 껍데기용으로
 * 미리 굳혀 두면 안 된다.
 */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window.__NATURE_NATIVE__ ?? window.__JAYEON_NATIVE__);
}

/** 껍데기 앱 버전. 껍데기 밖이면 null. */
export function nativeShellVersion(): string | null {
  if (typeof window === 'undefined') return null;
  return (window.__NATURE_NATIVE__ ?? window.__JAYEON_NATIVE__)?.appVersion ?? null;
}

/**
 * 토큰이 바뀌었음을 껍데기에 알린다. `null` 은 「지워졌다」.
 *
 * 왜 알려야 하는지는 `auth-tokens.ts` 의 `saveTokens` 주석에 적어 뒀다 — 요약하면,
 * 갱신이 웹뷰 안에서 일어나므로 알리지 않으면 껍데기의 사본이 로그인 시점에 멈춰 서고,
 * 리프레시 토큰의 **수명이 갱신되지 않아** 어느 날 이유 없이 로그인이 풀린다.
 */
export function postTokensToNative(tokens: StoredTokens | null, reason?: 'password-changed'): void {
  post({ type: 'tokens', tokens, reason });
}

/** 첫 화면을 보여도 된다고 알린다. 껍데기가 덮고 있던 로딩 판을 내린다. */
/**
 * 껍데기에게 네이티브 화면을 열어 달라고 한다. 브라우저에서는 아무 일도 하지 않는다.
 *
 * 🔧 측정용이다(위 `navigate` 주석). 끝나면 지운다.
 */
export function openNativeScreen(path: string): void {
  post({ type: 'navigate', path });
}

export function postReadyToNative(): void {
  post({ type: 'ready' });
}

// ──────────────────────────────────────────────────────────────
// 껍데기 → 웹
// ──────────────────────────────────────────────────────────────

let handler: ((req: NavigateRequest) => void) | null = null;

/**
 * 아직 받을 사람이 없어 쌓아 둔 이동 요청.
 *
 * 껍데기는 이동 요청을 **웹 앱이 마운트되기 전에** 던질 수 있다 — 링크나 알림으로 앱이
 * 켜지는 경로에서는 웹뷰가 뜨자마자 목적지를 말해 주는 것이 자연스러운데, 그때 웹은 아직
 * 번들을 평가하는 중이다. 그래서 수신구는 모듈 로드 시점에 즉시 세우고, 핸들러가 붙는 순간
 * 쌓인 것을 순서대로 흘려보낸다. 이 큐가 없으면 그렇게 연 첫 실행만 이동이 통째로 사라진다.
 */
const pending: NavigateRequest[] = [];

/**
 * 핸들러 호출을 감싼다. 라우팅이 던져도 큐는 계속 흘러야 하고, 무엇보다 이 예외가 껍데기의
 * `receive` 호출부(네이티브의 `injectJavaScript`)까지 거슬러 올라가면 안 된다.
 */
function invoke(target: (req: NavigateRequest) => void, req: NavigateRequest): void {
  try {
    target(req);
  } catch (error) {
    console.warn('[native-bridge] 이동 처리 중 오류', req.path, error);
  }
}

function deliver(req: NavigateRequest): void {
  if (!handler) {
    pending.push(req);
    return;
  }
  invoke(handler, req);
}

/**
 * 껍데기가 부르는 수신구. 받는 모양은 `{ type: 'navigate', path: '/...' }` 다.
 *
 * 경로는 **반드시 `/` 로 시작하는 앱 내부 경로**여야 한다. 여기 들어오는 값은 껍데기가
 * 바깥에서 받은 주소일 수 있어서, 넓게 받아 주면 이 창(로그인 토큰이 심긴 창)을 남이 정한
 * 곳으로 보내는 길이 된다. 애매하면 통과시키지 않는다.
 *
 * 모르는 모양은 버리되 **반드시 남긴다** — 조용히 삼키면 「링크를 눌렀는데 홈만 뜬다」를
 * 쫓을 단서가 한 줄도 없다.
 */
function receive(raw: string): void {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    console.warn('[native-bridge] 알 수 없는 메시지(JSON 아님)');
    return;
  }
  if (!message || typeof message !== 'object') {
    console.warn('[native-bridge] 알 수 없는 메시지 모양');
    return;
  }
  const { type, path } = message as { type?: unknown; path?: unknown };
  if (type !== 'navigate') {
    console.warn('[native-bridge] 알 수 없는 메시지 종류');
    return;
  }
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    // `//evil.com` 은 브라우저가 프로토콜 상대 주소로 읽는다 — 경로처럼 보이지만 바깥이다.
    console.warn('[native-bridge] 앱 내부 경로가 아니라 버린다');
    return;
  }
  deliver({ path });
}

/**
 * **수신구는 모듈 로드 시점에 즉시 세운다.** 핸들러 등록(= 루트 레이아웃 마운트)을 기다리면
 * 그 사이에 온 요청을 놓친다. 받을 사람이 없는 동안은 위 큐가 대신 들고 있는다.
 */
if (typeof window !== 'undefined') {
  window.__NATURE_NATIVE_BRIDGE__ = { receive };
  window.__JAYEON_NATIVE_BRIDGE__ = window.__NATURE_NATIVE_BRIDGE__;
}

/**
 * 껍데기가 보낸 이동 요청을 받을 주체를 등록한다. 루트 레이아웃이 걸고 언마운트에서 `null`
 * 로 푼다. `null` 이면 다시 큐잉 모드로 돌아간다 — 화면이 갈리는 찰나에 온 요청을 버리지
 * 않기 위해서다.
 */
export function setNativeNavigationHandler(next: ((req: NavigateRequest) => void) | null): void {
  handler = next;
  if (!next) return;
  /*
   * 쌓인 것을 순서대로 흘려보낸다. 매번 `handler` 를 다시 보는 이유는 이동 중에 핸들러가
   * 풀릴 수 있어서다(첫 요청이 화면을 바꾸면 레이아웃이 언마운트될 수 있다). 그때 남은
   * 것은 다음 등록까지 큐에 그대로 남는다.
   */
  while (handler) {
    const req = pending.shift();
    if (!req) break;
    invoke(handler, req);
  }
}
