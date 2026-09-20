/**
 * 통화 등록 — **세 걸음짜리 흐름 하나.**
 *
 *   ① `POST /calls/{id}/audio/upload-url`  서명 주소를 받는다(통화 메타도 여기서 넘어간다)
 *   ② `PUT <서명 주소>`                     앱 → GCS 직접. **서버를 거치지 않는다**
 *   ③ `POST /calls/{id}/audio/complete`    객체를 확인하고 큐에 넣는다
 *
 * 세 걸음을 화면에서 각각 부르지 않고 여기 하나로 묶은 이유는 **중간에 멈춘 상태가 화면마다
 * 다르게 처리되는 것을 막기 위해서**다. ①까지만 된 통화는 서버에 아무 기록이 없고, ②까지만
 * 된 통화는 객체만 덩그러니 남는다 — 어느 쪽도 목록에 나타나지 않으므로, 실패했으면 그
 * 사실을 그 자리에서 말해야 한다.
 *
 * 🔴 **재시도는 같은 `call_id` 로 한다.** 객체 경로가 call_id 로 결정되므로 같은 ID 로 다시
 * 올리면 덮어쓰고, 새 ID 를 뽑으면 못 쓰는 객체가 버킷에 366일 남는다.
 */
import { randomUUID } from 'expo-crypto';
import { ApiError, ApiTimeoutError } from '@/lib/api';
import { callApi, type CallAsrMode, type CallUploadRequest } from '@/lib/call-api';
import { failureCode, httpCode, permanentFailure } from '@/lib/call-errors';
import { checkAudioSize } from '@/lib/call-file';
import { putCallAudio } from '@/lib/call-put';
import type { CallRecord, CallStartInput } from '@/types/calls';

/** 서버가 허용하는 수신자 ID 문자 집합. 다른 값은 400 으로 돌아온다. */
const RECIPIENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PHONE = /^\+?[0-9]{7,15}$/;
/** 기기 시계가 조금 빠른 것만으로 거절당하지 않도록 두는 여유. 서버 `maxClockSkew` 와 같은 값이다. */
export const CLOCK_SKEW_MS = 5 * 60_000;

/**
 * 실패 하나. **코드와 「다시 보낼 값어치가 있나」만 들고 다닌다** — 원본 문구에는 파일 경로나
 * 서명 정보가 섞일 수 있어 화면까지 흘리지 않는다(→ `lib/call-errors.ts`).
 */
export class CallUploadError extends Error {
  /**
   * 이번 시도가 쓴 통화 ID. **다시 시도할 때 그대로 넘겨야** 앞서 올라간 객체를 덮어쓴다 —
   * 새 ID 를 뽑으면 실패한 시도가 남긴 객체가 버킷에 보관 기간 내내 남는다.
   */
  callId = '';
  constructor(public readonly code: string, public readonly permanent: boolean) {
    super(code);
    this.name = 'CallUploadError';
  }
}

export interface CallUploadOptions {
  /** 올린 비율(0~1). 실제로 보낸 바이트에서만 나온다. */
  onProgress?: (fraction: number) => void;
  /** 「취소」 손잡이. 끊으면 `UPLOAD_CANCELED` 로 거절한다. */
  signal?: AbortSignal;
  /** 재시도할 때 **앞서 쓰던 ID 를 그대로** 넘긴다. 비우면 새로 만든다. */
  callId?: string;
  /**
   * 누가 받아쓸 것인가. 생략하면 **지금까지와 똑같이** 서버가 전부 한다.
   *
   * ┌────────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 **오디오는 어느 쪽이든 올라간다.** 이 값이 바꾸는 것은 받아쓰기를 누가 하느냐뿐이다 │
   * │ — 원본은 재생 기능 때문에 항상 GCS 에 있어야 한다. 「폰에서 받아쓰면 업로드를 건너뛴다」 │
   * │ 는 착각이 이 흐름에서 가장 비싼 실수다(녹음을 들을 수 없게 된다).                  │
   * └────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ `'client'` 로 보낸 통화는 **앱이 전사문을 보내 주기 전까지 끝나지 않는다.** 6시간이
   * 지나면 서버가 `CLIENT_TRANSCRIPT_TIMEOUT` 으로 정리한다(→ `lib/call-api.ts`).
   */
  asr?: CallAsrMode;
  /** 시험용 시계. 실제 호출부는 넘기지 않는다. */
  now?: () => number;
}

/** 등록 한 건의 결과. `record` 는 `complete` 가 돌려준 통화(= `status: PREPARING`)다. */
export interface CallUploadResult { callId: string; record: CallRecord }

/**
 * 보내기 전에 걸러낸다. **서버가 400 으로 거절할 값을 28MB 올린 뒤에 알게 되면 안 된다** —
 * 그때는 요금도 시간도 이미 나갔고, 사용자는 「왜 실패했는지」를 업로드가 끝난 뒤에야 듣는다.
 */
