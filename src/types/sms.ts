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
