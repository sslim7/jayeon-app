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

/** 보내는 사람이 이 대상을 일부러 건너뛰었다. 시트를 열었다 닫은 것과 다른 이야기다. */
export const USER_SKIPPED = 'USER_SKIPPED';
/** 시트를 열었지만 보내지 않고 닫았다. `modules/nature-sms/ios-result.ts` 와 같은 값이어야 한다. */
export const USER_CANCELLED = 'USER_CANCELLED';

/**
 * 한 건을 보내기 직전에 사용자에게 묻는 창구.
 *
 * 🔴 **iPhone 에만 쓴다.** iOS 는 시스템 작성 시트에서 사람이 「보내기」를 눌러야 나가므로
 * 다음 사람으로 넘어가기 전에 발송/통과/중단을 고르게 한다. 안드로이드는 이 값을 주지
 * 않으며, 주지 않으면 발송 루프는 예전과 한 글자도 다르지 않게 돈다.
 */
export type SendChoice = 'send' | 'skip' | 'stop';
export interface SendPrompt {
  campaignRecipientId: string;
  name: string;
  phone: string;
  /** 치환까지 끝난 실제 본문. 사용자가 보게 될 그대로다. */
  message: string;
  /** 1부터 센다. */
  index: number;
  total: number;
}
export type SendConfirm = (prompt: SendPrompt) => Promise<SendChoice>;

/** 「통과」를 서버에 남길 결과. 단말은 호출조차 하지 않았다. */
export function skippedResult(
  target: Pick<SmsNativeResult, 'campaignRecipientId' | 'phone'>, attemptId: string,
): SmsNativeResult {
  return {
    campaignRecipientId: target.campaignRecipientId, attemptId, phone: target.phone,
    success: false, status: 'FAILED', errorCode: USER_SKIPPED,
    errorMessage: '보내는 사람이 이 대상을 건너뛰었어요.',
  };
}

/**
 * 「나갔는지 모른다」가 아니라 「안 나갔다」를 아는 결과인가.
 *
 * 🔴 iOS 의 취소는 status 가 `UNKNOWN` 으로 온다 — 통신사 확정 결과가 없다는 뜻이다. 하지만
 * 사용자가 눈앞에서 닫은 것이라 **나가지 않았다는 것은 확실하다.** 이 둘을 섞으면 두 가지가
 * 망가진다: 사유가 `OUTCOME_UNKNOWN` 으로 덮여 「왜 안 갔지」를 못 보고, 실수로 한 건 닫은
 * 것이 25명짜리 일괄 발송 전체를 세운다.
 */
export function knownNotSent(result: Pick<SmsNativeResult, 'errorCode'>): boolean {
  return result.errorCode === USER_CANCELLED || result.errorCode === USER_SKIPPED;
}

