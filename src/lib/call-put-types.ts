/** 웹·네이티브 업로드 전송기가 같은 모양을 쓰도록 한 곳에 둔다(→ `call-put.web.ts`). */
import type { CallFile } from '@/types/calls';

export interface PutOptions {
  /** 올린 비율(0~1). **실제로 보낸 바이트에서만 나온다** — 지어낸 값을 넣지 않는다. */
  onProgress?: (fraction: number) => void;
  /** 사용자가 「취소」를 눌렀을 때 끊는 손잡이. 끊기면 `UPLOAD_CANCELED` 로 거절한다. */
  signal?: AbortSignal;
}

/**
 * 서명 URL 로 파일을 그대로 올린다(앱 → GCS 직접, 서버 미경유).
 *
 * 🔴 `headers` 는 서버가 준 것을 **글자 그대로** 실어야 한다. resumable 이 아니라 단순 PUT
 * 이므로 중간에 끊기면 처음부터 다시 올린다(객체 경로가 결정적이라 덮어쓰기는 안전하다).
 *
 * 실패는 **코드 문자열 하나**로만 거절한다(`UPLOAD_CANCELED` · `UPLOAD_NETWORK` ·
 * `HTTP_403` …). 저장소 응답 본문에는 서명 정보가 섞여 있어 그대로 내보내면 안 된다.
 */
export type PutCallAudio = (file: CallFile, url: string, headers: Record<string, string>, options?: PutOptions) => Promise<void>;
