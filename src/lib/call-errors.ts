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
 *
 * 🔴 **여기 오는 코드는 전부 「서버가 더 해 볼 것이 없는」 상태다.** 서버는 자동으로 회복되는
 * 실패를 화면에 내보내지 않는다 — 재시도하는 동안 통화는 「분석 중」으로 남는다
 * (§`internal/calls/pipeline.go` 의 `failStep`/`summaryRecord`). 그래서 여기 문구는
 * **「잠시 뒤 다시 시도해 주세요」가 될 수 없다.** 기다리면 될 일이라면 애초에 이 화면이
 * 뜨지 않았다. 각 문구는 ①무엇이 잘못됐는지, ②사용자가 할 수 있는 일이 있는지를 말하고,
 * 없으면 **없다고 말한다**(그래야 헛되이 다시 누르지 않는다).
 */

/** 화면에 보여도 안전한 코드와 그 이유. 여기 없는 값은 문구 없이 코드만 나간다. */
const REASONS: Record<string, string> = {
  /*
    ── 서버 파이프라인이 종료 상태에 남기는 코드 ─────────────────

    🔴 이 이름들은 §`internal/calls/pipeline.go` 의 `failTerminal` 호출부와 `userCode()` 가
    정한다. `userCode()` 는 공급자 코드 대신 **분류 이름**을 내보내는 두 경우가 있다 —
    내용 필터(`CONTENT_FILTERED`)와 오디오를 읽지 못한 경우(`INPUT_UNAVAILABLE`)다.
    사용자가 할 일이 서로 다르기 때문이다. 나머지는 서버가 지은 코드가 그대로 온다.
  */
  EMPTY_TRANSCRIPT: '녹음에서 사람 말소리를 찾지 못했습니다.',
  // 서버가 이미 여러 번 해 봤다. 사람이 한 번 더 눌러 볼 여지는 남아 있어 사실만 말한다.
  RETRIES_EXHAUSTED: '서버가 여러 번 다시 시도했지만 끝내 실패했습니다.',
  /*
    🔴 **다시 눌러도 같은 결과다.** 서버가 한 통화에 쓰기로 정해 둔 시간이 이 통화 길이를
    감당하지 못한 것이라, 고칠 사람은 사용자가 아니라 우리다. 「잠시 뒤 다시」처럼 들리는
    말을 여기 쓰면 사용자는 같은 실패를 반복하며 우리 대신 시간을 쓴다.
  */
  BUDGET_TOO_SMALL: '이 통화를 처리하기에는 서버에 정해 둔 시간이 모자랍니다. 다시 시도해도 같으니 저희가 고쳐야 합니다.',
  CONTENT_FILTERED: 'AI 공급자가 이 녹음의 내용을 처리하지 않았습니다. 다시 시도해도 같습니다.',
  INPUT_UNAVAILABLE: '서버가 올라간 녹음 파일을 읽지 못했습니다. 다시 등록해 주세요.',
  // 받아쓴 분량은 녹음 길이가 정한다 — 같은 파일을 다시 올리면 같은 자리에서 막힌다.
  TRANSCRIPT_TOO_LARGE: '받아쓴 내용이 서버 저장 한도를 넘었습니다. 녹음을 나눠서 등록해 주세요.',
  ANALYSIS_TOO_LARGE: '정리한 내용이 서버 저장 한도를 넘었습니다. 다시 시도해도 같으니 저희가 고쳐야 합니다.',
  // ⚠️ 빈 결과는 위의 한도 초과와 다르다. AI 는 같은 원문에도 매번 다르게 답하므로 다시 하면 나올 수 있다.
  EMPTY_ANALYSIS: 'AI가 정리한 내용이 비어 있어 저장하지 못했습니다. 다시 시도하면 나올 수 있습니다.',
  RECORD_INVALID: '서버가 만든 분석 결과에 문제가 있어 저장하지 못했습니다. 저희가 고쳐야 하는 문제입니다.',
  /*
    분류 이름이 코드 자리에 오는 폴백. 공급자가 코드를 주지 않았을 때 서버가 이것을 쓴다.

    ⚠️ `RETRYABLE` 이 **종료 상태로 오는 일은 없어야 한다** — 회복 가능한 실패는 서버가
    재시도하고, 상한까지 쓰면 `RETRIES_EXHAUSTED` 로 바뀐다. 그래도 화면에 나타난다면
    서버 쪽이 깨진 것이니, 사용자에게 다시 시도를 시키는 대신 그 사실을 말한다.
  */
  PERMANENT: '다시 시도해도 같은 결과가 나오는 오류입니다.',
  RETRYABLE: '서버가 스스로 다시 시도해 넘겼어야 하는 실패입니다. 저희가 확인해야 합니다.',
  /*
    ── 지금 서버는 내보내지 않지만 남아 있는 코드 ────────────────

    ⚠️ 통화 기록은 서버에 계속 남는다. 아래 셋은 **v0.1.4 이전에 실패한 통화**의 화면에
    아직 그대로 뜬다 — 옛 코드라고 지우면 그 통화들만 「알 수 없는 오류」가 된다.
    `AUDIO_MISSING` 은 지금도 서버 코드에 있지만 `userCode()` 가 `INPUT_UNAVAILABLE` 로
    눌러 보내고, `ProviderTimeout` 은 재시도 분류라 종료 상태까지 오지 못한다.
  */
  MAX_ATTEMPTS: '서버가 여러 번 다시 시도했지만 끝내 실패했습니다.',
  AUDIO_MISSING: '등록된 녹음 파일이 서버에 없습니다. 다시 등록해 주세요.',
  ProviderTimeout: 'AI 공급자가 제시간에 답하지 않았습니다.',
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

/**
 * 이 코드로 끝난 일은 다시 보내도 같은 답이 온다. 자동 재시도 대상에서 빼고,
 * **「분석 다시 시도」 버튼도 세우지 않는다**(→ `callRetryable`, §`app/calls/index.tsx`).
 *
 * 🔴 판단 기준은 「입력이 결과를 정하는가」다. 녹음·길이·저장 한도처럼 **같은 입력이면
 * 같은 자리에서 막히는 것**은 여기 넣는다 — 눌러 봐야 사용자는 시간을, 우리는 공급자
 * 요금을 쓴다. 반대로 AI 가 매번 다르게 답해서 갈리는 것(`EMPTY_ANALYSIS`)과 서버가
 * 시도 횟수를 다 쓴 것(`RETRIES_EXHAUSTED`)은 넣지 않는다 — 사람이 판단해 한 번 더
 * 돌릴 값어치가 있다.
 */
const PERMANENT_CODES = new Set(['UNSUPPORTED_TYPE', 'FILE_TOO_LARGE', 'EMPTY_FILE', 'INVALID_CONTACT', 'INVALID_RECORDED_AT', 'CALL_TOO_LARGE', 'CALL_NOT_FOUND', 'CALL_ALREADY_QUEUED', 'PERMANENT', 'CONTENT_FILTERED', 'TLS_REQUIRED', 'BUDGET_TOO_SMALL', 'EMPTY_TRANSCRIPT', 'TRANSCRIPT_TOO_LARGE', 'ANALYSIS_TOO_LARGE', 'RECORD_INVALID', 'INPUT_UNAVAILABLE', 'AUDIO_MISSING']);

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
  const code = callFailureCode(record);
  if (record.status === 'TRANSCRIPTION_FAILED') return failureText('녹음을 받아쓰지 못했습니다.', code);
  if (record.status === 'ANALYSIS_FAILED') return failureText('받아쓰기는 끝났지만 내용을 정리하지 못했습니다.', code);
  return failureText('분석을 완료하지 못했습니다.', code);
}

