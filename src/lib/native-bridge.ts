/**
 * 네이티브 껍데기와 주고받는 통로 — **네이티브 스텁이다.**
 *
 * # 왜 파일이 둘인가 (`.ts` / `.web.ts`)
 *
 * 이 앱은 **대부분 웹으로 동작하고 일부만 안드로이드 네이티브로 구현한다.** 네이티브 앱은
 * 인증까지만 제가 그리고 그 뒤 화면은 `react-native-webview` 가 `ENV.webUrl` 을 연다.
 * 즉 **같은 소스가 껍데기 밖(네이티브 앱)과 껍데기 안(웹뷰 속 웹)에서 동시에 돈다.**
 *
 * 그런데 그 둘이 이 통로에서 하는 일은 정반대다. 껍데기 안의 웹은 껍데기에게 말을 걸어야
 * 하고, 껍데기 자신은 말을 걸 상대가 없다(자기에게 토큰을 되돌려 줄 이유가 없다).
 * 번들러가 확장자로 갈라 주므로 **호출부는 언제나 `@/lib/native-bridge` 로만 들어와야
 * 한다** — 경로에 `.web` 을 직접 적으면 네이티브 빌드에 웹 구현이 섞인다.
 *
 * 그래서 이 파일은 전부 무해한 no-op 이다. 이 스텁 덕분에 `auth-tokens` 나 루트 레이아웃이
 * 플랫폼 분기를 따로 두지 않아도 양쪽에서 같은 코드로 돈다.
 *
 * 껍데기 **쪽**의 배관(웹뷰에 토큰을 주입하고 메시지를 받는 일)은 이 파일이 아니라
 * `@/components/web-shell.tsx` 가 들고 있다.
 */

import type { StoredTokens } from '@/lib/auth-tokens';

/** 껍데기가 웹에 보내는 이동 요청. 지금 필요한 것은 목적지 경로 하나뿐이다. */
export type NavigateRequest = { path: string };

/** 껍데기 밖이다 — 늘 false. */
export function isNativeShell(): boolean {
  return false;
}

/** 껍데기 밖이다 — 알려 줄 껍데기 버전이 없다. */
export function nativeShellVersion(): string | null {
  return null;
}

export function postTokensToNative(_tokens: StoredTokens | null, _reason?: 'password-changed'): void {
  // 껍데기 밖이다 — 토큰은 이미 이 앱의 SecureStore 에 있다.
}

export function postReadyToNative(): void {
  // 껍데기 밖이다 — 내릴 로딩 덮개가 없다.
}

export function setNativeNavigationHandler(
  _handler: ((req: NavigateRequest) => void) | null,
): void {
  // 껍데기 밖이다 — 화면 이동은 이 앱의 라우터가 직접 한다.
}
