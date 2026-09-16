/**
 * 웹 부팅 스플래시.
 *
 * 네이티브에는 `expo-splash-screen` 이 그려 주는 진짜 스플래시가 있지만 **웹에는 없다** —
 * HTML 이 도착하고 번들을 받아 실행할 때까지, 그리고 그 뒤 세션 복구(`bootstrap`)가 서버
 * 응답을 기다리는 동안 화면이 통째로 하얗다. 서버가 오랜만의 첫 접속에 깨어나는 경우에는
 * 그 공백이 더 길어진다. 이 앱은 **웹이 주 무대**라(네이티브는 껍데기일 뿐이다) 그 공백을
 * 그냥 두면 대부분의 사용자가 그 하얀 화면을 본다.
 *
 * 그래서 마크업과 스타일을 **`<head>`·`<body>` 에 인라인으로** 심는다. 첫 페인트부터 배경과
 * 심벌이 보이고, 번들은 그 위에서 조용히 뜬다. 외부 파일을 물면 그 요청이 끝날 때까지 다시
 * 하얀 화면이라 의미가 없다 — 그래서 심벌도 인라인 SVG 다.
 *
 * 이 상수들은 `app/+html.tsx`(빌드 타임에 한 번 렌더)와 `lib/boot-splash.web.ts`(런타임에
 * 제거)가 함께 쓴다. 두 쪽이 **같은 id 를 봐야** 하므로 이름을 여기 한 곳에 둔다.
 *
 * 🔴 **색은 `constants/theme.ts` 의 값을 손으로 옮겨 적은 것이다.** 이 파일이 내보내는 것은
 * React 스타일이 아니라 문자열 CSS 라(React 트리가 생기기 전에 쓰인다) 토큰을 읽어 올 수
 * 없다. 테마의 `ink`·`accentSoft` 를 바꾸면 여기도 함께 바꿔라.
 */

/** 스플래시 껍데기의 DOM id. 제거하는 쪽도 이 값을 본다. */
export const BOOT_SPLASH_ID = 'jayeon-boot-splash';

/** 사라지는 중임을 나타내는 클래스. 붙이면 페이드아웃이 시작된다. */
export const BOOT_SPLASH_HIDDEN_CLASS = 'is-hidden';

/** 페이드아웃 길이(ms). 아래 CSS transition 과 반드시 같아야 한다. */
export const BOOT_SPLASH_FADE_MS = 260;

/**
 * 스스로 걷히는 시간(ms).
 *
 * 🔴 **자바스크립트가 한 줄도 돌지 않아도 이 판은 반드시 사라져야 한다.** 번들이 실패하거나
 * 오래된 브라우저에서 터지면 `hideBootSplash()` 를 부를 주체가 없고, 그러면 사용자가 보는
 * 것은 **영원한 로딩 화면**이다 — 그 뒤에 아무것도 없다는 사실조차 알 수 없다. 오류 화면이든
 * 빈 화면이든, 무언가 잘못됐다는 것이 보이는 쪽이 낫다.
 *
 * 8초는 느린 회선에서 첫 화면이 뜨기에 충분하되 사람이 「고장 났다」고 판단하기 전인 값이다.
 */
export const BOOT_SPLASH_TIMEOUT_MS = 8000;

/** 스플래시 배경. 테마의 `ink`. */
const SPLASH_BG = '#1E3A2F';

/** 심벌·점의 색. 테마의 `accentSoft`(세이지). 잉크 위에서 또렷하게 읽힌다. */
const SPLASH_FG = '#A8C09A';

/**
 * 심벌 SVG — 새싹.
 *
 * 왜 파일을 안 물고 여기 적어 두는가: 번들러를 거쳐야 URL 이 생기는데, **번들이 실행되기
 * 전에** 보여야 하는 그림이라 그 경로를 쓸 수 없다.
 *
 * 글자를 넣지 않는 이유는 폰트 때문이다 — 이 화면은 웹폰트가 도착하기 전에 떠야 해서
 * 브랜드 서체를 쓸 수 없고, 기기 기본 서체로 적은 한 줄은 그림과 따로 논다.
 * 그림과 점 세 개만으로 「살아 있다」를 말한다.
 *
 * 임시 팔레트와 함께 갈아 끼울 자리다(→ `constants/theme.ts` 머리말).
 */
