/**
 * 실패 이유를 사람이 읽을 수 있는 한 줄로 바꾼다.
 *
 * 🔴 **원본 오류 문구를 화면으로 내보내지 않는다.** 공급자 응답에는 요청 내용이 되비칠 수
 * 있고, 네이티브 예외에는 파일 경로가 섞인다. 그래서 여기서는 **미리 정한 코드만 통과**
 * 시키고, 모르는 것은 `UNKNOWN` 으로 눌러 버린다. 그 대신 **코드를 함께 보여 준다** —
 * 「분석에 실패했습니다」만 남으면 다음에도 추측밖에 할 수 없기 때문이다.
 *
 * 🔴 서버가 `error` 에 넣어 주는 것은 **문장이 아니라 코드**다(§`internal/calls/job.go` 의
 * `ErrorCode`). 공급자 코드(`Throttling.RateQuota`)가 그대로 올 수 있어 여기 없는 값도
 * 정상적으로 들어온다 — 그때는 이유를 모른다고 말하고 코드를 보여 준다.
 */

/** 화면에 보여도 안전한 코드와 그 이유. 여기 없는 값은 문구 없이 코드만 나간다. */
const REASONS: Record<string, string> = {
  // ── 서버 파이프라인이 남기는 코드 ──────────────────────────────
  EMPTY_TRANSCRIPT: '녹음에서 사람 말소리를 찾지 못했습니다.',
  CONTENT_FILTERED: 'AI 공급자가 이 녹음의 내용을 처리하지 않았습니다.',
  INPUT_UNAVAILABLE: '서버가 올라간 녹음 파일을 읽지 못했습니다. 다시 등록해 주세요.',
  PERMANENT: '다시 시도해도 같은 결과가 나오는 오류입니다.',
  RETRYABLE: '일시적인 오류로 멈췄습니다. 잠시 뒤 다시 시도해 주세요.',
  // ── 서버가 요청을 거절할 때 주는 코드 ──────────────────────────
  CALL_ALREADY_QUEUED: '이미 분석이 시작된 통화입니다.',
  CALL_AUDIO_MISSING: '녹음 파일 업로드가 끝나지 않았습니다.',
  CALL_NO_AUDIO: '업로드 주소를 먼저 받아야 합니다.',
  CALL_NOT_FOUND: '서버에서 이 통화를 찾지 못했습니다.',
  CALL_NOT_ANALYZABLE: '아직 다시 분석할 수 있는 상태가 아닙니다.',
  CALL_NO_TRANSCRIPT: '다시 분석할 통화 원문이 없습니다.',
  CALL_TOO_LARGE: '분석 데이터가 서버 저장 한도를 넘었습니다.',
  CALL_CONFLICT: '같은 ID의 다른 분석이 이미 저장되어 있습니다.',
  // ── 앱이 업로드 중에 만드는 코드 ───────────────────────────────
  UNSUPPORTED_TYPE: '지원하지 않는 형식의 녹음 파일입니다.',
  FILE_TOO_LARGE: '녹음 파일이 100MB를 넘습니다.',
  EMPTY_FILE: '녹음 파일이 비어 있습니다.',
  INVALID_CONTACT: '통화 상대 이름과 전화번호를 확인해 주세요.',
  INVALID_RECORDED_AT: '통화일시를 확인해 주세요.',
  UPLOAD_CANCELED: '업로드를 취소했습니다.',
  UPLOAD_NETWORK: '업로드 중 연결이 끊겼습니다.',
  STORAGE_REJECTED: '저장소가 업로드를 받지 않았습니다. 다시 시도해 주세요.',
  TLS_REQUIRED: '보안 연결이 아니어서 전송을 멈췄습니다.',
  UNKNOWN: '알 수 없는 오류입니다.',
};

/** 이 코드로 끝난 일은 다시 보내도 같은 답이 온다. 자동 재시도 대상에서 뺀다. */
const PERMANENT_CODES = new Set(['UNSUPPORTED_TYPE', 'FILE_TOO_LARGE', 'EMPTY_FILE', 'INVALID_CONTACT', 'INVALID_RECORDED_AT', 'CALL_TOO_LARGE', 'CALL_NOT_FOUND', 'CALL_ALREADY_QUEUED', 'PERMANENT', 'CONTENT_FILTERED', 'TLS_REQUIRED']);

/** 오류를 **정해진 코드로만** 바꾼다. 모르는 오류는 문구를 버리고 `UNKNOWN` 이다. */
export function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (REASONS[message] || /^HTTP_\d{3}$/.test(message)) return message;
  return 'UNKNOWN';
}

/** 서버 응답은 상태 코드만 남긴다. 본문에는 요청 내용이 되비칠 수 있다. */
export function httpCode(status: number): string {
  return Number.isFinite(status) ? `HTTP_${Math.trunc(status)}` : 'UNKNOWN';
}

export function failureReason(code: string): string {
  if (REASONS[code]) return REASONS[code];
  const http = /^HTTP_(\d{3})$/.exec(code);
  if (http) return Number(http[1]) < 500 ? '서버가 이 요청을 받지 않았습니다.' : '서버와 통신하지 못했습니다.';
  // 공급자 코드는 우리가 뜻을 모른다. 아는 척하지 않고 코드만 넘긴다(아래 failureText 가 붙인다).
  return REASONS.UNKNOWN;
}

/** 화면에 남길 한 줄. 코드를 붙여 다음 사람이 바로 짚을 수 있게 한다. */
export function failureText(base: string, code: string): string {
  return `${base} ${failureReason(code)} (코드: ${code})`;
}

/**
 * 한 번 더 보낼 값어치가 있나. **4xx 는 영구, 5xx·연결 실패는 재시도**가 기본이고
 * 401/403/408/429 는 세션·혼잡 문제라 재시도 쪽에 남긴다.
 */
export function permanentFailure(code: string): boolean {
  if (PERMANENT_CODES.has(code)) return true;
  const http = /^HTTP_(\d{3})$/.exec(code);
  if (!http) return false;
  const status = Number(http[1]);
  return status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
}

/**
 * 실패한 통화 한 건을 사람 말로.
 *
 * 멈춘 자리에 따라 **다음에 할 수 있는 일**이 다르다 — 전사까지 끝난 통화는 분석만 다시
 * 돌리면 되고(`reanalyze`), 전사가 실패한 통화는 다시 등록해야 한다.
 */
export function callFailureText(record: { status: string; error?: string | null }): string {
  const code = typeof record.error === 'string' && record.error.trim() ? record.error.trim() : 'UNKNOWN';
  if (record.status === 'TRANSCRIPTION_FAILED') return failureText('녹음을 받아쓰지 못했습니다.', code);
  if (record.status === 'ANALYSIS_FAILED') return failureText('받아쓰기는 끝났지만 내용을 정리하지 못했습니다.', code);
  return failureText('분석을 완료하지 못했습니다.', code);
}
