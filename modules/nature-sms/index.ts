import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type SmsCapabilities = {
  supported: boolean;
  mmsSupported?: boolean;
  lmsSupported?: boolean;
  permissionGranted: boolean;
  subscriptions: { id: number; label: string }[];
  defaultSubscriptionId: number | null;
};
export type SmsSendInput = {
  campaignRecipientId: string;
  attemptId: string;
  phone: string;
  message: string;
  /** MMS 제목. 캠페인 제목을 전달하며, 비어 있으면 수신 앱이 제목없음으로 표시할 수 있다. */
  subject?: string;
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
const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<SmsNativeModule>('NatureSms')
  : null;
const unsupported: SmsCapabilities = {
  supported: false, permissionGranted: false, subscriptions: [], defaultSubscriptionId: null,
};
export const smsNative: SmsNativeModule = {
  getCapabilitiesAsync: () => native?.getCapabilitiesAsync() ?? Promise.resolve(unsupported),
  requestPermissionsAsync: () => native?.requestPermissionsAsync() ?? Promise.resolve(unsupported),
  sendAsync: (input) => native?.sendAsync(input) ?? Promise.reject(new Error(
    Platform.OS === 'android'
      ? 'SMS 기능이 포함된 Android 개발 빌드가 필요합니다. Expo Go에서는 지원하지 않습니다.'
      : '이 기능은 Android 앱에서 사용할 수 있습니다.',
  )),
  getResultsAsync: () => native?.getResultsAsync() ?? Promise.resolve([]),
  acknowledgeAsync: (attemptId) => native?.acknowledgeAsync(attemptId) ?? Promise.resolve(),
};
export default smsNative;

export const getCapabilitiesAsync = smsNative.getCapabilitiesAsync;
export const requestPermissionsAsync = smsNative.requestPermissionsAsync;
export const sendAsync = smsNative.sendAsync;
export const getResultsAsync = smsNative.getResultsAsync;
export const acknowledgeAsync = smsNative.acknowledgeAsync;
