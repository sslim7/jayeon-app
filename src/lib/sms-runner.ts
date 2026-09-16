import type { Campaign, CampaignRecipient } from '@/types/sms';
import type { SmsAttachment, SmsDevice, SmsNativeResult } from '@/lib/sms-device-types';

export interface DispatchSnapshot {
  campaignId: string | null;
  running: boolean;
  stopping: boolean;
  currentRecipientId: string | null;
  error: string | null;
}
type Mutation = { campaign: Campaign; recipient: CampaignRecipient; dispatchAllowed: boolean };
export interface DispatchApi {
  attachmentContent?(id: string): Promise<{ id: string; name: string; mimeType: string; size: number; dataBase64: string }>;
  recipients(id: string): Promise<CampaignRecipient[]>;
  setStatus(id: string, status: 'SENDING' | 'CANCELLED'): Promise<Campaign>;
  claim(cid: string, rid: string, input: { attemptId: string }): Promise<Mutation>;
  retry(cid: string, rid: string): Promise<Mutation>;
  recordResult(cid: string, rid: string, input: {
    status: 'SENT' | 'FAILED'; attemptId: string; transport?: 'SMS' | 'LMS' | 'MMS'; errorCode?: string | null; errorMessage?: string | null;
  }): Promise<Mutation>;
}

export function needsOutcomeReview(row: Pick<CampaignRecipient, 'status' | 'errorCode'>): boolean {
  return row.status === 'UNKNOWN' || row.status === 'SENDING' ||
    row.errorCode === 'OUTCOME_UNKNOWN' || row.errorCode === 'PARTIAL_SENT';
}

// 한 JS 런타임당 한 발송 흐름만 허용한다. 별도 단말 경합은 서버의 원자적 claim이 막는다.
export class SmsRunner {
  private state: DispatchSnapshot = {
    campaignId: null, running: false, stopping: false, currentRecipientId: null, error: null,
  };
  private listeners = new Set<() => void>();
  private syncing: Promise<void> | null = null;
  constructor(private api: DispatchApi, private device: SmsDevice,
    private sessionVersion: () => number, private createId: () => string) {}

  getSnapshot = (): DispatchSnapshot => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(next: Partial<DispatchSnapshot>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }
  private assertSession(version: number) {
    if (version !== this.sessionVersion()) throw new Error('계정이 바뀌어 발송을 중단했어요. 이전 계정에서 결과를 확인해 주세요.');
  }
  stop = () => { if (this.state.running) this.update({ stopping: true }); };

  private async saveResult(campaignId: string, row: CampaignRecipient, result: SmsNativeResult, version: number) {
    this.assertSession(version);
    if (row.id !== result.campaignRecipientId || row.attemptId !== result.attemptId || row.phone !== result.phone) {
      throw new Error('단말 결과의 발송 대상이 일치하지 않아요. 재발송하지 말고 확인해 주세요.');
    }
    if (!['SENT', 'FAILED', 'UNKNOWN'].includes(result.status) || (result.status === 'SENT') !== result.success) {
      throw new Error('단말 발송 결과가 올바르지 않아요. 결과 확인이 필요해요.');
    }
    const status = result.status === 'SENT' ? 'SENT' : 'FAILED';
    const errorCode = result.status === 'UNKNOWN' ? 'OUTCOME_UNKNOWN' : result.errorCode;
    const saved = await this.api.recordResult(campaignId, row.id, {
      status, attemptId: result.attemptId, transport: result.transport,
      errorCode: status === 'FAILED' ? (errorCode || 'SMS_FAILED').slice(0, 100) : null,
      errorMessage: status === 'FAILED' ? (result.errorMessage || '단말 발송 결과를 확인해 주세요.').slice(0, 300) : null,
    });
    this.assertSession(version);
    if (saved.recipient.id !== row.id || saved.recipient.attemptId !== result.attemptId || saved.recipient.status !== status) {
      throw new Error('서버 저장 결과가 일치하지 않아요. 단말 결과를 보존하고 중단했어요.');
    }
    // 서버 커밋 확인 뒤에만 journal 결과를 정리한다. 그 전에 죽으면 다음 조회 때 다시 동기화한다.
    await this.device.acknowledge(result.attemptId);
    this.update({});
  }

  private async reconcile(campaignId: string, version: number) {
    const rows = await this.api.recipients(campaignId);
    this.assertSession(version);
    const results = await this.device.getResults();
    for (const result of results) {
      this.assertSession(version);
      const row = rows.find((item) => item.id === result.campaignRecipientId && item.attemptId === result.attemptId);
      // 다른 계정/캠페인의 원본 결과는 업로드하거나 삭제하지 않는다.
      if (!row) continue;
      if (row.status === 'SENDING') await this.saveResult(campaignId, row, result, version);
      else if (row.status === 'FAILED' && needsOutcomeReview(row) && result.status === 'SENT') {
        // 지연된 SENT가 확인되면 같은 attempt만 보정한다. 서버가 거절하면 journal을 남긴다.
        await this.saveResult(campaignId, row, result, version);
      }
      else if (row.status === 'SENT' || row.status === 'FAILED') await this.device.acknowledge(result.attemptId);
    }
  }

  // 조회 시에는 결과만 복구한다. 이 함수에서는 start/claim/send를 호출하지 않는다.
  sync = async (campaignId: string): Promise<void> => {
    if (this.state.running) return;
    if (this.syncing) { await this.syncing; return this.sync(campaignId); }
    const version = this.sessionVersion();
    this.syncing = this.reconcile(campaignId, version);
    try { await this.syncing; }
    finally { this.syncing = null; }
  };

