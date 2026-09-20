import type { SmsResult, SmsSendInput } from './index';

/**
 * iOS 작성 시트가 끝난 방식을 우리 발송 결과로 옮기는 표.
 *
 * 🔴 **Swift 가 아니라 여기 있다.** 실기기 없이 확인할 수 있어야 하는 규칙이기 때문이다
 * (`tests/sms-ios.test.cjs`). Swift 쪽(`ios/NatureSmsModule.swift`)은 시스템이 준 결말
 * 하나를 문자열로 넘겨줄 뿐이다.
 */
export type SmsComposeOutcome = 'sent' | 'cancelled' | 'failed' | 'unknown';

/** 사용자가 시트를 열었다가 닫았다. 「모른다」가 아니라 「안 나갔다」는 것을 안다. */
export const USER_CANCELLED = 'USER_CANCELLED';

export function mapComposeOutcome(
  input: Pick<SmsSendInput, 'campaignRecipientId' | 'attemptId' | 'phone'>,
  outcome: string,
): SmsResult {
  const base = {
    campaignRecipientId: input.campaignRecipientId,
    attemptId: input.attemptId,
    phone: input.phone,
    // 🔴 transport 를 채우지 않는다. iOS 는 SMS 로 나갔는지 iMessage 로 나갔는지,
    // 길어서 MMS 가 됐는지 알려 주지 않는다. 모르는 값을 지어내면 이력이 거짓말을 한다.
  };
  switch (outcome) {
    // ⚠️ 「메시지 앱에 넘겼다」는 뜻이다. 상대 수신·읽음 확인이 아니며 통신사 확정 결과도 없다.
    case 'sent':
      return { ...base, success: true, status: 'SENT', errorCode: null, errorMessage: null };
    case 'cancelled':
      return {
        ...base, success: false, status: 'UNKNOWN', errorCode: USER_CANCELLED,
        errorMessage: '메시지 화면을 열었지만 보내지 않고 닫았어요.',
      };
    case 'failed':
      return {
        ...base, success: false, status: 'FAILED', errorCode: 'IOS_SEND_FAILED',
        errorMessage: 'iOS 메시지 앱이 발송에 실패했어요.',
      };
    // 모르는 결말은 실패로 단정하지 않는다 — 나갔는지 아닌지를 모르는 것이다.
    default:
      return {
        ...base, success: false, status: 'UNKNOWN', errorCode: 'IOS_OUTCOME_UNKNOWN',
        errorMessage: '메시지 화면의 결과를 확인하지 못했어요.',
      };
  }
}
