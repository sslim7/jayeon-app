/**
 * 진행 상태의 순수 계산 — 등록 시트(`components/call-create.tsx`)와 목록(`app/calls/index.tsx`),
 * 단계 카드(`components/call-stages.tsx`)가 함께 쓴다.
 *
 * 🔴 **가짜 진행률을 만들지 않는다.** 여기 있는 값은 둘 중 하나다 — 앱이 직접 센 업로드
 * 바이트, 또는 서버가 보낸 `progress`/`stage`. 낼 수 없는 값은 `null` 을 돌려주고 화면은
 * 막대 없이 단계 이름만 보인다. 「대충 움직이는 막대」는 멈춘 것과 도는 것을 구분하지 못하게
 * 만들어, 이 기능이 풀려던 문제를 되살린다.
 */
import type { CallStageKey, CallStatus } from '@/types/calls';

/**
 * 화면에 보이는 네 단계.
 *
 * 서버 파이프라인의 흐름 그대로다: 앱이 파일을 올리고(업로드) → 서버가 받아쓰고(음성 변환)
 * → 내용을 정리하고(분석) → 끝난다(완료).
 */
export const CALL_STAGES: CallStageKey[] = ['UPLOAD', 'TRANSCRIBE', 'ANALYZE', 'DONE'];
export const STAGE_LABELS: Record<CallStageKey, string> = { UPLOAD: '업로드', TRANSCRIBE: '음성 변환', ANALYZE: '분석', DONE: '완료' };

/**
 * status 가 머무는 단계.
 *
 * 서버가 주는 status 는 일곱 개뿐이고(§`internal/calls/model.go` 의 `appStatus`), 나머지는
 * 업로드 중이거나 옛 기기 기록이다. 실패 상태는 **멈춘 자리**를 가리킨다 — 「어디까지
 * 갔는지」가 사용자가 볼 유일한 단서다.
 *
 * `PENDING`(=AWAITING_UPLOAD)은 서버가 업로드를 기다리는 상태라 업로드 단계에 둔다.
 * `PREPARING`(=QUEUED)은 업로드가 끝나고 전사 차례를 기다리는 상태라 음성 변환 단계다 —
 * 그 안에서 「순서 기다리는 중」인지 「받아쓰는 중」인지는 서버의 `stage` 한 줄이 말해 준다.
 */
const STAGE_INDEX: Record<CallStatus, number> = {
  PENDING: 0, UPLOADING: 0, UPLOAD_FAILED: 0, UPLOAD_REJECTED: 0, FAILED: 0,
  PREPARING: 1, TRANSCRIBING: 1, TRANSCRIPTION_FAILED: 1,
  ANALYZING: 2, ANALYSIS_FAILED: 2,
  // 끝난 통화는 네 단계를 모두 지났다. 마지막 「완료」 칸까지 done 으로 칠해야 한다.
  COMPLETED: 4,
};
export const FAILED_STATUSES: CallStatus[] = ['FAILED', 'TRANSCRIPTION_FAILED', 'ANALYSIS_FAILED', 'UPLOAD_FAILED', 'UPLOAD_REJECTED'];
/** 아직 끝나지 않은 상태. 폴링·스피너·경과 시간이 붙는 자리다. */
export const ACTIVE_STATUSES: CallStatus[] = ['PENDING', 'PREPARING', 'TRANSCRIBING', 'ANALYZING', 'UPLOADING'];

export const isActive = (status: CallStatus) => ACTIVE_STATUSES.includes(status);
export const isFailed = (status: CallStatus) => FAILED_STATUSES.includes(status);

export type StageState = 'done' | 'running' | 'failed' | 'pending';
export interface StageView { key: CallStageKey; label: string; state: StageState; percent: number | null }

/**
 * 서버가 주는 0~1 진행률을 화면용 백분율로 바꾼다.
 *
 * 🔴 범위 밖·숫자 아닌 값은 **버린다**(null). 기기 분석 시절의 0~100 정수가 섞여 들어오면
 * 100 은 1 을 넘으므로 여기서 걸린다 — 잘못 읽은 값으로 막대를 그리느니 막대를 지운다.
 */
export function percentOf(progress: number | null | undefined): number | null {
  if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1) return null;
  return Math.floor(progress * 100);
}

/**
 * 네 단계의 현재 모습. 목록 카드와 등록 시트가 이것만 보고 그린다.
 *
 * 막대는 **도는 단계에만, 실제 값이 있을 때만** 선다. 업로드 단계의 값은 앱이 센 바이트이고
 * 서버 단계의 값은 서버가 보낸 전체 진행률이다 — 뜻이 다르므로 부르는 쪽이 라벨을 달리 적는다
 * (→ `components/call-stages.tsx`).
 */
