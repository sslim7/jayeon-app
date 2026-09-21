/**
 * **나가는 길 하나** — 껍데기가 열어 준 네이티브 화면이 쓰는 「닫기/뒤로」.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **껍데기 모드에서는 이 화면들에 나갈 길이 없었다.** 앱 헤더가 통째로 걷혀 제목도       │
 * │ 뒤로도 없는 화면이 열렸고, 사용자는 **앱을 강제 종료해야** 벗어날 수 있었다.            │
 * │ 그 길을 화면마다 따로 적으면 또 한 화면이 빠진다 — 그래서 한 곳에 둔다.                │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 규칙은 둘뿐이다:
 * ① **돌아갈 기록이 있으면 뒤로 간다.** 껍데기의 웹뷰를 `replace` 로 다시 세우면 페이지가
 *    처음부터 로드되어 사용자가 보던 목록·검색어·스크롤이 전부 사라진다.
 * ② 기록이 없으면(주소로 바로 열었거나 스택이 비었을 때) **껍데기에서는 웹뷰로**, 껍데기가
 *    아니면 화면이 정해 준 제자리로 간다(→ `lib/shell-routes.ts` 의 `shellExitPath`).
 */
import { router, type Href } from 'expo-router';
import { useCallback } from 'react';

import { ENV } from '@/config/env';
import { shellExitPath } from '@/lib/shell-routes';

export function useShellExit(fallback: Href): () => void {
  return useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    /*
     * ⚠️ `push` 가 아니라 `replace` 다. 나가는 길에 화면을 쌓으면 뒤로 가기가 방금 닫은
     * 화면으로 되돌아와, 사용자는 「닫았는데 다시 열린다」를 겪는다.
     */
    router.replace(shellExitPath(ENV.webShell, fallback));
  }, [fallback]);
}
