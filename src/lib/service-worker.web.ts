/**
 * 서비스 워커 등록 — **웹 구현.**
 *
 * 홈 화면 설치(PWA)를 위해 `public/sw.js` 를 등록한다. 워커가 무엇을 하고 왜 그것만 하는지는
 * 그 파일 머리말에 적어 뒀다.
 *
 * 🔴 **등록하면 안 되는 자리가 둘 있다.**
 *
 * 1. **네이티브 껍데기의 웹뷰 안.** 껍데기는 이 웹을 그대로 열고(→ `components/web-shell.tsx`)
 *    그 웹뷰는 앱 전용 저장소를 쓴다. 거기에 워커가 한 번 자리 잡으면 **앱에서만 옛 화면이
 *    남는** 고장이 되는데, 사용자는 브라우저에서 같은 주소를 열어 정상인 것을 보고 「앱이
 *    이상하다」고만 말하게 된다. 재현도 추적도 가장 어려운 종류다. 껍데기 판정은 반드시
 *    `native-bridge` 에서 가져온다 — 여기서 `window.__NATURE_NATIVE__` 를 다시 적으면
 *    구형 껍데기가 쓰는 예전 키를 놓쳐 조용히 등록되어 버린다.
 * 2. **개발 서버.** dev 번들은 해시가 없고 매 저장마다 바뀐다. 워커가 문서 응답에 한 겹
 *    끼면 「고쳤는데 안 바뀐다」를 개발 중에 매번 의심하게 된다. 설치 가능 여부는 운영
 *    배포본에서만 의미가 있으므로 dev 에서는 아예 등록하지 않는다.
 *
 * 껍데기 안에서는 등록을 건너뛰는 데서 그치지 않고 **이미 있는 등록을 지운다.** 웹에서
 * 먼저 열어 워커를 심은 사용자가 같은 저장소를 쓰는 환경으로 들어오거나, 예전 빌드가
 * 껍데기 안에서 등록해 둔 경우를 되돌릴 길이 여기 말고는 없다.
 */

import { isNativeShell } from '@/lib/native-bridge';

/** `public/sw.js` → dist 루트로 복사된다. 스코프는 루트여야 앱 전체를 맡는다. */
const SW_URL = '/sw.js';

async function unregisterAll(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch (error) {
    console.warn('[service-worker] 기존 등록을 지우지 못했다', error);
  }
}

export function registerServiceWorker(): void {
  // 정적 프리렌더(Node)에는 `window` 도 `navigator` 도 없다.
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  if (isNativeShell()) {
    void unregisterAll();
    return;
  }
  if (__DEV__) return;

  /*
   * 첫 페인트와 경쟁시키지 않는다. 등록은 몇 초 늦어도 아무 손해가 없지만, 부팅 순간의
   * 네트워크·메인 스레드를 나눠 쓰면 스플래시가 걷히는 시점이 그만큼 밀린다.
   */
  const start = () => {
    navigator.serviceWorker.register(SW_URL, { scope: '/' }).catch((error) => {
      // 등록 실패는 화면을 막지 않는다 — 설치만 안 될 뿐이다. 다만 단서는 남긴다.
      console.warn('[service-worker] 등록하지 못했다', error);
    });
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
