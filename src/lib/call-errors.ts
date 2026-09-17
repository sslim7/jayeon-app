/**
 * 실패 이유를 사람이 읽을 수 있는 한 줄로 바꾼다.
 *
 * 🔴 **원본 오류 문구를 화면·저장소로 내보내지 않는다.** 네이티브 예외에는 파일 경로가,
 * 파싱 오류에는 통화 원문 조각이 섞여 들어올 수 있다(→ `docs/call-analysis.md` 의 개인정보
 * 항목). 그래서 여기서는 **미리 정한 코드만 통과**시키고, 모르는 것은 `UNKNOWN` 으로 눌러
 * 버린다. 그 대신 코드를 함께 보여 준다 — 「분석에 실패했습니다」만 남으면 다음에도 추측밖에
 * 할 수 없기 때문이다.
 */

/** 화면에 보여도 안전한 내부 코드와 그 이유. 여기 없는 값은 밖으로 나가지 않는다. */
const REASONS: Record<string, string> = {
  MODELS_REQUIRED: 'AI 기능이 설치되어 있지 않습니다.',
  MISSING_AUDIO: '기기에서 원본 녹음파일을 찾지 못했습니다.',
  EMPTY_TRANSCRIPT: '녹음에서 사람 말소리를 찾지 못했습니다.',
  UTTERANCE_TOO_LONG: '끊어 읽을 곳이 없는 긴 발화가 있습니다.',
  TOO_MANY_SEGMENTS: '원문 구간이 너무 많습니다.',
  SEGMENT_TOO_LONG: '원문 구간 하나가 너무 깁니다.',
  TRANSCRIPT_TOO_LARGE: '통화 원문이 저장 한도를 넘었습니다.',
  INVALID_TRANSCRIPT: '통화 원문을 읽을 수 없습니다.',
  CONTEXT_TOO_LONG: '한 번에 분석할 내용이 모델이 다룰 수 있는 길이를 넘었습니다.',
  INCOMPLETE_ANALYSIS: 'AI가 출력 한도 안에 분석을 끝내지 못했습니다.',
  INVALID_ANALYSIS: 'AI 분석 결과가 정해진 형식에 맞지 않았습니다.',
  INVALID_ANALYSIS_SIZE: 'AI 분석 결과가 허용 크기를 넘었습니다.',
  INVALID_TODO: 'AI가 만든 할 일 항목이 형식에 맞지 않았습니다.',
  INVALID_DUE_DATE: 'AI가 만든 기한이 실제 날짜가 아닙니다.',
  ANALYSIS_TOO_LARGE: '분석 결과가 서버에 보낼 수 있는 크기를 넘었습니다.',
  TLS_REQUIRED: '보안 연결이 아니어서 전송을 멈췄습니다.',
  UNKNOWN: '알 수 없는 오류입니다.',
};

/** 오류를 **정해진 코드로만** 바꾼다. 모르는 오류는 문구를 버리고 `UNKNOWN` 이다. */
export function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('UPLOAD_REJECTED:')) {
    const reason = message.slice('UPLOAD_REJECTED:'.length);
    return REASONS[reason] ? reason : 'UPLOAD_REJECTED';
  }
  return REASONS[message] ? message : 'UNKNOWN';
}

/** 서버 응답은 상태 코드만 남긴다. 본문에는 요청 내용이 되비칠 수 있다. */
export function httpCode(status: number): string {
  return Number.isFinite(status) ? `HTTP_${Math.trunc(status)}` : 'UNKNOWN';
}

export function failureReason(code: string): string {
  if (REASONS[code]) return REASONS[code];
  const http = /^HTTP_(\d{3})$/.exec(code);
  if (http) return Number(http[1]) < 500 ? '서버가 이 내용을 받지 않았습니다.' : '서버와 통신하지 못했습니다.';
  if (code === 'UPLOAD_REJECTED') return '서버가 이 내용을 받지 않았습니다.';
  return REASONS.UNKNOWN;
}

/** 화면과 로컬 DB 에 남길 한 줄. 코드를 붙여 다음 사람이 바로 짚을 수 있게 한다. */
export function failureText(base: string, code: string): string {
  return `${base} ${failureReason(code)} (코드: ${code})`;
}