export function callStageViews(record: { status: CallStatus; progress?: number | null }): StageView[] {
  const current = STAGE_INDEX[record.status] ?? 0;
  const failed = isFailed(record.status);
  return CALL_STAGES.map((key, index) => {
    const state: StageState = index < current ? 'done' : index > current ? 'pending' : failed ? 'failed' : 'running';
    return { key, label: STAGE_LABELS[key], state, percent: state === 'running' ? percentOf(record.progress) : null };
  });
}

/** 목록 행에 쓰는 단계 이름. 끝난 통화는 빈 문자열이다. */
export function currentStageLabel(record: { status: CallStatus }): string {
  const index = STAGE_INDEX[record.status] ?? 0;
  return index >= CALL_STAGES.length ? '' : STAGE_LABELS[CALL_STAGES[index]];
}

/**
 * 지금 무슨 일이 벌어지고 있는지 한 줄.
 *
 * **서버가 보낸 `stage` 를 그대로 쓴다**(「받아쓰는 중」). 서버가 말해 주지 않으면 앱의 단계
 * 이름으로 대신한다 — 옛 기기 기록에는 이 값이 없다.
 */
export function stageText(record: { status: CallStatus; stage?: string | null }): string {
  const given = typeof record.stage === 'string' ? record.stage.trim() : '';
  return given || currentStageLabel(record);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0초';
  const total = Math.floor(ms / 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}시간 ${pad(minutes)}분`;
  if (minutes > 0) return `${minutes}분 ${pad(seconds)}초`;
  return `${seconds}초`;
}

/** 등록한 뒤 흐른 시간(ms). 읽을 수 없는 시각이면 null — 지어내지 않는다. */
export function elapsedMs(createdAt: string | null | undefined, now: number): number | null {
  const started = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(started)) return null;
  // 기기 시계가 서버보다 뒤처지면 음수가 나온다. 「-3초 경과」를 보이느니 0 으로 둔다.
  return Math.max(0, now - started);
}

/**
 * 「3분 12초 경과」.
 *
 * 🔴 **진행 중인 통화에만 쓴다.** 끝난 통화에 붙이면 등록 시각부터 지금까지를 세어 「3일
 * 경과」가 된다 — 서버는 단계별 소요 시간을 주지 않으므로 여기서 지어낼 수 있는 값이 없다.
 */
export function elapsedLabel(record: { status: CallStatus; created_at?: string | null }, now: number): string {
  if (!isActive(record.status)) return '';
  const elapsed = elapsedMs(record.created_at, now);
  return elapsed === null ? '' : `${formatDuration(elapsed)} 경과`;
}

/**
 * 보여 줄 분석이 없는 통화의 보고서 자리에 대신 서는 안내.
 *
 * 빈 화면은 「고장 났나?」로 읽힌다. **왜 비었는지**를 말해야 사용자가 다음에 무엇을 할지
 * 안다 — 진행 중이면 어느 단계인지, 실패했으면 이유와 다시 시도하는 길이다.
 */
export function missingAnalysisNotice(record: { status: CallStatus; stage?: string | null; error?: string | null; created_at?: string | null }, now: number, reason = '', retryable = true): string {
  if (isActive(record.status)) {
    const elapsed = elapsedLabel(record, now);
    return `분석이 아직 끝나지 않았습니다. 현재 단계: ${stageText(record)}${elapsed ? ` · ${elapsed}` : ''}. 완료되면 여기에 보고서가 나타납니다.`;
  }
  if (isFailed(record.status)) {
    /*
      🔴 **다시 시도하는 길은 목록에 버튼이 설 때만 안내한다.** 버튼이 서지 않는 실패에
      「목록에서 다시 시도하면」을 적으면, 사용자는 있지도 않은 버튼을 찾아 목록을 뒤진다.
      설지 말지는 실패 코드가 정하므로 호출부가 판단해 넘긴다(§`lib/call-errors.ts` 의
      `callRetryable` — 이 파일은 코드 해석을 알지 못한다).
    */
    const base = reason || '분석을 완료하지 못했습니다.';
    return retryable ? `${base} 목록에서 다시 시도하면 저장된 통화 원문으로 분석만 다시 진행합니다.` : base;
  }
  /*
    🔴 **여기서 「아래 「통화 원문」에서」라고 말하지 않는다.** 원문은 이 문서 안의 구획이
    아니라 형제 화면이 됐고(→ `app/calls/[id]/transcript.tsx`), 무엇보다 **원문이 없는
    통화에도 이 줄이 나온다** — 없는 곳을 가리키면 사용자는 있지도 않은 칸을 찾아 화면을
    훑는다. 갈 곳이 있을 때만 호출부가 그 자리에 버튼을 세운다(→ `components/call-report.tsx`).
  */
  return '분석이 완료되지 않아 아직 보여 드릴 내용이 없습니다. 저장된 통화 원문이 있다면 그것부터 확인해 주세요.';
}
