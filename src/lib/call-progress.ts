/**
 * 분석 진행률·단계·경과 시간의 순수 계산 — 실행(`call-runtime.ts`)과 화면(`app/calls.tsx`,
 * `components/call-stages.tsx`)이 함께 쓴다.
 *
 * 🔴 **가짜 진행률을 만들지 않는다**(→ `docs/call-analysis.md`). 여기 있는 값은 전부 실제로
 * 끝난 일의 비율이다 — whisper 가 알려 준 진행률, 끝난 chunk 수, 실제로 잰 시각. 낼 수 없는
 * 단계는 `null` 을 돌려주고 화면은 막대 없이 단계 이름과 경과 시간만 보인다. 「대충 움직이는
 * 막대」는 멈춘 것과 도는 것을 구분하지 못하게 만들어, 이 기능이 풀려던 문제를 되살린다.
 */
import type { CallLive, CallStageKey, CallStatus, CallTiming } from '@/types/calls';

/** 화면에 보이는 네 단계. 내부 status 를 이 넷으로 묶는다. */
export const CALL_STAGES: CallStageKey[] = ['PREPARE', 'TRANSCRIBE', 'ANALYZE', 'UPLOAD'];
export const STAGE_LABELS: Record<CallStageKey, string> = { PREPARE: '분석 준비', TRANSCRIBE: '음성 변환', ANALYZE: '통화 분석', UPLOAD: '결과 저장' };

/**
 * status 가 머무는 단계. 성공으로 끝난 상태는 네 단계를 모두 지난 것이라 `4` 다.
 *
 * 실패 상태는 **멈춘 자리**를 가리킨다 — 「어디까지 갔는지」가 사용자가 볼 유일한 단서다.
 */
const STAGE_INDEX: Record<CallStatus, number> = {
  PENDING: 0, PREPARING: 0, TRANSCRIBING: 1, ANALYZING: 2, UPLOADING: 3,
  COMPLETED: 4,
  FAILED: 0, TRANSCRIPTION_FAILED: 1, ANALYSIS_FAILED: 2, UPLOAD_FAILED: 3, UPLOAD_REJECTED: 3,
};
const FAILURES: CallStatus[] = ['FAILED', 'TRANSCRIPTION_FAILED', 'ANALYSIS_FAILED', 'UPLOAD_FAILED', 'UPLOAD_REJECTED'];
/** 아직 끝나지 않은 상태. 스피너·막대·경과 시간이 붙는 자리다. */
export const ACTIVE_STATUSES: CallStatus[] = ['PENDING', 'PREPARING', 'TRANSCRIBING', 'ANALYZING', 'UPLOADING'];

export type StageState = 'done' | 'running' | 'failed' | 'pending';
export interface StageView { key: CallStageKey; label: string; state: StageState; ms: number | null; percent: number | null }

/** whisper.rn 의 `onProgress` 는 0~100 을 준다. 범위 밖·숫자 아닌 값은 버린다. */
export function transcribeProgress(value: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.floor(value)));
}

/**
 * 요약 통합의 묶음 크기. 구간 요약 4개를 **한 번에** 합친다.
 *
 * 둘씩 짝지어 올라가면 구간 n 개에 통합이 `n-1` 번 필요하다 — 구간 10개면 통합만 9번이고,
 * 그 9번이 각각 몇 분씩 걸린다. 4개씩 묶으면 같은 10개가 4번으로 줄어든다. 묶음 입력은
 * `SUMMARY_LIMIT`(600자) × 4 라 context 안에 들어온다(→ `lib/call-analysis.ts`).
 */
export const MERGE_FAN = 4;

/**
 * 구간 n 개를 하나로 줄이는 데 필요한 **통합 호출 수**. 진행률의 분모이자 실행 순서와 같은
 * 계산이어야 한다(→ `call-runtime.ts` 의 통합 루프). 묶음에 하나만 남으면 호출하지 않고
 * 그대로 올려 보낸다 — 요약 하나를 「합칠」 이유가 없다.
 */
export function mergeSteps(chunks: number): number {
  let remaining = Number.isFinite(chunks) ? Math.floor(chunks) : 0;
  let count = 0;
  while (remaining > 1) {
    const groups = Math.ceil(remaining / MERGE_FAN);
    const last = remaining - (groups - 1) * MERGE_FAN;
    count += last === 1 ? groups - 1 : groups;
    remaining = groups;
  }
  return count;
}

/**
 * 분석 진행률. chunk 하나가 한 몫이고 **요약 통합도 한 몫**이다 — 전체 몫은
 * `chunks + merges` 다.
 *
 * 통합을 몫에서 빼면 chunk 가 끝나는 순간 100% 가 되고, 그 뒤 통합이 도는 동안 100% 인 채로
 * 멈춰 보인다. 구간이 하나면 통합이 없어 그 하나가 전부다.
 *
 * `merges` 는 구간을 다 돌기 전에는 알 수 없다 — 분석하지 못해 빠진 구간이 있으면 통합도 그만큼
 * 줄어든다. 그래서 구간을 도는 동안은 **가장 많이 걸리는 경우**(`mergeSteps(chunks)`)를 쓰고,
 * 통합 단계에 들어서면 살아남은 구간 수로 다시 센다. 덜 나온 진행률은 정직하지만, 100% 를
 * 보이고도 계속 도는 것은 그렇지 않다.
 */
