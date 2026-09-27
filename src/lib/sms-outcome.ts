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
export type RecipientOutcome = 'SENT' | 'FAILED' | 'UNSENT' | 'PENDING' | 'REVIEW' | 'SENDING';

/**
 * 「보내지 않았다」로 남은 사유들.
 *
 * 🔴 `src/lib/sms-runner.ts` 의 상수들과 **같은 글자여야 한다.** 한쪽만 바뀌면 그 사유가 조용히
 * 「실패」로 돌아가 다시 두 버튼이 선다. `tests/sms-ios.test.cjs` 가 두 파일을 묶어 둔다.
 */
export const NOT_SENT_CODES = [
  'USER_SKIPPED', 'USER_CANCELLED', 'CANCELLED_BEFORE_SEND', 'IOS_COMPOSER_ABANDONED',
  // 사람이 폰 메시지함을 보고 「안 나갔다」고 닫은 줄. 빠지면 「실패」로 세어져 다시 보내기가 가리킨다.
  'USER_MARKED_NOT_SENT',
];

/** 나갔는지 확인되지 않은 사유들. 자동 재발송을 막는 자리이며 예전 판정과 같은 목록이다. */
const REVIEW_CODES = ['OUTCOME_UNKNOWN', 'PARTIAL_SENT'];

type Outcome = Pick<CampaignRecipient, 'status' | 'errorCode'>;
type Listed = Pick<CampaignRecipient, 'id' | 'status' | 'errorCode'>;

export function recipientOutcome(row: Outcome): RecipientOutcome {
  if (row.status === 'SENT') return 'SENT';
  /*
   * 🔴 **`SENDING` 은 「나갔는지 모름」과 갈라 센다.** 예전에는 둘 다 `REVIEW` 였고 화면은
   * 그 칸을 「확인 필요」라고 불렀는데, 사용자에게 할 말이 서로 다르다:
   *
   * - `SENDING`: 서버가 이 사람을 발송용으로 잠근 뒤 결과를 **한 번도 받지 못했다.** 서버는
   *   스스로 판정하지 않으므로(나갔는지 알 길이 없다) 이 줄은 사람이 풀어 주기 전까지 그대로
   *   남는다. 화면은 이것을 **「발송중」**으로 보여 준다.
   * - `REVIEW`(UNKNOWN·OUTCOME_UNKNOWN·PARTIAL_SENT): 결과는 받았는데 **나갔는지 확정되지
   *   않은** 줄이다.
   *
   * ⚠️ 갈라도 **둘 다 재발송 대상이 아닌 것은 같다**(→ `unsentTargets`·`retryTargets`).
   * 여기서 `SENDING` 을 미발송으로 세면 이미 나간 문자를 한 번 더 보낸다.
   */
  if (row.status === 'SENDING') return 'SENDING';
  // 🔴 「모른다」가 먼저다. 모르는 것을 미발송으로 세면 이미 나간 문자를 다시 보내게 된다.
  if (row.status === 'UNKNOWN' || REVIEW_CODES.includes(row.errorCode ?? '')) {
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
  /**
   * 발송용으로 잡아 둔 채 결과를 받지 못한 사람. 화면에서는 **「발송중」**이다.
   *
   * 🔴 **`review` 와 한 칸에 두지 않는다.** 이 사람은 결과를 못 받은 것이지 「나갔는지 모르는」
   * 것이 아니고, 남아 있는 한 그 캠페인은 **한 명도 더 보낼 수 없다**(→ `lib/sms-runner.ts` 가
   * `SENDING` 이 하나라도 있으면 발송을 거절한다). 그래서 사용자가 풀어 줄 길이 필요하고,
   * 풀어 줄 대상을 세는 칸이 따로 있어야 화면이 그 길을 세울 수 있다.
   */
  sending: number;
}
export function countOutcomes(rows: Outcome[]): OutcomeCounts {
  const counts: OutcomeCounts = { sent: 0, failed: 0, unsent: 0, review: 0, sending: 0 };
  for (const row of rows) {
    const outcome = recipientOutcome(row);
    if (outcome === 'SENT') counts.sent += 1;
    else if (outcome === 'FAILED') counts.failed += 1;
    else if (outcome === 'REVIEW') counts.review += 1;
    else if (outcome === 'SENDING') counts.sending += 1;
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

/**
 * 「고른 사람에게만 보낸다」로 **좁힌다.**
 *
 * 🔴 **교집합이다. 받은 목록을 그대로 보내지 않는다.** `unsentTargets`·`retryTargets` 의 판정을
 * 건너뛰고 화면이 준 id 를 러너에 그대로 넘기면, **이미 보낸 사람·결과가 확정되지 않은 사람에게
 * 문자가 한 번 더 나간다.** 이 목록은 주소 파라미터를 타고 오기도 하므로(→ `lib/sms-origin.ts` 의
 * `readSmsOnlyIds`), 그대로 믿으면 링크 한 줄이 위의 판정을 통째로 무력화하는 셈이 된다.
 * 좁히는 것만 허용하고 **넓히는 것은 허용하지 않는다.**
 *
 * ⚠️ 「없음」과 「빈 목록」은 다르다. `null`/`undefined` 는 지정이 **없는** 평소 경로라 전원
 * 그대로 두고, 빈 배열은 「아무도 고르지 않았다」라 아무도 남지 않는다. 둘을 같게 다루면
 * 「한 명도 못 고른 화면」이 조용히 전원 발송으로 바뀐다.
 */
export function narrowTargets(targets: string[], only?: readonly string[] | null): string[] {
  if (!only) return targets;
  const wanted = new Set(only);
  return targets.filter((id) => wanted.has(id));
}
