import { WebShell } from '@/components/web-shell';

/**
 * 껍데기 모드의 유일한 화면.
 *
 * 인증이 끝나면 루트 레이아웃이 이 경로로 보내고(→ `app/_layout.tsx`), 그 뒤의 모든 화면은
 * 이 안의 웹뷰가 `ENV.webUrl` 을 열어 그린다. 그래서 이 파일에는 레이아웃도 헤더도 없다 —
 * **여기에 화면을 덧붙이고 싶어진다면 그건 웹에 있어야 할 화면이다.**
 *
 * 🔴 **웹에서는 이 화면이 서지 않는다.** 웹은 껍데기 안이 아니라 껍데기가 여는 대상 그
 * 자체다(`ENV.webShell` 이 웹에서 false 다). 웹 빌드에서는 `WebShell` 이 스텁이라 `null` 이고,
 * 루트 레이아웃도 이 경로로 보내지 않는다.
 */
export default function ShellScreen() {
  return <WebShell />;
}