/** 캠페인 본문의 수신자 치환 토큰을 발송 직전에 해석한다. */
export function personalizeMessage(message: string, name: string): string {
  return message.replaceAll('@name', name);
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
    // 안 나간 것이 확실한 결과(통과·시트 취소)는 사유를 그대로 남긴다 — 덮으면 나중에 못 가린다.
    const errorCode = result.status === 'UNKNOWN' && !knownNotSent(result) ? 'OUTCOME_UNKNOWN' : result.errorCode;
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

  /** claim 을 마친 대상을 보내지 않고 끝낸다. 서버에 SENDING 으로 남겨 두지 않기 위한 마무리다. */
  private async closeWithoutSending(campaignId: string, recipientId: string, attemptId: string,
    errorCode: string, errorMessage: string) {
    await this.api.recordResult(campaignId, recipientId, { status: 'FAILED', attemptId, errorCode, errorMessage });
  }

  run = async (campaignId: string, options: {
    subscriptionId: number; retryRecipientIds?: string[]; subject?: string;
    /** iPhone 전용. 주지 않으면 한 건씩 묻지 않고 예전 그대로 이어서 보낸다. */
    confirm?: SendConfirm;
  }): Promise<void> => {
    if (this.state.running) throw new Error('이미 발송 중이에요. 현재 발송을 먼저 마쳐 주세요.');
    this.update({ campaignId, running: true, stopping: false, currentRecipientId: null, error: null });
    const version = this.sessionVersion();
    try {
      if (this.syncing) await this.syncing;
      this.assertSession(version);
      const capabilities = await this.device.getCapabilities();
      if (!capabilities.supported || !capabilities.permissionGranted) throw new Error('문자 발송 권한과 SIM 준비를 확인해 주세요.');
      // 🔴 회선 선택이 없는 플랫폼(iPhone)에서는 고를 회선 자체가 없다. 안드로이드는 예전처럼
      // 반드시 활성 SIM 중 하나여야 한다 — 예전 빌드는 이 값을 주지 않아 undefined 로 온다.
      if (capabilities.lineSelectable !== false && !capabilities.subscriptions.some((sim) => sim.id === options.subscriptionId)) {
        throw new Error('발송할 SIM 회선을 선택해 주세요.');
      }
      await this.reconcile(campaignId, version);
      let rows = await this.api.recipients(campaignId);
      this.assertSession(version);
      if (rows.some((row) => row.status === 'SENDING')) throw new Error('결과가 확인되지 않은 발송이 있어요. 재발송하지 말고 결과 다시 확인을 눌러 주세요.');
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
        // iPhone 은 앱 버전 문제가 아니라 기기/회선이 첨부를 막은 것이라 안내가 달라야 한다.
        if (capabilities.mmsSupported !== true) throw new Error(capabilities.composerConfirm
          ? '이 iPhone 에서는 이미지 첨부를 보낼 수 없어요. 메시지 설정의 MMS 를 확인해 주세요.'
          : '이미지 발송을 지원하는 최신 Android 앱으로 업데이트해 주세요.');
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
      for (const [position, row] of pending.entries()) {
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
          await this.closeWithoutSending(campaignId, row.id, attemptId,
            'CANCELLED_BEFORE_SEND', 'SMS 요청 전에 사용자가 중단했어요.');
          break;
        }
        const recipient = claim.recipient;
        const message = personalizeMessage(recipient.message, recipient.name);
        // iPhone 은 한 건마다 사용자가 발송/통과/중단을 고른다. 안드로이드는 confirm 이 없어 곧장 보낸다.
        const choice: SendChoice = options.confirm
          ? await options.confirm({
            campaignRecipientId: recipient.id, name: recipient.name, phone: recipient.phone,
            message, index: position + 1, total: pending.length,
          })
          : 'send';
        this.assertSession(version);
        if (choice === 'skip') {
          // 🔴 claim 을 마친 대상이라 결과를 남겨야 한다. 「통과」는 서버에서 시트 취소와 구별된다.
          await this.saveResult(campaignId, recipient, skippedResult(
            { campaignRecipientId: recipient.id, phone: recipient.phone }, attemptId,
          ), version);
          continue;
        }
        if (choice === 'stop') {
          this.update({ stopping: true });
          await this.closeWithoutSending(campaignId, row.id, attemptId,
            'CANCELLED_BEFORE_SEND', 'SMS 요청 전에 사용자가 중단했어요.');
          break;
        }
        const result = await this.device.send({
          campaignRecipientId: recipient.id, attemptId, phone: recipient.phone,
          message, subject: options.subject, subscriptionId: options.subscriptionId,
          attachments: prepared.get(row.id),
        });
        await this.saveResult(campaignId, recipient, result, version);
        // 시트를 열었다 닫은 것은 불확실이 아니다 — 안 나간 것을 알고 있으니 다음 사람으로 간다.
        if (result.status === 'UNKNOWN' && !knownNotSent(result)) throw new Error('발송 결과가 불확실해 중단했어요. 해당 대상은 자동으로 다시 보내지 않아요.');
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
