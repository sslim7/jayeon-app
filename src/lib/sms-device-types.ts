export interface SmsCapabilities {
  supported: boolean;
  mmsSupported?: boolean;
  lmsSupported?: boolean;
  permissionGranted: boolean;
  subscriptions: { id: number; label: string }[];
  defaultSubscriptionId: number | null;
  /**
   * 발신 회선(SIM)을 고를 수 있는가. 🔴 iPhone 은 `false` — 회선을 고르는 공개 API 가 없어
   * 기기의 기본 회선으로만 나간다. 예전 Android 빌드는 이 값을 주지 않으므로(undefined)
   * 회선 선택이 있는 것으로 본다.
   */
  lineSelectable?: boolean;
  /**
   * 한 건마다 사용자가 시스템 화면에서 직접 확정해야 하는가.
   * iPhone 의 메시지 작성 시트가 그렇다 — 앱은 시트를 띄울 뿐 「보내기」는 사람이 누른다.
   */
  composerConfirm?: boolean;
}

export interface SmsAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface SmsSendInput {
  campaignRecipientId: string;
  attemptId: string;
  phone: string;
  message: string;
  subject?: string;
  subscriptionId: number;
  attachments?: SmsAttachment[];
}

export interface SmsNativeResult {
  campaignRecipientId: string;
  attemptId: string;
  phone: string;
  success: boolean;
  transport?: 'SMS' | 'LMS' | 'MMS';
  status: 'SENT' | 'FAILED' | 'UNKNOWN';
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SmsDevice {
  getCapabilities(): Promise<SmsCapabilities>;
  requestPermissions(): Promise<SmsCapabilities>;
  send(input: SmsSendInput): Promise<SmsNativeResult>;
  getResults(): Promise<SmsNativeResult[]>;
  acknowledge(attemptId: string): Promise<void>;
}

export const unavailable: SmsCapabilities = {
  supported: false, permissionGranted: false, subscriptions: [], defaultSubscriptionId: null,
};