/** 서버가 코드를 비워 보낼 수도 있다. 빈 자리를 아는 척하지 않고 `UNKNOWN` 으로 읽는다. */
function callFailureCode(record: { error?: string | null }): string {
  return typeof record.error === 'string' && record.error.trim() ? record.error.trim() : 'UNKNOWN';
}

/**
 * **「분석 다시 시도」를 세워도 되는 통화인가.**
 *
 * 🔴 두 조건을 모두 넘어야 한다.
 *   ① 분석 단계에서 멈췄을 것 — 받아쓰기가 실패한 통화에는 다시 분석할 원문이 없어
 *     서버가 409 로 거절한다.
 *   ② 다시 눌러도 결과가 같은 코드가 아닐 것 — `BUDGET_TOO_SMALL` 처럼 우리가 고쳐야
 *     하는 실패에 버튼을 세워 두면, 사용자는 바뀔 수 없는 결과를 반복해서 부르고
 *     그 요금은 우리가 낸다. **할 수 있는 일이 없을 때는 버튼 대신 그 사실을 보여 준다.**
 *
 * ⚠️ 버튼 자체를 없애는 것은 답이 아니다. 서버가 자동 재시도를 다 쓴 뒤
 * (`RETRIES_EXHAUSTED`) 사람이 판단해 한 번 더 돌리는 길은 남아 있어야 한다.
 */
export function callRetryable(record: { status: string; error?: string | null }): boolean {
  return record.status === 'ANALYSIS_FAILED' && !permanentFailure(callFailureCode(record));
}
