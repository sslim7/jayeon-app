import type { SmsCapabilities } from './sms-device-types';

/**
 * 단말이 할 수 있는 것에서 화면이 무엇을 보여 줄지 뽑아내는 판단들.
 *
 * 화면이 `Platform.OS === 'ios'` 를 직접 보지 않는 이유는 두 가지다. 하나는 같은 화면이
 * 네이티브 앱과 웹 껍데기 양쪽에서 열리고, 그때 「지금 손에 든 단말」은 `Platform.OS` 가
 * 아니라 `getCapabilities()` 가 말해 준다는 것. 다른 하나는 여기 있으면 실기기 없이
 * 테스트할 수 있다는 것이다(`tests/sms-ios.test.cjs`).
 */

/**
 * 발신 회선(SIM)을 고를 수 있는가.
 * 🔴 iPhone 은 회선을 고르는 공개 API 가 없어 `false` 다. 아직 확인 중(null)이거나 예전
 * Android 빌드(undefined)는 회선 선택이 있는 것으로 본다.
 */
export function lineSelectable(capability: SmsCapabilities | null): boolean {
  return capability?.lineSelectable !== false;
}

/** 한 건마다 사용자가 시스템 화면에서 「보내기」를 눌러야 하는가(iPhone 메시지 작성 시트). */
export function composerConfirm(capability: SmsCapabilities | null): boolean {
  return capability?.composerConfirm === true;
}

/**
 * 지금 발송 버튼을 누를 수 있는가.
 * 회선 선택이 없는 단말에서는 SIM 을 고르지 않았다고 막지 않는다 — 고를 것이 없다.
 */
export function dispatchReady(
  capability: SmsCapabilities | null, subscriptionId: number | null, attachmentSupported: boolean,
): boolean {
  if (!capability?.supported || !capability.permissionGranted || !attachmentSupported) return false;
  return lineSelectable(capability) ? subscriptionId !== null : true;
}

/**
 * 네이티브에 넘길 회선 식별자.
 * 회선 선택이 없으면 네이티브가 읽지 않으므로 0 을 보낸다 — 있지도 않은 회선을 고른 척하지 않는다.
 */
export function dispatchSubscriptionId(
  capability: SmsCapabilities | null, subscriptionId: number | null,
): number {
  return lineSelectable(capability) ? (subscriptionId ?? 0) : 0;
}
