import { ScrollViewStyleReset } from 'expo-router/html';
import type { ReactNode } from 'react';

import {
  BOOT_SPLASH_CSS,
  BOOT_SPLASH_FALLBACK_JS,
  BOOT_SPLASH_HTML,
} from '@/constants/boot-splash';

/**
 * 웹 정적 렌더링의 루트 HTML.
 *
 * 여기 넣은 태그는 **모든 페이지의 `<head>`** 에 들어간다. 이 앱은 웹이 주 무대이고
 * (네이티브는 인증 뒤 이 웹을 웹뷰로 여는 껍데기다) 그래서 이 파일이 실질적인 문서 셸이다.
 *
 * 🔴 **빌드 타임에 한 번만 렌더된다.** 훅이나 클라이언트 로직을 넣지 마라 — 넣어도 조용히
 * 아무 일도 하지 않는다. 이 파일이 내보낼 수 있는 동작은 인라인 `<script>` 문자열뿐이다.
 *
 * 색 값을 토큰에서 읽어 오지 않고 상수로 적어 둔 이유는 `constants/boot-splash.ts` 머리말과
 * 같다 — 여기서 만드는 것은 React 스타일이 아니라 문자열 CSS 다.
 */

/** 문서 기본 배경. `constants/theme.ts` 의 `colors.bg` 와 같아야 한다. */
const PAGE_BG = '#F5F2EC';

/**
 * Google Fonts CDN 한 줄.
 *
 * 패밀리 이름과 굵기는 `constants/theme.ts` 의 `fonts` 와 **1:1 이어야 한다.** 여기서 안 받는
 * 굵기를 테마가 가리키면 브라우저가 가까운 굵기를 합성해 버려서, 네이티브와 웹의 글자
 * 두께가 조용히 달라진다.
 *
 * `display=swap` 은 폰트가 늦어도 **글자를 먼저 보여 준다**는 뜻이다. 이게 없으면 최대
 * 3초간 글자가 통째로 안 보이는 구간이 생기는데, 부팅 스플래시를 두는 이유와 정확히 반대다.
 */
const FONT_HREF =
  'https://fonts.googleapis.com/css2' +
  '?family=Archivo:wght@400;700;800' +
  '&family=IBM+Plex+Mono:wght@500;600;700' +
  '&family=IBM+Plex+Sans+KR:wght@400;500;600;700' +
  '&display=swap';

/**
 * 문서 바탕색 고정.
 *
 * `<body>` 에 색을 주지 않으면 흰색이다. 스크롤을 끝까지 당겼을 때 나타나는 바운스 영역과,
 * React 트리가 아직 없는 구간이 전부 그 흰색으로 보인다 — 종이색 화면 옆에서 유독 튄다.
 * `#root` 까지 함께 칠하는 이유는 expo-router 가 앱을 그 안에 마운트하기 때문이다.
 */
const PAGE_CSS = `html,body,#root{background-color:${PAGE_BG}}
body{margin:0}`;

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/*
          `viewport-fit=cover` — 화면 끝까지 그리고 안전 영역은 `env(safe-area-inset-*)` 로
          받는다. 이 값이 없으면 그 CSS 변수가 **항상 0** 이라, `useSafeAreaInsets()` 를 쓰는
          화면들이 노치도 내비게이션 바도 없는 줄 알고 그린다.

          ⚠️ `maximum-scale=1` 은 **손가락 확대를 막는다 — 접근성 비용이 있는 선택이다.**
          형제 프로젝트는 같은 이유로 이것을 일부러 넣지 않았다(→ `birdieup-app/src/app/+html.tsx`).
          여기서 넣는 것은 이 앱의 화면이 웹뷰 안에서도 그대로 서기 때문이다: 웹뷰에는
          주소창도 「배율 초기화」도 없어서 한번 확대된 채 굳으면 사용자가 되돌릴 방법이 없다.

          🔴 그래도 **1차 방어선은 이게 아니다.** 입력 포커스 확대는 `inputFontSize()` 로 글자
          크기를 16px 이상 보장해 애초에 일어나지 않게 막는다(→ `constants/theme.ts`).
          이 줄은 그 그물을 빠져나간 경우를 위한 것이지, 그 함수를 안 써도 되는 이유가 아니다.
        */}
        <meta
          name="viewport"
          content={
            'width=device-width, initial-scale=1, maximum-scale=1, ' +
            'shrink-to-fit=no, viewport-fit=cover'
          }
        />
        <meta name="theme-color" content={PAGE_BG} />

        {/*
          폰트를 **JS 번들과 동시에** 받게 하려는 preconnect 다.

          CDN 은 두 도메인을 쓴다: CSS 를 주는 `fonts.googleapis.com` 과 실제 woff2 가 있는
          `fonts.gstatic.com`. 뒤쪽은 CSS 를 받아 읽은 **뒤에야** 존재를 알게 되므로, 미리
          열어 두지 않으면 DNS → TCP → TLS 를 그 시점에 처음부터 밟는다.

          `crossOrigin` 을 붙이는 것은 폰트가 익명 CORS 요청으로 나가기 때문이다. 이 값이
          실제 요청과 다르면 브라우저가 **연결을 재사용하지 않아** 미리 연 것이 헛수고가 된다.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} />

        {/*
          부팅 스플래시 스타일. 폰트·리셋보다 **먼저** 둬서 첫 페인트에 이미 적용돼 있게 한다.
          외부 파일로 빼지 않는 이유는 이 화면이 존재하는 이유와 같다 — 요청을 하나라도
          기다리면 그동안 다시 하얀 화면이다.
        */}
        <style id="jayeon-boot-splash-css" dangerouslySetInnerHTML={{ __html: BOOT_SPLASH_CSS }} />
        <style id="jayeon-page-css" dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />

        {/* 루트 <ScrollView> 가 네이티브와 같게 동작하도록 하는 스타일 리셋. */}
        <ScrollViewStyleReset />
      </head>
      <body>
        {/*
          번들이 도착·실행되고 세션 복구가 끝날 때까지 덮어 두는 스플래시.

          React 트리 **밖**이라야 한다 — 트리 안에 두면 번들이 실행된 뒤에야 그려지는데,
          정작 가리고 싶은 공백이 그 이전이다. 내리는 것은 `lib/boot-splash.web.ts` 다.

          `display:contents` — 마크업을 넣으려면 React 에 컨테이너가 필요한데 그 컨테이너가
          레이아웃에 끼면 안 된다. 스플래시를 지운 뒤에도 빈 채로 남는 껍데기다.
        */}
        <div
          style={{ display: 'contents' }}
          dangerouslySetInnerHTML={{ __html: BOOT_SPLASH_HTML }}
        />
        {/*
          스플래시가 **스스로** 걷히는 폴백(8초). 번들이 실패하거나 오래된 브라우저에서
          터지면 걷어 줄 주체가 없어 영원한 로딩 화면이 된다(→ `constants/boot-splash.ts`).

          번들이 아니라 인라인 스크립트인 것이 요점이다 — 번들에 넣으면 정작 필요한 상황에
          돌지 않는다.
        */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SPLASH_FALLBACK_JS }} />
        {children}
      </body>
    </html>
  );
}