  run = async (campaignId: string, options: { subscriptionId: number; retryRecipientIds?: string[] }): Promise<void> => {
    if (this.state.running) throw new Error('이미 발송 중이에요. 현재 발송을 먼저 마쳐 주세요.');
    this.update({ campaignId, running: true, stopping: false, currentRecipientId: null, error: null });
    const version = this.sessionVersion();
    try {
      if (this.syncing) await this.syncing;
      this.assertSession(version);
      const capabilities = await this.device.getCapabilities();
      if (!capabilities.supported || !capabilities.permissionGranted) throw new Error('Android SMS 권한과 SIM 준비를 확인해 주세요.');
      if (!capabilities.subscriptions.some((sim) => sim.id === options.subscriptionId)) throw new Error('발송할 SIM 회선을 선택해 주세요.');
      await this.reconcile(campaignId, version);
      let rows = await this.api.recipients(campaignId);
      this.assertSession(version);
      if (rows.some((row) => row.status === 'SENDING')) throw new Error('결과가 확인되지 않은 발송이 있어요. 재발송하지 말고 결과 동기화를 눌러 주세요.');
      for (const id of new Set(options.retryRecipientIds ?? [])) {
        const row = rows.find((item) => item.id === id);
        if (!row || row.status !== 'FAILED' || needsOutcomeReview(row)) throw new Error('확실하게 실패한 대상만 다시 보낼 수 있어요.');
        this.assertSession(version);
        if (this.state.stopping) break;
        await this.api.retry(campaignId, id);
      }
      rows = await this.api.recipients(campaignId);
      this.assertSession(version);
      if (this.state.stopping) { await this.api.setStatus(campaignId, 'CANCELLED'); return; }
      const retrySelection = options.retryRecipientIds ? new Set(options.retryRecipientIds) : null;
      const pending = rows.filter((row) => row.status === 'READY' && (!retrySelection || retrySelection.has(row.id)));
      if (!pending.length) return;
      // 파일 준비는 claim 전에 끝낸다. 다운로드 실패를 발송 여부 불명 상태로 만들지 않는다.
      const attachmentCache = new Map<string, SmsAttachment>();
      const prepared = new Map<string, SmsAttachment[]>();
      for (const row of pending) {
        const attachments = row.attachments ?? [];
        if (!attachments.length) continue;
        if (capabilities.mmsSupported !== true) throw new Error('이미지 발송을 지원하는 최신 Android 앱으로 업데이트해 주세요.');
        if (!this.api.attachmentContent || attachments.length > 3 || attachments.reduce((sum, file) => sum + file.size, 0) > 600 * 1024) {
          throw new Error('첨부파일 개수 또는 크기를 확인해 주세요.');
        }
        const files: SmsAttachment[] = [];
        for (const attachment of attachments) {
          this.assertSession(version);
          if (this.state.stopping) break;
          let file = attachmentCache.get(attachment.id);
          if (!file) {
            const content = await this.api.attachmentContent(attachment.id);
            this.assertSession(version);
            const data = content.dataBase64;
            const size = typeof data === 'string' ? data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0) : -1;
            if (content.id !== attachment.id || content.mimeType !== attachment.mimeType || content.size !== attachment.size ||
              !['image/jpeg', 'image/png'].includes(content.mimeType) || size !== content.size || size <= 0 || size > 300 * 1024 ||
              !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
              throw new Error('첨부파일 내용을 확인하지 못했어요. 발송을 중단했어요.');
            }
            file = { name: attachment.name, mimeType: content.mimeType, dataBase64: data };
            attachmentCache.set(attachment.id, file);
          }
          files.push(file);
        }
        prepared.set(row.id, files);
      }
      this.assertSession(version);
      if (this.state.stopping) { await this.api.setStatus(campaignId, 'CANCELLED'); return; }
      await this.api.setStatus(campaignId, 'SENDING');
      for (const row of pending) {
        this.assertSession(version);
        if (this.state.stopping) break;
        this.update({ currentRecipientId: row.id });
        const attemptId = this.createId();
        const claim = await this.api.claim(campaignId, row.id, { attemptId });
        this.assertSession(version);
        if (claim.dispatchAllowed !== true || claim.recipient.attemptId !== attemptId || claim.recipient.status !== 'SENDING' || claim.recipient.id !== row.id || claim.recipient.campaignId !== campaignId || claim.recipient.phone !== row.phone || claim.recipient.message !== row.message || JSON.stringify(claim.recipient.attachments ?? []) !== JSON.stringify(row.attachments ?? [])) {
          throw new Error('발송 허가를 확인하지 못했어요. 중복 발송을 피하기 위해 중단했어요.');
        }
        if (this.state.stopping) {
          await this.api.recordResult(campaignId, row.id, { status: 'FAILED', attemptId,
            errorCode: 'CANCELLED_BEFORE_SEND', errorMessage: 'SMS 요청 전에 사용자가 중단했어요.' });
          break;
        }
        const recipient = claim.recipient;
        const result = await this.device.send({
          campaignRecipientId: recipient.id, attemptId, phone: recipient.phone,
          message: recipient.message, subscriptionId: options.subscriptionId,
          attachments: prepared.get(row.id),
        });
        await this.saveResult(campaignId, recipient, result, version);
        if (result.status === 'UNKNOWN') throw new Error('발송 결과가 불확실해 중단했어요. 해당 대상은 자동으로 다시 보내지 않아요.');
      }
      this.assertSession(version);
      if (this.state.stopping) await this.api.setStatus(campaignId, 'CANCELLED');
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : '발송을 중단했어요. 결과를 확인해 주세요.' });
      throw error;
    } finally {
      this.update({ running: false, stopping: false, currentRecipientId: null });
    }
  };
}
