import type { Campaign, CampaignRecipient } from '@/types/sms';
import type { SmsAttachment, SmsDevice, SmsNativeResult } from '@/lib/sms-device-types';
/*
 * 🔴 **한도를 여기 숫자로 적지 않는다.** 이 검사는 발송 **직전**이라, 값이 서버·업로드 화면과
 * 어긋나면 사용자는 **붙일 때는 통과하고 보낼 때 거절당한다.** 그 실패는 캠페인을 만들고
 * 수신자를 고른 뒤에야 나오므로 가장 비싸다. 실제로 300KB 가 여기 박혀 있는 동안 서버가
 * 700KB 로 올라가 그 틈이 생겼다(→ `lib/attachment-file.ts`, `jayeon-was` assets.go).
 */
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT, ATTACHMENT_TOTAL_MAX_BYTES, base64Size } from '@/lib/attachment-file';

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
 * 시트가 결과 없이 사라졌다 — 네이티브가 매달린 약속을 거둬들인 자리.
 *
 * 🔴 `USER_CANCELLED`(사람이 닫았다)·`IOS_SEND_FAILED`(메시지 앱이 실패했다) 와 **다른 글자여야**
 * 나중에 「왜 안 갔지」를 볼 때 셋이 갈린다. `modules/nature-sms/ios-result.ts` 와 같은 값이어야 한다.
 */
export const IOS_COMPOSER_ABANDONED = 'IOS_COMPOSER_ABANDONED';
/** claim 까지 갔지만 보내기 전에 멈췄다. 실패가 아니라 **아직 안 보낸 사람**이다. */
export const CANCELLED_BEFORE_SEND = 'CANCELLED_BEFORE_SEND';
/**
 * 첨부가 **껍데기 다리를 건널 수 없을 만큼 크다** — 단말에 넘기기도 전에 막았다.
 *
 * 🔴 다른 실패와 글자를 갈라 둔다. 통신사 거절(`SMS_FAILED`)이나 권한 문제와 섞이면,
 * 「어떤 폰이 어디까지 보낼 수 있는가」를 결과 목록에서 읽을 수 없게 된다 — 지금 우리가
 * 기기별 실제 한도를 실험으로 찾는 중이라 그 구분이 곧 실험 결과다.
 */
export const ATTACHMENT_TOO_LARGE = 'ATTACHMENT_TOO_LARGE';

/** 바이트를 사람이 읽는 KB 로. 한도는 내림(넘겨 말하지 않는다), 실제 크기는 반올림한다. */
const limitKb = (bytes: number) => Math.floor(bytes / 1024);
const sizeKb = (bytes: number) => Math.max(1, Math.round(bytes / 1024));

/**
 * 첨부가 다리 폭을 넘었을 때 결과에 남기는 말.
 *
 * 🔴 **두 숫자를 모두 적는다 — 한도와 이번 첨부 크기.** 하나만 있으면 사용자는 다음에
 * 무엇을 올려야 할지 여전히 모르고, 기기마다 다른 경계를 실험으로 찾는 지금은 그 두 숫자가
 * 곧 실험 결과다. 숫자는 예산과 실제 크기에서 **계산**한다 — 손으로 적으면 한도를 고친 날
 * 문구만 옛말로 남는다.
 */
export function bridgeOversizeMessage(budgetBytes: number, attachmentBytes: number): string {
  return `이 폰은 첨부를 최대 ${limitKb(budgetBytes)} KB까지 보낼 수 있어요. 이 첨부는 ${sizeKb(attachmentBytes)} KB입니다. 더 작은 이미지로 바꿔 주세요.`;
}

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
 *
 * ⚠️ 결과 없이 사라진 시트(`IOS_COMPOSER_ABANDONED`)도 여기에 넣는다. iPhone 은 사람이 시트의
 * 「보내기」를 눌러야만 나가므로, 확인되지 않은 것은 **안 나갔다**고 보는 쪽이 실제에 가깝다.
 */
export function knownNotSent(result: Pick<SmsNativeResult, 'errorCode'>): boolean {
  return result.errorCode === USER_CANCELLED || result.errorCode === USER_SKIPPED ||
    result.errorCode === IOS_COMPOSER_ABANDONED;
}

/**
 * 다른 캠페인이 발송을 잡고 있는가. 잡고 있다면 **여기서 빠져나갈 길을 함께 돌려준다.**
 *
 * 🔴 러너는 앱당 하나뿐이라(`smsDispatch`) 한 캠페인이 잡으면 나머지 전부가 막힌다. 예전에는
 * 막혔다는 말만 하고 그 발송을 멈추거나 찾아갈 길을 주지 않아서, 앱을 껐다 켜는 것이 유일한
 * 탈출구였다 — 사용자가 알 길이 없는 탈출구는 없는 것과 같다.
 */
