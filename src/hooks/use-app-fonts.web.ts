import { useEffect, useState } from 'react';

/**
 * 폰트를 기다리는 상한.
 *
 * 🔴 **폰트 때문에 화면이 영원히 안 뜨는 쪽이 훨씬 나쁘다.** CDN 이 막혀 있거나(사내망·
 * 특정 지역) 회선이 죽으면 `document.fonts.ready` 는 끝내 풀리지 않는데, 그 동안 루트
 * 레이아웃은 `null` 을 그리고 부팅 스플래시가 화면을 덮고 있다 — 사용자가 보는 것은 **영원한
 * 로딩 화면**이다. 글꼴이 시스템 기본으로 떨어진 화면은 못생겼을 뿐 쓸 수 있다.
 *
 * `<link>` 로 건 CDN 폰트에는 `display=swap` 이 붙어 있어(→ `app/+html.tsx`), 늦게 도착한
 * 폰트는 알아서 갈아 끼워진다. 그래서 일찍 포기해도 잃는 것이 없다.
 */
const TIMEOUT_MS = 3000;

/**
 * 웹 폰트 준비 대기.
 *
 * 웹은 `useFonts` 를 쓰지 않는다. 폰트는 `+html.tsx` 가 `<head>` 에 걸어 둔 Google Fonts
 * CDN `<link>` 가 등록하고, 여기서는 그것이 도착했는지만 확인한다.
 *
 * `useFonts` 를 안 쓰는 이유는 `@expo-google-fonts` 의 TTF 를 import 하는 순간 웹 번들에
 * 수 MB 가 딸려 오기 때문이다(→ `use-app-fonts.ts`). 브라우저는 CDN 이 준 woff2 를
 * `unicode-range` 로 조각내 필요한 만큼만 받는다.
 *
 * @returns 화면을 그려도 되는지 여부. **실패·타임아웃도 `true` 다.**
 */
export function useAppFonts(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (!cancelled) setReady(true);
    };

    const timer = setTimeout(finish, TIMEOUT_MS);

    /*
     * 정적 렌더(빌드 타임)에는 `document` 가 없고, 아주 오래된 브라우저에는 `document.fonts`
     * 가 없다. 둘 다 기다릴 대상이 없다는 뜻이므로 그 자리에서 통과시킨다 — 여기서 멈추면
     * 그 환경에서는 앱이 아예 뜨지 않는다.
     */
    const fontSet = typeof document === 'undefined' ? null : document.fonts;
    if (!fontSet) {
      clearTimeout(timer);
      finish();
      return () => {
        cancelled = true;
      };
    }

    // 폰트 하나가 실패해도 `ready` 는 reject 될 수 있다 — 그때도 화면은 떠야 한다.
    void fontSet.ready
      .catch(() => undefined)
      .then(() => {
        clearTimeout(timer);
        finish();
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return ready;
}
