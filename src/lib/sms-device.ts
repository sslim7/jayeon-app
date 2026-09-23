import {
  getCapabilitiesAsync, requestPermissionsAsync, sendAsync, getResultsAsync, acknowledgeAsync,
} from '../../modules/nature-sms';
import type { SmsDevice } from './sms-device-types';

export type { SmsCapabilities, SmsNativeResult, SmsSendInput } from './sms-device-types';

export const smsDevice: SmsDevice = {
  getCapabilities: getCapabilitiesAsync,
  requestPermissions: requestPermissionsAsync,
  send: sendAsync,
  getResults: getResultsAsync,
  acknowledge: acknowledgeAsync,
};
export const getCapabilities = smsDevice.getCapabilities;
export const requestPermissions = smsDevice.requestPermissions;

/**
 * 껍데기 다리의 폭 — **네이티브에서는 다리가 없다.**
 *
 * 이 파일이 도는 곳은 껍데기를 끈 빌드(`EXPO_PUBLIC_WEB_SHELL=false`)의 네이티브 화면이고,
 * 거기서는 첨부가 웹뷰 메시지를 건너지 않고 모듈로 곧장 간다. 그래서 좁힐 이유가 없고,
 * 숫자를 지어내면 **멀쩡한 사진을 필요 이상으로 뭉갠다.** `Infinity` 는 목표 계산에서
 * 「모른다」로 다뤄진다(→ `lib/image-shrink-plan.ts` 의 `shrinkTargetBytes`).
 *
 * 웹 짝(`sms-device.web.ts`)과 짝을 맞추기 위한 구현이다 — 호출부가 플랫폼 분기를 두지
 * 않게 한다.
 */
export function shellMessageMaxBytes(): number {
  return Number.POSITIVE_INFINITY;
}