const SYMBOL_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" aria-hidden="true">` +
  `<circle cx="60" cy="60" r="56" fill="${SPLASH_FG}" fill-opacity="0.12"/>` +
  `<path d="M60 102V58" stroke="${SPLASH_FG}" stroke-width="6" stroke-linecap="round"/>` +
  `<path d="M60 68C44 68 30 56 26 38c20-2 34 12 34 30z" fill="${SPLASH_FG}"/>` +
  `<path d="M60 54C60 36 74 22 94 20c4 18-10 32-34 34z" fill="${SPLASH_FG}" fill-opacity="0.55"/>` +
  `</svg>`;

/**
 * 스플래시 스타일.
 *
 * `prefers-reduced-motion` 에서는 점의 맥박을 끈다 — 움직임이 불편한 사람에게 부팅 화면은
 * 피할 방법이 없는 자리다.
 */
export const BOOT_SPLASH_CSS = `
#${BOOT_SPLASH_ID}{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;
align-items:center;justify-content:center;gap:28px;background:${SPLASH_BG};
opacity:1;transition:opacity ${BOOT_SPLASH_FADE_MS}ms ease-out}
#${BOOT_SPLASH_ID}.${BOOT_SPLASH_HIDDEN_CLASS}{opacity:0;pointer-events:none}
#${BOOT_SPLASH_ID} svg{width:120px;height:120px;display:block}
#${BOOT_SPLASH_ID} .bs-dots{display:flex;gap:7px}
#${BOOT_SPLASH_ID} .bs-dots i{width:7px;height:7px;border-radius:50%;background:${SPLASH_FG};
opacity:.25;animation:bs-pulse 1.05s ease-in-out infinite}
#${BOOT_SPLASH_ID} .bs-dots i:nth-child(2){animation-delay:.15s}
#${BOOT_SPLASH_ID} .bs-dots i:nth-child(3){animation-delay:.3s}
@keyframes bs-pulse{0%,80%,100%{opacity:.25}40%{opacity:1}}
@media (prefers-reduced-motion:reduce){#${BOOT_SPLASH_ID} .bs-dots i{animation:none;opacity:.6}}
`;

/** 스플래시 마크업. `+html.tsx` 가 `<body>` 첫 자식으로 심는다. */
export const BOOT_SPLASH_HTML =
  `<div id="${BOOT_SPLASH_ID}" role="status" aria-label="자연을 준비하는 중">` +
  `${SYMBOL_SVG}<div class="bs-dots"><i></i><i></i><i></i></div></div>`;

/**
 * 스플래시를 스스로 걷어내는 인라인 스크립트(→ `BOOT_SPLASH_TIMEOUT_MS`).
 *
 * `hideBootSplash()` 와 같은 절차를 밟는다 — 클래스를 붙여 페이드시키고 그 뒤에 지운다.
 * 둘 다 「이미 없으면 아무 일도 하지 않는다」라서 어느 쪽이 먼저 걷어도 안전하다.
 *
 * 문자열로 두는 이유도 같다. 이 코드는 번들에 들어가면 **정작 필요한 상황(번들이 실패한
 * 상황)에 돌지 않는다.**
 */
export const BOOT_SPLASH_FALLBACK_JS =
  `(function(){try{setTimeout(function(){` +
  `var el=document.getElementById(${JSON.stringify(BOOT_SPLASH_ID)});` +
  `if(!el)return;el.classList.add(${JSON.stringify(BOOT_SPLASH_HIDDEN_CLASS)});` +
  `setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);},` +
  `${BOOT_SPLASH_FADE_MS});` +
  `},${BOOT_SPLASH_TIMEOUT_MS});}catch(e){}})();`;
