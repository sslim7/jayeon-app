/**
 * 폰에서 받아쓴 원문을 서버로 — **`POST /calls/{id}/transcript` 한 걸음.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이 한 번이 28분치 받아쓰기의 값을 정한다.** 여기서 실패하면 폰이 7분 동안 한 일이  │
 * │ 통째로 버려지고, 서버는 6시간 뒤 통화를 `CLIENT_TRANSCRIPT_TIMEOUT` 으로 정리한다.    │
 * │ 그래서 이 파일은 **다시 보내도 안전한지**를 아는 것이 전부다: 서버가 같은 요청을        │
 * │ 두 번 받아도 두 번째도 200 이므로, 응답을 못 받았으면 **그냥 다시 보낸다.**            │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **6시간이 지난 뒤에도 보낸다.** 서버는 늦게 도착한 전사문도 받아 준다 — 타임아웃을
 * 봤다고 앱이 포기하면 이미 받아쓴 것을 스스로 버리는 셈이다(→ `lib/call-errors.ts` 의
 * `CLIENT_TRANSCRIPT_TIMEOUT` 이 영구 실패가 아닌 이유).
 *
 * 화면이 아니라 여기에 두는 이유는 **판단을 테스트할 수 있게** 하기 위해서다. 화면은 이
 * 함수의 결과(성공 / 다시 보낼 수 있는 실패 / 끝난 실패)만 그린다.
 */
import { ApiError, ApiTimeoutError } from '@/lib/api';
import { callApi } from '@/lib/call-api';
import { failureCode, httpCode, permanentFailure } from '@/lib/call-errors';
import type { CallRecord, CallTranscript, TranscriptSegment } from '@/types/calls';

/**
 * 폰이 만든 구간 하나. 시각은 **파일 처음부터 잰 ms** 다(→ `lib/asr-local-types.ts`).
 *
 * ⚠️ 타입을 `asr-local-types` 에서 가져오지 않고 여기 모양으로만 적는다. 이 파일은 웹에서도
 * 불리는데, 받아쓰기 엔진 쪽을 끌어오면 웹 번들에 엔진이 통째로 딸려 온다.
 */
export type SentSegment = { startMs: number; endMs: number; text: string };

/** 서버가 저장하는 구간의 최대 개수. 넘으면 서버가 조용히 잘라 낸다 — 우리가 먼저 센다. */
export const TRANSCRIPT_MAX_SEGMENTS = 20_000;

/**
 * 폰 구간을 **서버가 받는 모양**으로 옮긴다.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **`speaker` 를 넣지 않는다.** 폰 whisper 에는 화자 정보가 아예 없다. 「0」이나 빈    │
 * │ 문자열이라도 넣는 순간 통화 원문 화면이 **한 사람이 264번 말한 대화**로 그려지고, 그것 │
 * │ 은 화면이 스스로 지어낸 사실이 된다(→ `components/call-transcript.tsx` 의 `split`).  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ 서버 스키마(`CallTranscript`)의 시각 단위는 **초**다. 폰 쪽은 ms 라 여기서 나눈다 —
 * 단위를 섞으면 28분 통화의 구간이 전부 첫 2초 안에 몰린다.
 */
function sentSegments(segments: readonly SentSegment[]): TranscriptSegment[] {
  const found: TranscriptSegment[] = [];
  for (const segment of segments) {
    if (found.length >= TRANSCRIPT_MAX_SEGMENTS) break;
    const text = segment.text.trim();
    // 서버 스키마가 빈 글의 구간을 거절한다. 하나 때문에 28분치를 되돌려받을 이유가 없다.
    if (!text) continue;
    if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs)) continue;
    const start = Math.max(0, segment.startMs) / 1000;
    found.push({ start, end: Math.max(start, segment.endMs / 1000), text });
  }
  return found;
}

/**
 * 서버가 받는 전사문의 최대 크기. **6 MiB.**
 *
 * 🔴 **보내기 전에 우리가 먼저 잰다.** 28분치 한국어 원문은 넉넉히 들어가지만, 넘는 것을
 * 그대로 보내면 6 MiB 를 올린 끝에 413 을 받는다 — 느린 회선에서는 그 자체가 몇 분이다.
 */
export const TRANSCRIPT_MAX_BYTES = 6 * 1024 * 1024;

/**
 * UTF-8 로 몇 바이트인가.
 *
 * ⚠️ `TextEncoder` 를 쓰지 않는다. 한도 판정이 런타임에 그것이 있는지에 달려 있으면
 * 없는 환경에서 조용히 판정이 빠지고, 그 결과는 「보낸 뒤에 413」이다.
 *
 * 서로게이트 쌍(이모지 등)은 둘이 합쳐 4바이트다. 짝이 없는 반쪽은 우리가 만든 적이 없는
 * 입력이라 3바이트로 세고 넘어간다 — 한도 근처에서 몇 바이트 어긋나는 것보다 판정 자체가
 * 없는 쪽이 나쁘다.
 */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index += 1; }
      else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * 전사문 전송 실패 하나.
 *
 * `CallUploadError` 와 같은 모양을 쓰되 따로 두는 이유는 **다음에 할 일이 다르기 때문**이다.
 * 업로드 실패는 「다시 등록」이고, 이쪽은 **이미 받아쓴 글을 들고 있는 상태의 「다시 보내기」**다.
 */
export class TranscriptSendError extends Error {
  constructor(public readonly code: string, public readonly permanent: boolean) {
    super(code);
    this.name = 'TranscriptSendError';
  }
}

