export type RecipientCustomField = { name: string; value: string };
export type RecipientInput = { name: string; phone: string; groupId: string; customFields?: RecipientCustomField[] };
export type Recipient = RecipientInput & { id: string; createdAt: string; updatedAt: string; latestSentAt?: string | null; sentCount: number };
export type CampaignStatus = 'READY' | 'SENDING' | 'COMPLETED' | 'PARTIAL_FAILED' | 'CANCELLED';
export type RecipientStatus = 'READY' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN';
export type Campaign = {
  id: string;
  title: string;
  message: string;
  status: CampaignStatus;
  /** 「예약하기」로 만든 것만 true. 발송 준비로 만들어 두고 보내지 않은 문자와 구분한다(서버가 주기 전에는 false). */
  reserved: boolean;
  recipientCount: number;
  attachments?: Attachment[];
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
};
export type CampaignRecipient = {
  id: string;
  campaignId: string;
  recipientId: string;
  attachments?: Attachment[];
  name: string;
  phone: string;
  message: string;
  status: RecipientStatus;
  transport?: 'SMS' | 'LMS' | 'MMS';
  attemptId?: string;
  sentAt?: string | null;
  failedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CreateCampaignInput = {
  title: string;
  message: string;
  recipientIds: string[];
  requestId: string;
  attachmentIds?: string[];
  /** 생략하면 서버가 false 로 본다. 예약으로 저장할 때만 true 를 보낸다. */
  reserved?: boolean;
};
export type RecipientResultInput = {
  status: 'SENT' | 'FAILED';
  transport?: 'SMS' | 'LMS' | 'MMS';
  attemptId: string;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type DispatchResponse = {
  campaign: Campaign;
  recipient: CampaignRecipient;
  dispatchAllowed: boolean;
};

export type Attachment = { id: string; name: string; mimeType: string; size: number; createdAt: string };
export type MessageTemplate = { id: string; name: string; message: string; attachments: Attachment[]; createdAt: string; updatedAt: string };
export type TemplateInput = { name: string; message: string; attachmentIds: string[] };
export type RecipientHistory = Omit<CampaignRecipient, 'campaignId'> & { campaignId?: string; campaignTitle: string; source?: 'ANDROID' | 'EXTERNAL' };
export type RecipientImport = {
  id: string;
  addedCount: number;
  excludedCount: number;
  items: { row: number; name: string; phone: string; groupId: string; customFields?: RecipientCustomField[]; status: 'ADD' | 'EXCLUDED'; reason: string }[];
  createdAt: string;
};
