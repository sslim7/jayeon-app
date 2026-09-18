/**
 * 통화 한 건에 든 **돈을 읽히게 쓰는 일**만 한다.
 *
 * 🔴 **앱은 단가를 모른다.** 금액은 서버가 원화로 계산해 내려보낸다(§`jayeon-was/internal/calls/cost.go`).
 * 여기에 단가나 환율을 들이는 순간, 단가가 개정될 때마다 앱을 새로 배포해야 하고 그전까지
 * 구버전 앱은 옛 단가로 계산한 금액을 계속 보여 준다 — 그 화면에는 틀렸다는 표시가 없다.
 *
 * 🔴 **값이 없으면 칸 자체를 그리지 않는다.** 서버가 `cost` 를 안 보내는 경우는 셋이고
 * 전부 정상이다: ①서버에 단가 설정이 없다 ②사용량이 없는 옛 통화다 ③기기 분석 시절 기록이라
 * 사용량이 애초에 없다. **그때 「0원」을 그리면 안 된다 — 0원과 「모름」은 다르다.**
 */
import type { CallCost } from '@/types/calls';

/**
 * 원화 한 덩어리를 한국 관례로 쓴다.
 *
 * 🔴 **1원 미만을 「0원」으로 반올림하지 않는다.** 짧은 통화 한 건은 1원이 안 될 수 있는데,
 * 그것을 0원으로 적으면 **공짜로 읽힌다** — 이 화면을 보는 이유가 「얼마 나가는지」라서
 * 공짜로 읽히는 순간 화면이 거짓말을 한 것이 된다. 그래서 1원 아래는 소수점을 남기고,
 * 소수점 두 자리로도 0 이 되는 값은 「0.01원 미만」이라고 적는다.
 *
 * 1원 이상은 정수로 반올림한다 — 원 단위 아래를 적어 봐야 읽는 사람에게 쓸모가 없다.
 */
export function formatWon(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0원';
  if (amount < 0.01) return '0.01원 미만';
  if (amount < 1) return `${Number(amount.toFixed(2))}원`;
  return `${Math.round(amount).toLocaleString('ko-KR')}원`;
}

/**
 * 비용 한 줄.
 *
 * 🔴 **받아쓰기와 분석을 나눠 쓴다.** 이 파이프라인은 비용의 대부분이 받아쓰기라, 합계만
 * 적으면 그 사실이 가려져 어느 단계를 바꿔야 하는지 알 수 없다. 합계는 괄호로 뒤에 붙인다.
 */
export function costLine(cost: CallCost): string {
  return `비용: 받아쓰기 ${formatWon(cost.transcription)} · 분석 ${formatWon(cost.analysis)} (합계 ${formatWon(cost.total)})`;
}