/** 서버가 「이미 끝났다」고 답한 경우. 실패로 그리면 안 되는 유일한 4xx 다. */
export const ALREADY_DONE = 'CALL_ALREADY_COMPLETED';

/** 서버·전송 실패를 코드 하나로. 🔴 본문 문구는 버린다(요청 내용이 되비칠 수 있다). */
function asSendError(error: unknown): TranscriptSendError {
  if (error instanceof TranscriptSendError) return error;
  // 응답을 못 받았을 뿐 서버는 받았을 수도 있다. **다시 보내도 안전하다**(멱등).
  if (error instanceof ApiTimeoutError) return new TranscriptSendError('UPLOAD_NETWORK', false);
  if (error instanceof ApiError) {
    const given = error.code;
    const code = given && given !== 'VALIDATION_FAILED' && given !== 'INTERNAL_ERROR' ? given : httpCode(error.status);
    return new TranscriptSendError(code, permanentFailure(code) || permanentFailure(httpCode(error.status)));
  }
  const code = failureCode(error);
  return new TranscriptSendError(code, permanentFailure(code));
}

/** 바깥에 기대는 것. 테스트가 서버 없이 이 판단들을 확인할 수 있어야 한다. */
export type TranscriptSendDeps = {
  send: (callId: string, body: CallTranscript) => Promise<CallRecord>;
};

/**
 * 받아쓴 글 한 덩어리를 보낸다.
 *
 * 🔴 **`segments` 는 빠뜨리면 안 되는 값이다.** 통화 원문 화면은 구간을 그리지 글 전체를
 * 그리지 않는다 — 구간 없이 보낸 통화는 서버에 9,722자가 멀쩡히 들어가 있는데도 화면이
 * 「저장된 통화 원문이 없습니다」로 비어 보였다. 그 화면에는 안전망을 뒀지만(→
 * `components/call-transcript.tsx`), 안전망은 한 문단짜리 벽이라 정상이 아니다.
 *
 * ⚠️ 그래도 **구간이 비어 있을 수 있다.** 구간을 모으기 전에 시작한 받아쓰기를 이어받은
 * 경우인데, 그때 없는 시각을 지어내지 않는다(→ `lib/asr-local-types.ts` 의 `segments`).
 *
 * 🔴 **보내기 전에 두 가지를 우리가 먼저 거른다.** 빈 글과 6 MiB 초과다. 둘 다 서버가
 * 거절할 것이 확실한데, 그 답을 받으려고 몇 분을 올릴 이유가 없다.
 */
export async function sendCallTranscript(
  callId: string,
  text: string,
  segments: readonly SentSegment[] = [],
  deps: TranscriptSendDeps = { send: callApi.transcript },
): Promise<CallRecord> {
  const trimmed = text.trim();
  if (!trimmed) throw new TranscriptSendError('CALL_EMPTY_TRANSCRIPT', true);
  const body: CallTranscript = { text: trimmed, segments: sentSegments(segments) };
  /*
    본문 전체(JSON)가 아니라 **글자들만** 잰다. 시각·따옴표 같은 나머지는 구간 하나당 수십
    바이트라 한도를 가르지 못한다. ⚠️ 다만 구간이 붙으면서 같은 글이 본문에 **두 번** 들어가게
    됐으므로, 구간 쪽 글자도 함께 세지 않으면 한도 판정이 실제 크기의 절반만 보게 된다.
  */
  const bytes = body.segments.reduce((sum, segment) => sum + utf8Bytes(segment.text), utf8Bytes(trimmed));
  if (bytes > TRANSCRIPT_MAX_BYTES) throw new TranscriptSendError('CALL_TOO_LARGE', true);
  try {
    return await deps.send(callId, body);
  } catch (error) {
    throw asSendError(error);
  }
}

/**
 * 통화 원문 화면이 **무엇을 그릴 수 있나.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **판정을 화면 밖에 둔 이유는 검사할 수 있어야 하기 때문이다.** 화면 안에 `if` 로     │
 * │ 있었을 때 「구간은 없고 글만 있는 통화」가 통째로 빈 화면이 됐고, 그 통화는 이미 서버에  │
 * │ 저장돼 있어 코드를 고치기 전에는 영영 볼 수 없었다.                                │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
export type TranscriptView =
  /** 구간이 있다. 시각과 함께 대화로 그린다 — **이것이 정상이다.** */
  | { kind: 'talk'; segments: TranscriptSegment[] }
  /**
   * 구간은 없고 글만 있다.
   *
   * ⚠️ **읽기 나쁜 모양인 것을 알고 넣은 안전망이다.** 9,722자가 문단 하나로 쏟아진다 —
   * 시각도 없고 말이 넘어가는 자리도 없다. 그래도 **보이는 편이 낫다**: 이 상태로 저장된
   * 통화가 실제로 있고, 안 그리면 그 통화는 영영 못 읽는다. 새 받아쓰기는 구간을 채워
   * 보내므로 이 길로 오지 않는다(→ 위 `sendCallTranscript`).
   */
  | { kind: 'plain'; text: string }
  /** 아무것도 없다. 빈 화면 대신 없다고 말해야 한다. */
  | { kind: 'none' };

export function transcriptView(transcript: CallTranscript | null | undefined): TranscriptView {
  const segments = transcript?.segments ?? [];
  if (segments.length) return { kind: 'talk', segments };
  const text = transcript?.text?.trim() ?? '';
  return text ? { kind: 'plain', text } : { kind: 'none' };
}
