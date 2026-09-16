import {
  BOOT_SPLASH_FADE_MS,
  BOOT_SPLASH_HIDDEN_CLASS,
  BOOT_SPLASH_ID,
} from '@/constants/boot-splash';

/**
 * 웹 부팅 스플래시를 걷어낸다.
 *
 * `+html.tsx` 가 심어 둔 `<div>` 는 React 트리 **밖**에 있다 — 번들이 실행되기 전부터
 * 화면에 있어야 하므로 그럴 수밖에 없다. 그래서 내리는 것도 DOM 을 직접 만진다.
 *
 * 페이드가 끝난 뒤에 지운다. 그냥 지우면 잉크 배경에서 종이 배경으로 한 프레임 만에 튀어
 * 깜빡임으로 보인다. 두 번 불려도 안전하다 — 이미 없거나 이미 사라지는 중이면 조용히
 * 돌아간다(스스로 걷히는 폴백과 겹칠 수 있다 → `constants/boot-splash.ts`).
 */
export function hideBootSplash(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(BOOT_SPLASH_ID);
  if (!el || el.classList.contains(BOOT_SPLASH_HIDDEN_CLASS)) return;
  el.classList.add(BOOT_SPLASH_HIDDEN_CLASS);
  window.setTimeout(() => el.remove(), BOOT_SPLASH_FADE_MS);
}
