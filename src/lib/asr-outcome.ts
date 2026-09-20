/**
 * 폰 받아쓰기가 **실패로 끝났을 때 화면이 무엇을 내주어야 하는가** — 순수한 판단.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **받아쓰기 실패와 전송 실패는 다른 사건이다.** 앞의 것은 원문이 아직 없고, 뒤의 것은   │
 * │ 원문이 **폰에 멀쩡히 있다**(→ `lib/asr-pending.ts`). 둘을 「끝내지 못했습니다」 한      │
 * │ 덩어리로 그리면, 7분을 들여 받아쓴 사람이 그 7분이 날아간 줄 알고 「처음부터 다시」를    │
 * │ 누른다 — 화면이 사용자에게 자기 자료를 버리게 시키는 셈이다.                          │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 화면이 아니라 여기에 두는 이유는 **판단을 `node --test` 로 확인할 수 있게** 하기 위해서다
 * (→ `lib/asr-choice.ts`·`lib/asr-eta.ts` 가 쓰는 방식). 화면은 이 함수가 돌려준 제목·문장·
 * 버튼을 그대로 그린다.
 */
import { failureText, permanentFailure } from './call-errors';

/** 어디서 멈췄나. 🔴 **이 한 글자가 화면의 모든 문구와 버튼을 가른다.** */
export type AsrFailureStage = 'transcribe' | 'send';

/** 주 버튼이 하는 일. `resend` 는 **받아쓰기를 다시 하지 않는다** — 있는 원문을 보낼 뿐이다. */
export type AsrFailureAction = 'resend' | 'retry' | null;

export type AsrFailurePlan = {
  stage: AsrFailureStage;
  /** 카드 제목. 🔴 **사실을 먼저 말한다** — 무엇이 끝났고 무엇이 남았는지. */
  title: string;
  /** 실패 한 줄(코드까지 붙은 완성 문장 → `lib/call-errors.ts` 의 `failureText`). */
  message: string;
  action: AsrFailureAction;
  /** 버튼에 적을 말. `action` 이 없으면 빈 문자열이다. */
  actionLabel: string;
  /**
   * 「처음부터 다시」를 한 번 더 물은 뒤에만 내줄 것인가.
   *
   * 🔴 전송만 실패한 상태에서 이 버튼은 **되돌릴 수 없는 손실**이다. 누르는 순간 저장해 둔
   * 원문을 지우고 7분을 다시 태운다. 눈에 덜 띄게 두고, 무엇을 잃는지 말한 뒤에 받는다.
   */
  restartGuarded: boolean;
  /** 버튼 위에 놓을 설명들. 순서가 곧 우선순위다 — **안심시키는 사실이 맨 앞**이다. */
  notes: string[];
};

/**
 * 🔴 **영구 실패가 아니다.** 서버가 6시간을 기다리다 통화를 정리했을 뿐, 늦게 도착한 전사문은
 * 그대로 받아 준다(→ `lib/call-errors.ts` 가 이 코드를 영구 목록에서 뺀 이유).
 */
export const ASR_TIMEOUT_CODE = 'CLIENT_TRANSCRIPT_TIMEOUT';

/**
 * 서버 코드 없이 **상태 코드만** 온 4xx 중, 「요청이 틀렸다」가 아니라 「그런 경로가 없다」인 것들.
 *
 * 🔴 **실기기에서 실제로 겪은 것이 이것이다.** 28분 통화를 7분 18초에 다 받아썼는데 서버에
 * 아직 그 경로가 배포되지 않아 404 가 왔다. `permanentFailure` 는 4xx 를 영구로 보므로
 * 「다시 보내도 소용없다」가 되고, 화면에서 보내기 버튼이 사라졌다 — 남은 선택지가 「7분을
 * 다시 쓰거나 버리거나」뿐이었다. 배포가 끝나면 **같은 요청이 그대로 통한다.**
 *
 * ⚠️ 서버가 뜻을 담아 보낸 코드(`CALL_NOT_FOUND` 등)는 여기 걸리지 않는다. 그쪽은 이 통화를
 * 정말로 찾지 못했다는 뜻이라 몇 번을 보내도 답이 같다.
 */
const ROUTE_CODES = new Set(['HTTP_404', 'HTTP_405']);

/** 폰 쪽이 막힌 실패. 이 통화는 폰에서 받아쓸 길이 없으니 **서버 받아쓰기로 돌려야** 한다. */
const LOCAL_DEAD_CODES = new Set(['ASR_MODEL_MISSING', 'ASR_AUDIO_MISSING', 'ASR_CONVERT_FAILED']);