export function analysisProgress(done: number, chunks: number, merges: number = mergeSteps(chunks)): number {
  const total = Math.max(1, chunks + merges);
  return Math.max(0, Math.min(100, Math.floor(Math.min(done, total) / total * 100)));
}

/** 분석을 시작한 뒤 흐른 시간(ms). 시작 시각이 없거나 읽을 수 없으면 null. */
export function elapsedMs(timing: CallTiming | null | undefined, now: number): number | null {
  const started = timing?.started_at ? Date.parse(timing.started_at) : NaN;
  if (!Number.isFinite(started)) return null;
  const end = endOf(timing, now);
  if (end === null) return null;
  // 기기 시계가 뒤로 조정되면 음수가 나온다. 「-3초 경과」를 보이느니 0 으로 둔다.
  return Math.max(0, end - started);
}

/** 끝난 기록은 끝난 시각에서 멈춘다. 진행 중이면 지금이 끝이다. */
function endOf(timing: CallTiming | null | undefined, now: number): number | null {
  if (!timing?.finished_at) return now;
  const finished = Date.parse(timing.finished_at);
  return Number.isFinite(finished) ? finished : now;
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

/**
 * 진행 중이면 「3분 12초 경과」, 끝났으면 「4분 05초 걸렸습니다」.
 *
 * 경과 시간은 **분석을 시작한 시각부터의 벽시계 시간**이다. 분석은 앱이 앞에 있을 때만
 * 도므로(→ `call-runtime.ts`), 앱을 내려 둔 시간도 여기 포함된다. 「실제로 계산에 쓴 시간」이
 * 아니라 「기다린 시간」이라는 뜻이고, 사용자가 알고 싶은 것도 그쪽이다.
 */
export function elapsedLabel(timing: CallTiming | null | undefined, now: number): string {
  const elapsed = elapsedMs(timing, now);
  if (elapsed === null) return '';
  return timing?.finished_at ? `${formatDuration(elapsed)} 걸렸습니다` : `${formatDuration(elapsed)} 경과`;
}

/** 끝난 분석의 총 소요 시간. 끝나지 않았으면 빈 문자열 — 진행 중 표시는 `elapsedLabel` 이 맡는다. */
export function totalDurationLabel(timing: CallTiming | null | undefined): string {
  if (!timing?.finished_at) return '';
  // 끝난 기록은 현재 시각과 무관하다. 렌더 중에 시계를 읽지 않기 위해 0 을 넘긴다.
  const elapsed = elapsedMs(timing, 0);
  return elapsed === null ? '' : `${formatDuration(elapsed)} 걸렸습니다`;
}

/** 한 단계에 든 시간. 도는 중이면 지금까지, 끝났으면 저장된 합계. 잰 적이 없으면 null. */
export function stageMs(timing: CallTiming | null | undefined, stage: CallStageKey, now: number): number | null {
  const entry = timing?.stages?.[stage];
  if (!entry) return null;
  const saved = typeof entry.ms === 'number' && Number.isFinite(entry.ms) ? entry.ms : 0;
  const started = entry.started_at ? Date.parse(entry.started_at) : NaN;
  if (!Number.isFinite(started)) return saved > 0 ? saved : null;
  const end = endOf(timing, now);
  if (end === null) return saved > 0 ? saved : null;
  return saved + Math.max(0, end - started);
}

/**
 * 네 단계의 현재 모습. 목록 카드와 상세가 이것만 보고 그린다.
 *
 * 지나간 단계에 잰 시간이 없을 수 있다(이 기능 이전에 분석한 통화, 재개로 건너뛴 단계).
 * 그때는 시간을 지어내지 않고 `ms: null` 로 둔다 — 화면은 시간 없이 「완료」만 보인다.
 */
export function callStageViews(record: { status: CallStatus; progress?: number | null; timing?: CallTiming | null }, now: number): StageView[] {
  const current = STAGE_INDEX[record.status] ?? 0;
  const failed = FAILURES.includes(record.status);
  return CALL_STAGES.map((key, index) => {
    const state: StageState = index < current ? 'done' : index > current ? 'pending' : failed ? 'failed' : 'running';
    return {
      key,
      label: STAGE_LABELS[key],
      state,
      ms: state === 'pending' ? null : stageMs(record.timing, key, now),
      percent: state === 'running' && typeof record.progress === 'number' ? Math.max(0, Math.min(100, Math.floor(record.progress))) : null,
    };
  });
}

/** 목록 행에 쓰는 한 줄. 진행 중이면 「통화 분석 · 3분 12초 경과」. */
export function currentStageLabel(record: { status: CallStatus; timing?: CallTiming | null }): string {
  const index = STAGE_INDEX[record.status] ?? 0;
  return index >= CALL_STAGES.length ? '' : STAGE_LABELS[CALL_STAGES[index]];
}

/**
 * 부분 성공을 **숨기지 않는다.** 한 구간이 끝내 분석되지 않으면 그 구간은 결과에서 빠지는데,
 * 그 사실을 말하지 않으면 사용자는 통화 전체가 정리된 줄 안다.
 */
export function skippedNotice(timing: CallTiming | null | undefined): string {
  const llm = timing?.llm;
  if (!llm?.skipped) return '';
  return `구간 ${llm.chunks}개 중 ${llm.skipped}개는 분석하지 못해 결과에서 빠졌습니다.`;
}

/** 실패를 짚기 위한 숫자 한 줄. **통화 내용은 담지 않는다**(→ `lib/call-errors.ts`). */
export function diagnosticsLabel(timing: CallTiming | null | undefined): string {
  const llm = timing?.llm;
  if (!llm?.completions) return '';
  const parts = [`AI 호출 ${llm.completions}회`, `생성 ${llm.tokens} 토큰`];
  if (llm.tokens_per_second) parts.push(`${llm.tokens_per_second} 토큰/초`);
  if (llm.stopped_limit) parts.push(`출력 한도 도달 ${llm.stopped_limit}회`);
  if (llm.summary_only) parts.push(`요약만 추출 ${llm.summary_only}회`);
  if (llm.merge_fallbacks) parts.push(`요약 통합 대체 ${llm.merge_fallbacks}회`);
  return parts.join(' · ');
}

/**
 * 분석이 없는 통화에서 요약·상세·할 일·상담 분석 탭을 눌렀을 때 보여 줄 안내.
 *
 * 빈 화면은 「고장 났나?」로 읽힌다. **왜 비었는지**를 말해야 사용자가 다음에 무엇을 할지
 * 안다 — 진행 중이면 어느 단계인지, 실패했으면 이유(+코드)와 다시 시도하는 길이다.
 */
export function missingAnalysisNotice(record: { status: CallStatus; error?: string | null; timing?: CallTiming | null }, now: number): string {
  if (ACTIVE_STATUSES.includes(record.status)) {
    const elapsed = elapsedLabel(record.timing, now);
    return `AI 분석이 아직 끝나지 않았습니다. 현재 단계: ${currentStageLabel(record)}${elapsed ? ` · ${elapsed}` : ''}. 완료되면 이 탭에 내용이 나타납니다.`;
  }
  if (FAILURES.includes(record.status)) {
    return `${record.error || '분석을 완료하지 못했습니다.'} 목록에서 다시 시도하면 저장된 통화 원문부터 분석을 이어서 진행합니다.`;
  }
  return 'AI 분석이 완료되지 않아 아직 보여 드릴 내용이 없습니다. 통화 원문 탭에서 저장된 내용을 확인해 주세요.';
}

/**
 * 기기 분석이 **만들지 않는** 항목의 안내.
 *
 * 이 버전의 기기 분석은 요약·할 일·결정사항만 만든다(→ `lib/call-analysis.ts`). 상세 내용과
 * 상담 분석 탭을 빈 채로 두면 「고장 났나?」로 읽히므로, 없는 내용을 지어내는 대신 **왜
 * 비었는지**를 적는다.
 */
export function unavailableSectionNotice(section: string): string {
  return `${section}은 이 버전의 기기 분석에서 만들지 않습니다. 기기에서는 통화 요약과 할 일, 결정사항만 정리합니다. ${section}은 서버 분석이 준비되면 제공할 예정입니다.`;
}

/** 실제로 잰 속도만 말한다. 1초가 안 된 구간은 아직 속도라고 부를 값이 없어 null 이다. */
export function tokensPerSecond(tokens: number, ms: number): number | null {
  if (!Number.isFinite(tokens) || tokens <= 0 || !Number.isFinite(ms) || ms < 1000) return null;
  return Math.round(tokens / (ms / 1000) * 10) / 10;
}

const groupDigits = (value: number) => String(Math.floor(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * chunk 하나를 도는 동안 보여 줄 실시간 한 줄.
 *
 * 🔴 **생성 토큰 수를 `n_predict` 로 나눈 값은 완료율이 아니다** — 상한 대비 비율일 뿐이라
 * 그것으로 백분율을 만들면 거짓 진행률이 된다. 그래서 여기서는 **실제로 센 숫자만** 적는다.
 * 숫자가 1초마다 바뀌는 것 자체가 「멈추지 않았다」는 증거다.
 */
export function liveAnalysisText(live: CallLive | null | undefined): string {
  if (!live) return '';
  const parts: string[] = [];
  if (live.chunk === 0) parts.push('요약 통합 중');
  else if (live.chunks > 1) parts.push(`구간 ${live.chunk}/${live.chunks} 분석 중`);
  if (live.tokens > 0) parts.push(`${groupDigits(live.tokens)} 토큰`);
  if (live.tokens_per_second) parts.push(`${live.tokens_per_second} 토큰/초`);
  return parts.join(' · ');
}
