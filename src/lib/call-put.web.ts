/**
 * 녹음 업로드 전송 — **웹(브라우저와 네이티브 껍데기의 웹뷰).**
 *
 * # 왜 `fetch` 가 아니라 `XMLHttpRequest` 인가
 *
 * 필요한 것은 **업로드 진행률**인데, `fetch` 는 요청 바디가 얼마나 나갔는지 알려 주지 않는다
 * (`ReadableStream` 업로드는 HTTP/2 와 브라우저 지원이 갈린다). `xhr.upload.onprogress` 는
 * 오래된 웹뷰에서도 그대로 동작한다. 28MB 를 올리는 동안 아무 변화가 없으면 사용자는 앱이
 * 멈춘 줄 알고 화면을 떠난다 — 그 화면을 떠나면 업로드도 함께 사라진다.
 *
 * # 왜 base64 로 바꾸지 않는가
 *
 * `File` 을 그대로 `send()` 에 넘기면 브라우저가 디스크에서 스트리밍한다. base64 로 읽으면
 * 28MB 파일이 문자열로 38MB, 그것을 만드는 동안 원본까지 메모리에 함께 올라간다 — 폰 웹뷰가
 * 그 자리에서 죽는다.
 */
import { httpCode } from './call-errors';
import type { PutCallAudio } from './call-put-types';

export const putCallAudio: PutCallAudio = (file, url, headers, options = {}) =>
  new Promise<void>((resolve, reject) => {
    if (file.source.kind !== 'web') { reject(new Error('UNKNOWN')); return; }
    const body = file.source.file;
    if (options.signal?.aborted) { reject(new Error('UPLOAD_CANCELED')); return; }
    const xhr = new XMLHttpRequest();
    // 한 번만 정리한다. abort 는 onabort 와 onerror 를 함께 부르는 브라우저가 있다.
    let settled = false;
    const finish = (fn: () => void) => { if (settled) return; settled = true; options.signal?.removeEventListener('abort', cancel); fn(); };
    function cancel() { finish(() => { xhr.abort(); reject(new Error('UPLOAD_CANCELED')); }); }
    xhr.open('PUT', url, true);
    // 🔴 서명에 들어간 헤더를 글자 그대로 싣는다. Authorization 은 붙이지 않는다 — 서명 URL 은
    // 그 자체가 자격이고, 우리 토큰을 저장소로 보낼 이유가 없다.
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      options.onProgress?.(Math.max(0, Math.min(1, event.loaded / event.total)));
    };
    xhr.onload = () => finish(() => {
      if (xhr.status >= 200 && xhr.status < 300) { options.onProgress?.(1); resolve(); return; }
      // 저장소 응답 본문에는 서명 정보가 들어 있다. 상태 코드만 남긴다.
      reject(new Error(httpCode(xhr.status)));
    });
    xhr.onerror = () => finish(() => reject(new Error('UPLOAD_NETWORK')));
    xhr.ontimeout = () => finish(() => reject(new Error('UPLOAD_NETWORK')));
    xhr.onabort = () => finish(() => reject(new Error('UPLOAD_CANCELED')));
    options.signal?.addEventListener('abort', cancel);
    xhr.send(body);
  });
