/**
 * 서비스 워커 — **설치 요건을 채우는 최소한이자, 캐시를 최대한 쓰지 않는 워커다.**
 *
 * 홈 화면에 설치되려면 크롬은 manifest 와 함께 **fetch 핸들러를 가진 SW** 를 요구한다.
 * 그 요건 하나를 채우는 것이 이 파일의 유일한 목적이고, 그 밖에는 되도록 아무것도 하지 않는다.
 *
 * 🔴 **여기서 캐시를 늘리면 「배포했는데 내 화면만 옛날」이 된다.** 이 앱의 화면은 서버 상태
 * (발송 이력·수신자·템플릿)를 그대로 비추므로 낡은 화면은 단순히 보기 나쁜 것이 아니라
 * **없는 캠페인에 문자를 보내려 드는 상태**다. 그래서 규칙이 둘뿐이다.
 *
 * 1. **내비게이션(HTML)은 network-first.** 네트워크가 답하면 그 응답을 그대로 넘긴다.
 *    캐시는 네트워크가 실패했을 때만 꺼낸다.
 * 2. **나머지 요청은 손대지 않는다.** `respondWith` 를 부르지 않으면 브라우저가 평소대로
 *    가져간다 — 해시가 박힌 `/_expo/static/*` 는 이미 HTTP 캐시가 1년 들고 있고(→
 *    `deploy/nginx.conf`), API 요청은 캐시에 닿아선 안 된다. SW 가 낄 이유가 없다.
 *
 * 갱신은 `skipWaiting()` + `clients.claim()` 이다. 새 SW 가 기다리지 않고 바로 자리를
 * 넘겨받으므로, 앱을 껐다 켜지 않아도 **다음 이동부터** 새 규칙(그리고 network-first 로 받은
 * 새 HTML)이 적용된다. 여기서 페이지를 강제로 새로고침하지는 않는다 — 문자 작성 중에
 * 새로고침이 걸리면 쓰던 내용이 사라진다. 어차피 HTML 은 매번 네트워크에서 받으므로
 * 강제 새로고침 없이도 낡은 화면이 남지 않는다.
 */

/** 캐시 이름에 판 번호를 박아 둔다. 올리면 `activate` 에서 옛 캐시가 통째로 지워진다. */
const CACHE = 'nature-offline-v1';

/** 오프라인 폴백으로 들고 있을 문서 한 장. 키는 하나뿐이다. */
const FALLBACK_KEY = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `cache: 'reload'` — 폴백만큼은 HTTP 캐시를 건너뛰고 서버에서 새로 받는다.
      await cache.add(new Request(FALLBACK_KEY, { cache: 'reload' }));
    })().catch((error) => {
      // 🔴 폴백을 못 받아도 설치는 성공해야 한다. 여기서 던지면 SW 가 아예 안 서고,
      // 그러면 오프라인 폴백이 아니라 **설치 가능 여부**가 통째로 날아간다.
      console.warn('[sw] 오프라인 폴백을 받지 못했다', error);
    }),
  );
  // 기다리는 판 없이 바로 새 워커로 간다. 갱신이 늦게 반영되는 쪽이 더 위험하다.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      // 이미 열려 있는 탭까지 이 워커가 맡는다. 없으면 다음 실행까지 옛 워커가 남는다.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  /*
   * 내비게이션(주소창 이동·새로고침·설치된 앱 실행)만 본다.
   *
   * 나머지를 그냥 두는 것이 이 워커의 핵심이다. 여기서 `respondWith` 를 부르는 순간 그
   * 요청의 캐시 수명을 우리가 책임지게 되는데, 번들도 API 도 그럴 이유가 없다.
   */
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        /*
         * 받아 온 최신 문서를 폴백으로 갈아 끼운다. 라우트마다 HTML 이 따로 나오지만
         * (expo-router 정적 출력) 어느 장이든 앱을 부팅시키고 나면 주소를 보고 화면을
         * 정하므로, 마지막으로 성공한 한 장을 들고 있으면 충분하다.
         */
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          event.waitUntil(
            caches
              .open(CACHE)
              .then((cache) => cache.put(FALLBACK_KEY, copy))
              .catch(() => {}),
          );
        }
        return response;
      } catch (error) {
        // 네트워크가 죽었을 때만 여기 온다.
        const cached = await caches.match(FALLBACK_KEY, { cacheName: CACHE });
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
