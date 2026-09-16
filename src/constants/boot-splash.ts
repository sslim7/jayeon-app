/** 웹 HTML 부팅 화면. React 실행 전에도 제공된 Nature 사진을 표시한다. */
export const BOOT_SPLASH_ID = 'nature-boot-splash';
export const BOOT_SPLASH_HIDDEN_CLASS = 'is-hidden';
export const BOOT_SPLASH_FADE_MS = 260;
export const BOOT_SPLASH_TIMEOUT_MS = 8000;

// React 트리 전의 문자열 CSS이므로 theme의 종이·초록 색을 함께 맞춘다.
export const BOOT_SPLASH_CSS = `
#${BOOT_SPLASH_ID}{position:fixed;inset:0;z-index:2147483000;display:flex;
align-items:center;justify-content:center;background:#F5F2EC;
opacity:1;transition:opacity ${BOOT_SPLASH_FADE_MS}ms ease-out}
#${BOOT_SPLASH_ID}.${BOOT_SPLASH_HIDDEN_CLASS}{opacity:0;pointer-events:none}
#${BOOT_SPLASH_ID} img{width:100%;height:100%;display:block;object-fit:contain}
#${BOOT_SPLASH_ID} .bs-dots{position:absolute;bottom:24px;display:flex;gap:7px;padding:12px;border-radius:14px;background:#F5F2EC}
#${BOOT_SPLASH_ID} .bs-dots i{width:7px;height:7px;border-radius:50%;background:#467656;
opacity:.25;animation:nature-bs-pulse 1.05s ease-in-out infinite}
#${BOOT_SPLASH_ID} .bs-dots i:nth-child(2){animation-delay:.15s}
#${BOOT_SPLASH_ID} .bs-dots i:nth-child(3){animation-delay:.3s}
@keyframes nature-bs-pulse{0%,80%,100%{opacity:.25}40%{opacity:1}}
@media (prefers-reduced-motion:reduce){#${BOOT_SPLASH_ID} .bs-dots i{animation:none;opacity:.6}}
`;
export const BOOT_SPLASH_HTML =
  `<div id="${BOOT_SPLASH_ID}" role="status" aria-label="Nature를 준비하는 중">` +
  `<img src="/splash.png" alt="" fetchpriority="high" decoding="sync"/>` +
  `<div class="bs-dots"><i></i><i></i><i></i></div></div>`;

// 번들·인증 로딩이 실패해도 사용자가 영구 로딩 화면에 갇히지 않는다.
export const BOOT_SPLASH_FALLBACK_JS =
  `(function(){try{setTimeout(function(){` +
  `var el=document.getElementById(${JSON.stringify(BOOT_SPLASH_ID)});` +
  `if(!el)return;el.classList.add(${JSON.stringify(BOOT_SPLASH_HIDDEN_CLASS)});` +
  `setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);},` +
  `${BOOT_SPLASH_FADE_MS});` +
  `},${BOOT_SPLASH_TIMEOUT_MS});}catch(e){}})();`;
