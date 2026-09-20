import type { CampaignRecipient } from '@/types/sms';

/**
 * 한 사람에게 실제로 무슨 일이 있었는가.
 *
 * 🔴 **서버는 `SENT` 와 `FAILED` 둘밖에 모른다.** 그래서 「내가 안 보낸 사람」 — 통과, 중단,
 * 메시지 시트를 열었다 닫음 — 도 전부 FAILED 로 들어온다. 화면이 그걸 그대로 「실패」로 세면
 * 두 가지가 망가진다. 보내려다 안 간 것과 **아예 보내지 않은 것**이 한 칸에 섞이고,
 * 「미발송 계속 보내기」와 「실패 다시 보내기」가 같은 일을 가리키며 나란히 서서 어느 쪽을
 * 눌러야 하는지 알 수 없게 된다. 실기기에서 두 명짜리 캠페인을 처음부터 중단했을 때
 * 「성공 0 · 실패 1 · 대기 1」에 버튼 두 개가 서던 자리가 이것이다.
 *
 * 갈라 놓을 근거는 이미 서버에 있다 — **사유 코드**다. 계약(`status: SENT|FAILED`)은 그대로
 * 두고 화면이 사유를 보고 센다.
 *
 * ⚠️ 안드로이드에는 이 사유들이 거의 없다(「통과」와 한 건 확인창은 iPhone 전용이다). 분류가
 * 생겨도 안드로이드가 세는 값은 예전과 같다 — `tests/sms.test.cjs` 가 증거다.
 */
export type RecipientOutcome = 'SENT' | 'FAILED' | 'UNSENT' | 'PENDING' | 'REVIEW';

/**
 * 「보내지 않았다」로 남은 사유들.
 *
 * 🔴 `src/lib/sms-runner.ts` 의 상수들과 **같은 글자여야 한다.** 한쪽만 바뀌면 그 사유가 조용히
 * 「실패」로 돌아가 다시 두 버튼이 선다. `tests/sms-ios.test.cjs` 가 두 파일을 묶어 둔다.
 */
export const NOT_SENT_CODES = [
  'USER_SKIPPED', 'USER_CANCELLED', 'CANCELLED_BEFORE_SEND', 'IOS_COMPOSER_ABANDONED',
];

/** 나갔는지 확인되지 않은 사유들. 자동 재발송을 막는 자리이며 예전 판정과 같은 목록이다. */
const REVIEW_CODES = ['OUTCOME_UNKNOWN', 'PARTIAL_SENT'];

type Outcome = Pick<CampaignRecipient, 'status' | 'errorCode'>;
type Listed = Pick<CampaignRecipient, 'id' | 'status' | 'errorCode'>;

export function recipientOutcome(row: Outcome): RecipientOutcome {
  if (row.status === 'SENT') return 'SENT';
  // 🔴 「모른다」가 가장 먼저다. 모르는 것을 미발송으로 세면 이미 나간 문자를 다시 보내게 된다.
  if (row.status === 'UNKNOWN' || row.status === 'SENDING' || REVIEW_CODES.includes(row.errorCode ?? '')) {
    return 'REVIEW';
  }
  if (row.status === 'FAILED') return NOT_SENT_CODES.includes(row.errorCode ?? '') ? 'UNSENT' : 'FAILED';
  return 'PENDING';
}

export interface OutcomeCounts {
  sent: number;
  /** 보냈는데 안 간 사람. 통신사·기기가 거절한 경우다. */
  failed: number;
  /** 아직 안 보낸 사람. **대기 중인 사람과 내가 안 보내기로 한 사람을 한 칸에 센다** — 사용자에게는 둘 다 「아직 안 보낸 사람」이고, 버튼도 하나로 묶인다. */
  unsent: number;
  /** 나갔는지 확인되지 않은 사람. 자동으로 다시 보내지 않는다. */
  review: number;
}
export function countOutcomes(rows: Outcome[]): OutcomeCounts {
  const counts: OutcomeCounts = { sent: 0, failed: 0, unsent: 0, review: 0 };
  for (const row of rows) {
    const outcome = recipientOutcome(row);
    if (outcome === 'SENT') counts.sent += 1;
    else if (outcome === 'FAILED') counts.failed += 1;
    else if (outcome === 'REVIEW') counts.review += 1;
    else counts.unsent += 1;
  }
  return counts;
}

/**
 * 「미발송 보내기」가 가리키는 사람들. 대기 + 내가 안 보내기로 한 사람.
 * 🔴 `retryTargets` 와 **한 사람도 겹치지 않는다** — 한 사람은 한 분류에만 든다.
 */
export function unsentTargets(rows: Listed[]): string[] {
  return rows.filter((row) => ['PENDING', 'UNSENT'].includes(recipientOutcome(row))).map((row) => row.id);
}
/** 「실패 다시 보내기」가 가리키는 사람들. 확실하게 실패한 사람만이다. */
export function retryTargets(rows: Listed[]): string[] {
  return rows.filter((row) => recipientOutcome(row) === 'FAILED').map((row) => row.id);
}
/**
 * 되돌려야 보낼 수 있는 사람이 섞여 있는가(내가 안 보내기로 해서 FAILED 로 닫힌 사람).
 * 없으면 발송은 예전 그대로 「대기 중인 사람 전부」로 돈다 — 안드로이드가 걷던 길 그대로다.
 */
export function hasClosedUnsent(rows: Outcome[]): boolean {
  return rows.some((row) => recipientOutcome(row) === 'UNSENT');
}
