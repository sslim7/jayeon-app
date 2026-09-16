export interface SmsCapabilities {
  supported: boolean;
  mmsSupported?: boolean;
  lmsSupported?: boolean;
  permissionGranted: boolean;
  subscriptions: { id: number; label: string }[];
  defaultSubscriptionId: number | null;
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
