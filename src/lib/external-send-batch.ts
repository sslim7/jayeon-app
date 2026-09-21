import { externalSendLocalTime, parseExternalSendTime } from '@/lib/external-send-date';

/**
 * 「발송처리」 — 다른 곳에서 이미 보낸 문자를 **선택한 여러 명에게 한꺼번에** 기록하는 판정.
 *
 * 한 사람씩 하는 길은 이미 있다(수신자를 눌러 → 「발송등록」 → 발송일시 입력). 다만 서른 명을
 * 그렇게 처리하면 서른 번 들어갔다 나와야 하고, 그 사이 시계가 흘러 **같은 한 번의 발송이
 * 제각각인 일시로 흩어져** 나중에 이력에서 한 묶음으로 읽히지 않는다. 그래서 일괄 경로는
 * 시각을 한 번만 정해 전원에게 같은 값으로 쓴다.
 *
 * 🔴 **되돌리는 API 가 없다.** 한 번 등록하면 그 사람의 누적 발송건수가 영구히 올라간다.
 * 그래서 화면은 삭제와 같은 급의 확인 시트를 세운다(→ `app/sms/new.tsx`).
 */

/**
 * 일괄 발송처리가 기록할 시각. **분 단위로 잘라** ISO 로 만든다.
 *
 * ⚠️ 자르는 것이 핵심이다. 서버는 미래 일시를 400 으로 거절하는데, 초를 버리면 값이 항상
 * 현재보다 과거(최대 59초)가 되어 단말과 서버의 사소한 시계 어긋남을 흡수한다. 초까지 그대로
 * 보내면 단말 시계가 1초만 빨라도 선택한 전원이 통째로 거절당한다.
 *
 * ⚠️ 그리고 **1명씩 등록하는 기존 경로와 똑같은 헬퍼**(`externalSendLocalTime` →
 * `parseExternalSendTime`)를 통과시킨다. 여기서 지름길로 `toISOString()` 을 쓰면 두 경로가
 * 서로 다른 형식·정밀도로 같은 필드를 채우게 되고, 그 어긋남은 이력을 열어 보기 전까지
 * 조용히 남는다.
 */
export function externalSendBatchTime(now = new Date()): string {
  return parseExternalSendTime(externalSendLocalTime(now), now);
}

/** 일괄 발송처리의 결과 한 줄. 세 가지가 한 번에 나올 수 있어 문장을 이어 붙인다. */
export function externalSendBatchNotice({ done, failed, conflicted }: { done: number; failed: number; conflicted: number }): string {
  return [
    `${done}명을 발송처리했어요.`,
    // 409 는 **같은 요청이 이미 다른 일시로 등록돼 있다**는 뜻이다 — 앞선 시도가 서버에는
    // 닿았다는 증거이므로 실패와 섞어 세면 사용자가 없던 실패를 쫓게 된다.
    conflicted ? `${conflicted}명은 앞서 다른 일시로 이미 발송처리되어 있어 그대로 두었어요.` : '',
    failed ? `${failed}명은 발송처리하지 못했어요. 목록을 확인해 주세요.` : '',
  ].filter(Boolean).join(' ');
}
