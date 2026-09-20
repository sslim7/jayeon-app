import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { mapComposeOutcome } from './ios-result';

export type SmsCapabilities = {
  supported: boolean;
  mmsSupported?: boolean;
  lmsSupported?: boolean;
  permissionGranted: boolean;
  subscriptions: { id: number; label: string }[];
  defaultSubscriptionId: number | null;
  /**
   * 발신 회선(SIM)을 고를 수 있는가. 🔴 iOS 는 `false` — 회선을 고르는 공개 API 가 없다.
   * 예전 Android 빌드는 이 값을 주지 않으므로(undefined) 회선 선택이 있는 것으로 본다.
   */
  lineSelectable?: boolean;
  /** 한 건마다 사용자가 시스템 화면에서 직접 확정해야 하는가(iOS 메시지 작성 시트). */
  composerConfirm?: boolean;
};
export type SmsSendInput = {
  campaignRecipientId: string;
  attemptId: string;
  phone: string;
  message: string;
  /** MMS 제목. 캠페인 제목을 전달하며, 비어 있으면 수신 앱이 제목없음으로 표시할 수 있다. */
  subject?: string;
  /** Android 회선 식별자. iOS 는 회선을 고를 수 없어 무시한다. */
  subscriptionId: number;
  attachments?: { name: string; mimeType: string; dataBase64: string }[];
};
export type SmsResult = {
  transport?: 'SMS' | 'LMS' | 'MMS';
  campaignRecipientId: string;
  attemptId: string;
  phone: string;
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  status: 'SENT' | 'FAILED' | 'UNKNOWN';
};
export type SmsNativeModule = {
  getCapabilitiesAsync(): Promise<SmsCapabilities>;
  requestPermissionsAsync(): Promise<SmsCapabilities>;
  sendAsync(input: SmsSendInput): Promise<SmsResult>;
  getResultsAsync(): Promise<SmsResult[]>;
  acknowledgeAsync(attemptId: string): Promise<void>;
};
/**
 * iOS 네이티브의 발송만 반환 모양이 다르다.
 *
 * 🔴 iOS 는 「보냈다/취소했다/실패했다」 셋 중 하나만 알려 준다. 그것을 `SmsResult` 로 옮기는
 * 표는 실기기 없이 확인할 수 있어야 해서 `./ios-result.ts` 에 두었고, 그래서 Swift 는 결말
 * 문자열만 넘긴다. **JS 가 보는 `smsNative` 의 함수 목록과 반환 타입은 두 플랫폼이 같다** —
 * 플랫폼 분기는 이 파일 안에서 끝난다.
 */
type SmsAppleNativeModule = Omit<SmsNativeModule, 'sendAsync'> & {
  sendAsync(input: SmsSendInput): Promise<{ outcome: string }>;
};

const android = Platform.OS === 'android'
  ? requireOptionalNativeModule<SmsNativeModule>('NatureSms')
  : null;
const apple = Platform.OS === 'ios'
  ? requireOptionalNativeModule<SmsAppleNativeModule>('NatureSms')
  : null;
const native: Pick<SmsNativeModule, 'getCapabilitiesAsync' | 'requestPermissionsAsync' | 'getResultsAsync' | 'acknowledgeAsync'> | null = android ?? apple;
const unsupported: SmsCapabilities = {
  supported: false, permissionGranted: false, subscriptions: [], defaultSubscriptionId: null,
};
function unsupportedSend(): Promise<never> {
  if (Platform.OS === 'android') {
    return Promise.reject(new Error('SMS 기능이 포함된 Android 개발 빌드가 필요합니다. Expo Go에서는 지원하지 않습니다.'));
  }
  if (Platform.OS === 'ios') {
    return Promise.reject(new Error('문자 발송이 포함된 iOS 개발 빌드가 필요합니다. Expo Go에서는 지원하지 않습니다.'));
  }
  return Promise.reject(new Error('이 기능은 Android·iPhone 앱에서 사용할 수 있습니다.'));
}
export const smsNative: SmsNativeModule = {
  getCapabilitiesAsync: () => native?.getCapabilitiesAsync() ?? Promise.resolve(unsupported),
  requestPermissionsAsync: () => native?.requestPermissionsAsync() ?? Promise.resolve(unsupported),
  sendAsync: (input) => {
    if (apple) return apple.sendAsync(input).then(({ outcome }) => mapComposeOutcome(input, outcome));
    return android?.sendAsync(input) ?? unsupportedSend();
  },
  getResultsAsync: () => native?.getResultsAsync() ?? Promise.resolve([]),
  acknowledgeAsync: (attemptId) => native?.acknowledgeAsync(attemptId) ?? Promise.resolve(),
};
export default smsNative;

export const getCapabilitiesAsync = smsNative.getCapabilitiesAsync;
export const requestPermissionsAsync = smsNative.requestPermissionsAsync;
export const sendAsync = smsNative.sendAsync;
export const getResultsAsync = smsNative.getResultsAsync;
export const acknowledgeAsync = smsNative.acknowledgeAsync;