export interface DispatchBlock {
  /** 잡고 있는 캠페인. 🔴 null 이면 어느 캠페인인지조차 모르는 상태다. */
  campaignId: string | null;
  /** 그 캠페인 화면으로 갈 수 있는가. 어느 캠페인인지 알 때만 참이다. */
  canOpen: boolean;
  /** 🔴 **항상 참.** `stop()` 은 싱글턴을 멈추므로 어느 화면에서 눌러도 같은 흐름이 멈춘다. */
  canStop: boolean;
}
export function blockedByOther(snapshot: DispatchSnapshot, campaignId: string): DispatchBlock | null {
  if (!snapshot.running || snapshot.campaignId === campaignId) return null;
  return { campaignId: snapshot.campaignId, canOpen: !!snapshot.campaignId, canStop: true };
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
  /** 지금 떠 있는 한 건 확인창을 밖에서 끊는 손잡이. 창이 없으면 null 이다. */
  private cancelAsk: (() => void) | null = null;
  /**
   * `attachmentBudget` 은 **이 껍데기가 한 번에 받아 줄 수 있는 첨부 바이트**를 묻는 함수다
   * (→ `lib/sms-dispatch.ts` 에서 `bridgeAttachmentBudget(shellMessageMaxBytes())` 로 잇는다).
   *
   * 🔴 **왜 껍데기 쪽 검사만으로는 부족한가.** 껍데기가 「너무 크다」고 답해 주는 것은
   * 네이티브라 **새 APK 를 깔아야** 동작한다. 지금 사용자 폰에 깔린 옛 빌드는 크기를 넘는
   * 메시지를 **아무 말 없이 버리고**, 웹은 150초를 기다리다 포기하는데 그때는 이미 서버에
   * 수신자가 `SENDING` 으로 잠긴 뒤라 결과를 쓸 자리가 없다 — 그 사람은 영원히 「발송 중 ·
   * 확인 필요」로 남는다(2026-09-23 실제 사고). 러너는 **웹**이라 배포만으로 즉시 반영되고,
   * 껍데기가 자기 한도를 밝히지 않으면 옛 상한(64KB)으로 가정하므로
   * (→ `lib/sms-device.web.ts`) **옛 APK 가 깔린 폰에서도 갇히지 않고 깔끔하게 실패한다.**
   *
   * 주지 않으면 「모른다」로 보고 아무것도 막지 않는다 — 옛 호출부와 테스트가 그대로 돈다.
   */
  constructor(private api: DispatchApi, private device: SmsDevice,
    private sessionVersion: () => number, private createId: () => string,
    private attachmentBudget: () => number = () => Number.POSITIVE_INFINITY) {}

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
  /**
   * 발송을 멈춘다. 🔴 **어느 화면에서 불러도 된다** — 러너는 싱글턴이라 잡고 있는 캠페인이
   * 무엇이든 같은 흐름을 멈춘다.
   *
   * ⚠️ 한 건 확인창을 띄운 화면을 떠난 뒤였다면 그 창의 답이 영영 오지 않는다. 그래서 깃발만
   * 세우지 않고 **기다리던 답도 여기서 「중단」으로 끊는다.** 안 끊으면 루프가 답을 기다린 채
   * 남아 `running` 이 풀리지 않는다 — 앱을 껐다 켜야 했던 이유가 이것이다.
   *
   * 단말 시트가 떠 있는 동안(`device.send` 대기)은 여기서 끊지 않는다. 시트는 사람 눈앞에
   * 열려 있고, 그것을 거둬들이는 일은 네이티브가 한다(→ `modules/nature-sms/ios/NatureSmsModule.swift`).
   */
  stop = () => {
    if (!this.state.running) return;
    this.update({ stopping: true });
    this.cancelAsk?.();
  };

  /** 한 건 확인창을 띄우고 답을 기다린다. 답이 오지 않아도 `stop()` 으로 끊을 수 있다. */
  private ask(confirm: SendConfirm, prompt: SendPrompt): Promise<SendChoice> {
    return new Promise<SendChoice>((resolve, reject) => {
      let settled = false;
      const done = (choice: SendChoice) => {
        if (settled) return;
        settled = true;
        this.cancelAsk = null;
        resolve(choice);
      };
      this.cancelAsk = () => done('stop');
      confirm(prompt).then(done, (error: unknown) => {
        if (settled) return;
        settled = true;
        this.cancelAsk = null;
        reject(error);
      });
    });
  }

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
        // 아직 보내지 않은 대기 상태는 되돌릴 것이 없다. 「미발송 보내기」가 **대기와 내가 안
        // 보내기로 한 사람을 한 번에** 넘기기 때문에 둘이 같은 목록으로 들어온다.
        if (row?.status === 'READY') continue;
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
      /**
       * 다리를 못 건너는 수신자와 그 사유. **발송 전에 정해 두고, claim 뒤에 닫는다.**
       *
       * ⚠️ 여기서 캠페인 전체를 세우지 않는다. 같은 템플릿이면 모두 같은 결과가 나오겠지만,
       * 중단해 버리면 캠페인이 또 어중간하게 남아(일부는 READY, 일부는 SENDING) 사용자가
       * 무엇을 다시 눌러야 하는지 알 수 없다. 한 사람씩 사유를 적어 닫고 계속 간다.
       */
      const oversized = new Map<string, string>();
      const budget = this.attachmentBudget();
      for (const row of pending) {
        const attachments = row.attachments ?? [];
        if (!attachments.length) continue;
        // iPhone 은 앱 버전 문제가 아니라 기기/회선이 첨부를 막은 것이라 안내가 달라야 한다.
        if (capabilities.mmsSupported !== true) throw new Error(capabilities.composerConfirm
          ? '이 iPhone 에서는 이미지 첨부를 보낼 수 없어요. 메시지 설정의 MMS 를 확인해 주세요.'
          : '이미지 발송을 지원하는 최신 Android 앱으로 업데이트해 주세요.');
        if (!this.api.attachmentContent || attachments.length > ATTACHMENT_MAX_COUNT || attachments.reduce((sum, file) => sum + file.size, 0) > ATTACHMENT_TOTAL_MAX_BYTES) {
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
              !['image/jpeg', 'image/png'].includes(content.mimeType) || size !== content.size || size <= 0 || size > ATTACHMENT_MAX_BYTES ||
              !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
              throw new Error('첨부파일 내용을 확인하지 못했어요. 발송을 중단했어요.');
            }
            file = { name: attachment.name, mimeType: content.mimeType, dataBase64: data };
            attachmentCache.set(attachment.id, file);
          }
          files.push(file);
        }
        prepared.set(row.id, files);
        /*
         * 🔴 **업로드는 막지 않고 발송에서 막는다.** 붙이는 시점에 다리 폭으로 깎아 버리면
         * 모든 첨부가 같은 크기로 줄어들어 **어느 폰이 어디까지 보낼 수 있는지 실험할 수
         * 없다.** 지금은 기기별 실제 한도를 찾는 중이라, 크게 올려 보고 여기서 분명하게
         * 실패하는 편이 낫다 — 갇히지만 않으면 실패는 정보다.
         */
        const bytes = files.reduce((sum, file) => sum + base64Size(file.dataBase64), 0);
        if (bytes > budget) oversized.set(row.id, bridgeOversizeMessage(budget, bytes));
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
            CANCELLED_BEFORE_SEND, 'SMS 요청 전에 사용자가 중단했어요.');
          break;
        }
        /*
         * 🔴 **단말을 부르지 않고 이 사람만 실패로 닫는다.** 다리를 못 건널 것이 이미
         * 확실하므로 `device.send` 를 부르면 옛 껍데기에서는 답이 영영 오지 않고, 그 사이
         * 서버는 이 수신자를 `SENDING` 으로 잡고 있다. 확인창(iPhone)도 띄우지 않는다 —
         * 어차피 보낼 수 없는 건을 사람에게 물을 이유가 없다.
         */
        const tooLarge = oversized.get(row.id);
        if (tooLarge) {
          await this.closeWithoutSending(campaignId, row.id, attemptId, ATTACHMENT_TOO_LARGE, tooLarge);
          continue;
        }
        const recipient = claim.recipient;
        const message = personalizeMessage(recipient.message, recipient.name);
        // iPhone 은 한 건마다 사용자가 발송/통과/중단을 고른다. 안드로이드는 confirm 이 없어 곧장 보낸다.
        const choice: SendChoice = options.confirm
          ? await this.ask(options.confirm, {
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
            CANCELLED_BEFORE_SEND, 'SMS 요청 전에 사용자가 중단했어요.');
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
      this.cancelAsk = null;
      this.update({ running: false, stopping: false, currentRecipientId: null });
    }
  };
}