const KEPT_NOTE = '받아쓴 원문은 폰에 저장돼 있습니다. 이 화면을 닫아도 지워지지 않고, 다시 열면 받아쓰기 없이 보내기부터 합니다.';
const TIMEOUT_NOTE = '서버는 6시간을 기다리다 이 통화를 정리했지만, 늦게 도착한 원문도 그대로 받아 줍니다 — 지금 보내면 들어갑니다.';
const DEAD_NOTE = '이 오류는 다시 보내도 같은 답이 옵니다. 이 통화에 폰에서 받아쓴 원문을 넣을 길은 닫혔습니다.';
const ROUTE_NOTE = '서버가 이 요청을 알아보지 못했습니다. 서버 쪽이 준비되면 같은 원문이 그대로 들어가니, 잠시 뒤 한 번 더 보내 보세요.';
const LOCAL_DEAD_NOTE = '이 통화는 폰에서 받아쓸 수 없습니다. 포기한 뒤 서버 받아쓰기로 다시 등록해 주세요.';

/**
 * **원문을 손에 들고 있을 때** 한 번 더 보낼 값어치가 있나.
 *
 * 🔴 기본은 `lib/call-errors.ts` 의 영구 판정이되 **경로 오류만 뒤집는다.** 원문이 이미 있는
 * 상태에서 버튼을 걷는 비용은 「7분치 받아쓰기를 버린다」이고, 남겨 두는 비용은 「요청 한 번을
 * 더 쓴다」이다. 저울이 한쪽으로 크게 기운다.
 */
export function asrSendRetryable(code: string): boolean {
  if (code === ASR_TIMEOUT_CODE) return true;
  if (ROUTE_CODES.has(code)) return true;
  return !permanentFailure(code);
}

/**
 * 실패 하나를 화면 구성으로 바꾼다.
 *
 * 🔴 **`hasTranscript` 가 전부를 가른다.** 받아쓴 글이 손에 있으면 이 실패는 「보내기 실패」이지
 * 「받아쓰기 실패」가 아니다.
 */
export function asrFailurePlan(input: { hasTranscript: boolean; code: string }): AsrFailurePlan {
  const { code } = input;

  if (input.hasTranscript) {
    const retryable = asrSendRetryable(code);
    // 🔴 가장 먼저 읽혀야 하는 문장 — 「내 7분은 살아 있다」.
    const notes = [KEPT_NOTE];
    if (code === ASR_TIMEOUT_CODE) notes.push(TIMEOUT_NOTE);
    else if (ROUTE_CODES.has(code)) notes.push(ROUTE_NOTE);
    else if (!retryable) notes.push(DEAD_NOTE);
    return {
      stage: 'send',
      title: '받아쓰기는 끝났습니다 · 보내기만 남았어요',
      message: failureText('받아쓰기는 끝냈고, 그 원문을 서버로 보내는 것만 실패했습니다.', code),
      action: retryable ? 'resend' : null,
      // ⚠️ 「다시 보내기」가 아니다. 무엇을 보내는지, 받아쓰기를 다시 하지 않는다는 것이
      // 버튼 글자만 보고도 드러나야 한다.
      actionLabel: retryable ? '원문 서버 전송' : '',
      restartGuarded: true,
      notes,
    };
  }

  const permanent = permanentFailure(code);
  const notes: string[] = [];
  if (LOCAL_DEAD_CODES.has(code)) notes.push(LOCAL_DEAD_NOTE);
  return {
    stage: 'transcribe',
    title: '받아쓰기를 끝내지 못했습니다',
    message: failureText('받아쓰기를 끝내지 못했습니다.', code),
    action: permanent ? null : 'retry',
    actionLabel: permanent ? '' : '이어서 받아쓰기',
    restartGuarded: false,
    notes,
  };
}

/** 화면을 열었을 때 **받아쓰기부터인가, 보내기부터인가.** */
export type AsrResumePlan = {
  /** 🔴 참이면 받아쓰기를 **아예 돌리지 않는다** — 보낼 원문이 이미 있다. */
  skipTranscribe: boolean;
  /** 사용자에게 그 사실을 알리는 한 줄. 건너뛸 것이 없으면 빈 문자열이다. */
  note: string;
};

const RESUME_NOTE = '지난번에 받아쓴 원문이 폰에 남아 있습니다. 받아쓰기를 건너뛰고 서버로 보내기부터 합니다.';

/**
 * 🔴 **저장된 원문이 있으면 받아쓰기를 건너뛴다.** 「7분을 기다렸는데 전파가 끊겨 처음부터」를
 * 막는 유일한 길이고, 그 일이 조용히 일어나면 사용자는 화면이 멈춘 줄 안다 — 그래서 **무슨
 * 일이 일어나는지 문장으로 내보낸다.**
 *
 * ⚠️ `fresh`(= 「처음부터 다시」)는 저장된 원문을 버리기로 한 선택이므로 건너뛰지 않는다.
 */
export function asrResumePlan(input: { fresh: boolean; pending: string | null }): AsrResumePlan {
  if (input.fresh) return { skipTranscribe: false, note: '' };
  // 공백만 남은 파일은 보낼 것이 없는 것과 같다(서버도 빈 원문을 거절한다).
  if (!input.pending?.trim()) return { skipTranscribe: false, note: '' };
  return { skipTranscribe: true, note: RESUME_NOTE };
}