export function validateCallInput(input: CallStartInput, now: number): void {
  const contact = input?.contact;
  if (!contact || typeof contact.name !== 'string' || !contact.name.trim() || [...contact.name].length > 100 ||
    typeof contact.phone !== 'string' || !PHONE.test(contact.phone) ||
    (contact.recipient_id != null && (typeof contact.recipient_id !== 'string' || !RECIPIENT_ID.test(contact.recipient_id)))) throw new Error('INVALID_CONTACT');
  const recorded = Date.parse(input?.recorded_at ?? '');
  // 미래 시각을 현재 시각으로 고쳐 넣지 않고 이유를 밝혀 거절한다. 기기 시계 여유만 인정한다.
  if (!Number.isFinite(recorded) || recorded > now + CLOCK_SKEW_MS) throw new Error('INVALID_RECORDED_AT');
  if (!input.file || typeof input.file.name !== 'string' || !input.file.name.trim()) throw new Error('UNSUPPORTED_TYPE');
  checkAudioSize(input.file.size);
}

/** 서버·전송 실패를 코드 하나로 눌러 담는다. 본문 문구는 버린다. */
function asUploadError(error: unknown): CallUploadError {
  if (error instanceof CallUploadError) return error;
  if (error instanceof ApiTimeoutError) return new CallUploadError('UPLOAD_NETWORK', false);
  if (error instanceof ApiError) {
    // 서버가 준 기계 판독용 코드가 우리가 아는 것이면 그대로 쓴다(`CALL_AUDIO_MISSING` 등).
    const given = error.code;
    const code = given && given !== 'VALIDATION_FAILED' && given !== 'INTERNAL_ERROR' ? given : httpCode(error.status);
    return new CallUploadError(code, permanentFailure(code) || permanentFailure(httpCode(error.status)));
  }
  const code = failureCode(error);
  return new CallUploadError(code, permanentFailure(code));
}

/**
 * 파일 하나를 올리고 큐에 넣는다.
 *
 * 취소는 **업로드 중에만** 의미가 있다. `complete` 가 200 을 준 뒤에는 이미 서버가 일을
 * 시작했으므로 여기서 끊을 수 있는 것이 없다 — 그때는 취소 신호를 무시하고 결과를 돌려준다.
 */
export async function uploadCall(input: CallStartInput, options: CallUploadOptions = {}): Promise<CallUploadResult> {
  const now = options.now ?? Date.now;
  const callId = options.callId ?? randomUUID();
  try {
    validateCallInput(input, now());
    const file = input.file;
    const body: CallUploadRequest = {
      content_type: file.content_type,
      size: file.size,
      contact: input.contact.recipient_id
        ? { name: input.contact.name.trim(), phone: input.contact.phone, recipient_id: input.contact.recipient_id }
        : { name: input.contact.name.trim(), phone: input.contact.phone },
      call: {
        // 서버는 1024 bytes 를 넘는 파일명을 거부한다. 긴 이름은 여기서 자른다.
        file_name: file.name.slice(0, 200),
        // 🔴 길이는 **서버가 전사한 뒤 실제 값으로 덮어쓴다.** 앱이 재 본 적 없는 값을
        // 지어내 보내면 목록의 통화시간이 조용히 틀린 채로 남는다.
        duration: null,
        recorded_at: new Date(Date.parse(input.recorded_at)).toISOString(),
      },
    };
    let ticket;
    try {
      ticket = await callApi.uploadUrl(callId, body);
    } catch (error) {
      /*
       * 이미 큐에 들어간 통화다 — 앞선 시도에서 업로드까지는 끝났는데 `complete` 응답을 받지
       * 못한 경우다. 다시 올릴 수 없고 그럴 필요도 없다. 아래에서 `complete` 만 부르면
       * 서버가 지금 상태를 그대로 돌려준다.
       */
      if (error instanceof ApiError && error.code === 'CALL_ALREADY_QUEUED') {
        options.onProgress?.(1);
        return { callId, record: await callApi.complete(callId, options.asr) };
      }
      throw error;
    }
    if (options.signal?.aborted) throw new CallUploadError('UPLOAD_CANCELED', true);
    // 🔴 서버가 준 헤더를 글자 그대로 싣는다. Content-Type 이 서명에 들어간다.
    await putCallAudio(file, ticket.url, ticket.headers, { onProgress: options.onProgress, signal: options.signal });
    // 여기서부터는 취소해도 되돌릴 것이 없다. 큐잉까지 마치고 결과를 보여 주는 편이 정직하다.
    return { callId, record: await callApi.complete(callId, options.asr) };
  } catch (error) {
    const failure = asUploadError(error);
    failure.callId = callId;
    throw failure;
  }
}
