import { api } from '@/lib/api';
import { canonicalStoredPhone } from '@/lib/phone';
import type {
  Attachment,
  MessageTemplate,
  TemplateInput,
  RecipientHistory,
  RecipientImport,
  Campaign,
  CampaignRecipient,
  CreateCampaignInput,
  DispatchResponse,
  Recipient,
  RecipientInput,
  RecipientCustomField,
  RecipientResultInput,
} from '@/types/sms';
const segment = encodeURIComponent;
const invalidResponse = () => new Error('서버 응답 형식을 확인할 수 없어요. 다시 시도해 주세요.');
function nullableArray<T>(value: unknown): T[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalidResponse();
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
  return value as Record<string, unknown>;
}
function withAttachments<T extends { attachments?: Attachment[] }>(value: T): T & { attachments: Attachment[] } {
  const data = record(value);
  const attachments = nullableArray<Attachment>(data.attachments);
  if (attachments.some((item) => !item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.name !== 'string')) throw invalidResponse();
  return { ...value, attachments };
}
function customFields(value: unknown): RecipientCustomField[] {
  const fields = nullableArray<RecipientCustomField>(value);
  if (fields.some((field) => !field || typeof field.name !== 'string' || typeof field.value !== 'string')) throw invalidResponse();
  return fields;
}
function normalizeRecipient(value: Recipient): Recipient {
  const data = record(value);
  const sentCount = data.sentCount ?? 0;
  if (typeof data.phone !== 'string') throw invalidResponse();
  if (typeof sentCount !== 'number' || !Number.isInteger(sentCount) || sentCount < 0) throw invalidResponse();
  return { ...value, phone: canonicalStoredPhone(data.phone), customFields: customFields(data.customFields), sentCount };
}
function normalizeImport(value: RecipientImport): RecipientImport {
  const data = record(value);
  return { ...value, items: nullableArray<RecipientImport['items'][number]>(data.items).map((item) => ({ ...item, customFields: customFields(record(item).customFields) })) };
}
function normalizeDispatch(value: DispatchResponse): DispatchResponse {
  record(value);
  return { ...value, campaign: withAttachments(value.campaign), recipient: withAttachments(value.recipient) };
}
async function allPages<T>(path: string, normalize: (value: T) => T = (value) => value): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: { items: T[]; nextCursor?: string | null } = await api.get(
      `${path}${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&cursor=${segment(cursor)}` : ''}`,
    );
    record(page);
    items.push(...nullableArray<T>(page.items).map(normalize));
    cursor = page.nextCursor ?? null;
    if (cursor !== null && typeof cursor !== 'string') throw invalidResponse();
    if (cursor && seen.has(cursor))
      throw new Error('목록을 끝까지 불러오지 못했어요. 다시 시도해 주세요.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}
export const recipientApi = {
  registerExternal: (id: string, input: { requestId: string; sentAt: string }): Promise<Recipient> => api.post<{ recipient: Recipient; history: RecipientHistory }>(`/recipients/${segment(id)}/external-sends`, input).then((result) => normalizeRecipient(result.recipient)),
  list(filters: { q?: string; groupId?: string; includeSent?: boolean } = {}): Promise<Recipient[]> {
    const query = Object.entries(filters)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return allPages<Recipient>(`/recipients${query ? `?${query}` : ''}`, normalizeRecipient).then((items) => items.sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id)));
  },
  history: (id: string): Promise<RecipientHistory[]> => allPages<RecipientHistory>(`/recipients/${segment(id)}/history`, withAttachments),
  importPreview: (input: { name: string; mimeType: string; dataBase64: string }) => api.post<RecipientImport>('/recipients/imports/preview', input).then(normalizeImport),
  importConfirm: (id: string) => api.post<RecipientImport>(`/recipients/imports/${segment(id)}/confirm`, {}).then(normalizeImport),
  create: (input: RecipientInput) => api.post<Recipient>('/recipients', input).then(normalizeRecipient),
  update: (id: string, input: RecipientInput) =>
    api.put<Recipient>(`/recipients/${segment(id)}`, input).then(normalizeRecipient),
  remove: (id: string) => api.delete<void>(`/recipients/${segment(id)}`),
};
const path = (id: string) => `/sms/campaigns/${segment(id)}`;
export const smsApi = {
  history: (q = ''): Promise<RecipientHistory[]> => allPages<RecipientHistory>(`/sms/history?q=${segment(q)}`, withAttachments),
  attachmentContent: (id: string) => api.get<Attachment & { dataBase64: string }>(`/sms/attachments/${segment(id)}/content`),
  list: (): Promise<Campaign[]> => allPages<Campaign>('/sms/campaigns', withAttachments),
  get: (id: string) => api.get<Campaign>(path(id)).then(withAttachments),
  async recipients(id: string): Promise<CampaignRecipient[]> {
    const page = await api.get<{ items: CampaignRecipient[] }>(`${path(id)}/recipients`);
    record(page);
    return nullableArray<CampaignRecipient>(page.items).map(withAttachments);
  },
  create: (input: CreateCampaignInput) => api.post<Campaign>('/sms/campaigns', input).then(withAttachments),
  setStatus: (id: string, status: 'SENDING' | 'CANCELLED') =>
    api.post<Campaign>(`${path(id)}/${status === 'SENDING' ? 'start' : 'cancel'}`).then(withAttachments),
  claim: (cid: string, rid: string, input: { attemptId: string }) =>
    api.patch<DispatchResponse>(`${path(cid)}/recipients/${segment(rid)}`, {
      status: 'SENDING',
      ...input,
    }).then(normalizeDispatch),
  recordResult: (cid: string, rid: string, input: RecipientResultInput) =>
    api.patch<DispatchResponse>(`${path(cid)}/recipients/${segment(rid)}`, input).then(normalizeDispatch),
  retry: (cid: string, rid: string) =>
    api.post<DispatchResponse>(`${path(cid)}/recipients/${segment(rid)}/retry`).then(normalizeDispatch),
};

export const attachmentApi = {
  upload: (input: { name: string; mimeType: string; dataBase64: string }) => api.post<Attachment>('/sms/attachments', input),
  content: (id: string) => api.get<Attachment & { dataBase64: string }>(`/sms/attachments/${segment(id)}/content`),
};
export const templateApi = {
  list: (): Promise<MessageTemplate[]> => allPages<MessageTemplate>('/sms/templates', withAttachments),
  get: (id: string) => api.get<MessageTemplate>(`/sms/templates/${segment(id)}`).then(withAttachments),
  create: (input: TemplateInput) => api.post<MessageTemplate>('/sms/templates', input).then(withAttachments),
  update: (id: string, input: TemplateInput) => api.put<MessageTemplate>(`/sms/templates/${segment(id)}`, input).then(withAttachments),
  remove: (id: string) => api.delete<void>(`/sms/templates/${segment(id)}`),
};
