/**
 * 녹음 업로드 전송 — **네이티브.**
 *
 * 실제 화면은 껍데기의 웹뷰 안에서 돌고, 그 안에서는 `call-put.web.ts` 가 파일을 직접 올린다
 * (→ `components/web-shell.tsx`). 이 파일은 **네이티브로 직접 연 화면**(개발 빌드, 앞으로의
 * 네이티브 화면)이 쓰는 길이다.
 *
 * 🔴 **브리지로 바이트를 나르지 않는다.** 껍데기 메시지는 64KB 에서 끊기고, 28MB 를 base64
 * 로 실으면 그 전에 메모리가 먼저 무너진다. `expo-file-system` 의 업로드 태스크가 파일을
 * 디스크에서 그대로 스트리밍하고 보낸 바이트를 알려 준다 — 진행률과 취소가 둘 다 여기서 나온다.
 */
import * as FS from 'expo-file-system/legacy';
import { httpCode } from './call-errors';
import type { PutCallAudio } from './call-put-types';

export const putCallAudio: PutCallAudio = async (file, url, headers, options = {}) => {
  if (file.source.kind !== 'native') throw new Error('UNKNOWN');
  if (options.signal?.aborted) throw new Error('UPLOAD_CANCELED');
  let canceled = false;
  const task = FS.createUploadTask(url, file.source.uri, {
    httpMethod: 'PUT',
    // 🔴 multipart 가 아니라 **원본 바이트 그대로**다. 서명은 이 바디를 전제로 만들어졌다.
    uploadType: FS.FileSystemUploadType.BINARY_CONTENT,
    headers,
  }, (progress) => {
    const total = progress.totalBytesExpectedToSend;
    if (!total || total <= 0) return;
    options.onProgress?.(Math.max(0, Math.min(1, progress.totalBytesSent / total)));
  });
  const cancel = () => { canceled = true; void task.cancelAsync().catch(() => {}); };
  options.signal?.addEventListener('abort', cancel);
  try {
    const result = await task.uploadAsync();
    if (canceled) throw new Error('UPLOAD_CANCELED');
    // 취소했을 때도 null 이 온다. 위에서 걸러지지 않았으면 연결이 끊긴 것이다.
    if (!result) throw new Error('UPLOAD_NETWORK');
    // 저장소 응답 본문에는 서명 정보가 들어 있다. 상태 코드만 남긴다.
    if (result.status < 200 || result.status >= 300) throw new Error(httpCode(result.status));
    options.onProgress?.(1);
  } catch (error) {
    if (canceled) throw new Error('UPLOAD_CANCELED');
    // 정해 둔 코드는 그대로 올린다. 네이티브 예외 문구에는 파일 경로가 섞여 있어 버린다.
    if (error instanceof Error && /^(UPLOAD_[A-Z]+|HTTP_\d{3})$/.test(error.message)) throw error;
    throw new Error('UPLOAD_NETWORK');
  } finally {
    options.signal?.removeEventListener('abort', cancel);
  }
};
