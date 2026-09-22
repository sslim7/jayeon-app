/**
 * 폰 받아쓰기 엔진의 **순수한 부분** — 청크 계산, 이어하기 상태, 진행률.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **여기에는 네이티브 import 가 하나도 없다.** whisper.rn 을 부르는 순간 웹 번들이   │
 * │ 깨지고, 그러면 이 계산들을 `node --test` 로 확인할 길도 함께 사라진다. 엔진의 판단은   │
 * │ 전부 이 파일에 모아 두고, `asr-local.ts` 는 파일과 세션만 만진다.                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
import type { AsrModelId } from './asr-models';

/**
 * 한 번에 전사하는 길이.
 *
 * 🔴 **2분이 「중단됐을 때 잃는 최대치」다.** 이 값을 키우면 저장이 드물어져 손실이 커지고,
 * 줄이면 창 경계가 잦아져 문장이 더 자주 잘린다. 28분 통화 = 14청크.
 *
 * ⚠️ whisper 의 내부 창은 30초다. 120초는 그 배수라 창이 어긋나지 않는다.
 */
export const ASR_CHUNK_MS = 120_000;

/**
 * 저장 형식이 바뀌면 올린다. 옛 상태를 새 코드가 잘못 읽고 이어가는 것보다 버리는 편이 낫다.
 *
 * ⚠️ **`segments` 를 더할 때는 올리지 않았다.** 올리면 실기기에서 진행 중인 받아쓰기가
 * 전부 버려져 처음부터 다시 돈다 — 28분짜리에서는 그것이 더 큰 손해다. 대신 새 필드는
 * **없어도 되는 값**으로 두고(아래 `isAsrLocalState`), 옛 상태를 이어받으면 구간 없이 간다.
 */
export const ASR_STATE_VERSION = 1;

/**
 * 받아쓴 **구간 하나.**
 *
 * 🔴 **시각은 파일 처음부터 잰 ms 다.** 청크 안에서의 시각이 아니다 — 오프셋은 이미
 * 더해져 있다(→ 아래 `asrChunkSegments`).
 *
 * 🔴 **화자가 없다.** whisper 는 누가 말했는지 모른다. 필드를 만들어 두면 언젠가 누군가
 * 채우고 싶어지고, 그 순간 화면이 짐작을 사실처럼 그린다.
 */
export type AsrLocalSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

/** 어느 구간을 돌릴 것인가. 파일을 자르지 않고 `transcribeAsr` 의 창으로 넘긴다. */
export type AsrChunk = {
  /** 파일 처음부터 센 청크 번호(0부터). 이어할 때도 이 번호는 그대로다. */
  index: number;
  offsetMs: number;
  /** 🔴 마지막 청크는 120초보다 짧다. 넘겨 부르면 whisper 가 없는 구간을 읽는다. */
  durationMs: number;
};

/**
 * 디스크에 남는 이어하기 상태.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **완료된 청크만 들어간다.** 돌다 만 청크의 텍스트는 절대 넣지 않는다 — 넣으면 같은  │
 * │ 구간을 다시 돌렸을 때 그 절반이 결과에 두 번 남고, 어디가 겹쳤는지 알 수 없다.        │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
export type AsrLocalState = {
  version: number;
  /** 어느 통화인가. 파일 이름이 되므로 안전한 글자만 받는다. */
  callId: string;
  /** 16kHz WAV 경로. 🔴 이 경로가 달라지면 저장된 오프셋은 의미가 없다. */
  wavUri: string;
  /** 사용자가 고른 원본. 「무엇을 받아쓰던 중이었나」를 화면이 말할 수 있어야 한다. */
  sourceName: string;
  sourceBytes: number;
  modelId: AsrModelId;
  /** 전체 길이(ms). 진행률의 분모이자 마지막 청크 길이의 근거다. */
  totalMs: number;
  /** 다음에 시작할 지점(ms). **여기까지는 확실히 끝났다**는 뜻이다. */
  nextOffsetMs: number;
  /** 완료된 청크의 텍스트들. 순서가 곧 시간 순서다. */
  pieces: string[];
  /**
   * 완료된 청크들의 구간. 시각은 **파일 처음부터** 잰 것이다.
   *
   * ┌────────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 **없을 수 있다 — 그리고 그것이 「구간이 하나도 없다」와 같은 뜻이 아니다.** 구간을  │
   * │ 모으기 전에 저장된 옛 상태에는 이 필드가 아예 없다. 그런 상태를 이어받으면 앞의       │
   * │ 12분치 구간을 **되찾을 길이 없으므로**, 뒤쪽만 모아 놓고 「구간이 있다」고 말하지      │
   * │ 않는다 — 앞이 통째로 빠진 대화가 완성본으로 보이는 편이 훨씬 나쁘다. 그때는           │
   * │ `undefined` 인 채로 끝까지 가고 글만 보낸다(→ `asr-local.ts`).                   │
   * └────────────────────────────────────────────────────────────────────────────┘
   */
  segments?: AsrLocalSegment[];
  /**
   * 끝난 청크들에 **실제로 쓴 시간의 합**(ms).
   *
   * 🔴 **벽시계로 잰 `updatedAt - startedAt` 과 다르다.** 그 사이에는 사용자가 멈춰 둔 시간,
   * 앱이 백그라운드에서 얼어 있던 시간이 통째로 들어간다. 여기에는 **완료된 청크에 든 시간만**
   * 쌓는다 — 돌다 만 청크는 어차피 다시 도므로 세지 않는다(`pieces` 와 같은 규칙이다).
   *
   * ┌────────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 **없을 수 있다.** 이 필드가 생기기 전에 저장된 상태에는 아예 없고, 그때 **버전을     │
   * │ 올리지 않았다** — 올렸으면 실기기에서 진행 중인 받아쓰기가 전부 버려져 28분을 처음부터 │
   * │ 다시 돈다(`segments` 때와 같은 판단이다, 위 `ASR_STATE_VERSION` 주석). 없다는 것은   │
   * │ 「앞부분에 쓴 시간을 모른다」는 뜻이고, 그때는 **이번 실행분부터만** 센다.             │
   * └────────────────────────────────────────────────────────────────────────────┘
   */
  workedMs?: number;
  startedAt: number;
  updatedAt: number;
};

/** 엔진을 부를 때 주는 것. 상태가 이미 있으면 여기 값 대신 저장된 값이 이긴다. */
export type AsrLocalInput = {
  callId: string;
  wavUri: string;
  sourceName: string;
  sourceBytes: number;
  modelId: AsrModelId;
  totalMs: number;
};

/**
 * 화면에 내보내는 진행 상황.
 *
 * 🔴 **`ratio` 는 지어낸 값이 아니다.** 끝난 청크의 오프셋을 전체 길이로 나눈 것뿐이다.
 * 시간으로 추정한 값은 여기 없다.
 */
export type AsrLocalProgress = {
  /** 0~1. `nextOffsetMs / totalMs`. */
  ratio: number;
  doneMs: number;
  totalMs: number;
  /** 지금 도는 청크 번호(0부터). 끝났으면 `chunkCount` 와 같다. */
  chunkIndex: number;
  chunkCount: number;
  /**
   * 지금 청크 안에서의 진행률(0~100). ⚠️ **whisper.cpp 가 준 값**이고 우리가 센 것이 아니다.
   * 아직 한 번도 오지 않았으면 `null` — 0 으로 채우면 「시작했다」는 거짓말이 된다.
   */
  chunkPercent: number | null;
};

/** 전체 청크 수. 끝자락이 짧아도 한 개로 센다. */
export function asrChunkCount(totalMs: number): number {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0;
  return Math.ceil(totalMs / ASR_CHUNK_MS);
}

/**
 * `fromMs` 부터 끝까지의 청크 목록.
 *
 * ⚠️ 마지막 청크는 남은 만큼만이다. 28분 26초(1,706,000ms)면 120초짜리 14개 + 26초 1개 =
 * 15개이고, 마지막 하나의 `durationMs` 는 26,000 이다.
 */
export function asrChunks(totalMs: number, fromMs = 0): AsrChunk[] {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return [];
  const chunks: AsrChunk[] = [];
  let offsetMs = Math.max(0, Math.floor(Number.isFinite(fromMs) ? fromMs : 0));
  while (offsetMs < totalMs) {
    chunks.push({ index: Math.floor(offsetMs / ASR_CHUNK_MS), offsetMs, durationMs: Math.min(ASR_CHUNK_MS, totalMs - offsetMs) });
    offsetMs += ASR_CHUNK_MS;
  }
  return chunks;
}

/** 이 지점에서 돌릴 청크 하나. 이미 끝까지 갔으면 `null`. */
export function asrChunkAt(totalMs: number, offsetMs: number): AsrChunk | null {
  if (!Number.isFinite(totalMs) || !Number.isFinite(offsetMs)) return null;
  if (offsetMs < 0 || offsetMs >= totalMs) return null;
  return { index: Math.floor(offsetMs / ASR_CHUNK_MS), offsetMs, durationMs: Math.min(ASR_CHUNK_MS, totalMs - offsetMs) };
}

/** 0~1 로 자른 진행률. 분모가 없으면 0 이다 — 모르면서 1 을 말하지 않는다. */
export function asrLocalRatio(state: Pick<AsrLocalState, 'nextOffsetMs' | 'totalMs'>): number {
  if (!Number.isFinite(state.totalMs) || state.totalMs <= 0) return 0;
  return Math.max(0, Math.min(1, state.nextOffsetMs / state.totalMs));
}

export function asrLocalProgress(state: AsrLocalState, chunkPercent: number | null = null): AsrLocalProgress {
  const count = asrChunkCount(state.totalMs);
  return {
    ratio: asrLocalRatio(state),
    doneMs: Math.max(0, Math.min(state.totalMs, state.nextOffsetMs)),
    totalMs: state.totalMs,
    chunkIndex: Math.min(count, Math.floor(Math.max(0, state.nextOffsetMs) / ASR_CHUNK_MS)),
    chunkCount: count,
    chunkPercent: typeof chunkPercent === 'number' && Number.isFinite(chunkPercent) ? Math.max(0, Math.min(100, chunkPercent)) : null,
  };
}

/**
 * 조각들을 이어 붙인다.
 *
 * ⚠️ 빈칸 하나로 잇는다. 청크 경계는 문장 한가운데일 수 있는데, 줄바꿈으로 이으면 거기가
 * 문단이 나뉜 자리처럼 보인다 — 분석에 넘길 때 없는 구조를 만들어 준 셈이 된다.
 */
export function asrLocalText(pieces: readonly string[]): string {
  return pieces.map((piece) => piece.trim()).filter((piece) => piece.length > 0).join(' ');
}

/**
 * 청크 하나의 구간들을 **파일 기준 시각으로** 옮긴다.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **여기가 이 기능에서 제일 위험한 한 줄이다: `chunk.offsetMs` 를 더하는 자리.**      │
 * │ 전사기는 창 안에서의 시각을 준다(→ `asr-run.ts` 의 `AsrSegment`). 그래서 14개 청크가  │
 * │ 전부 0~120초를 말한다. 더하지 않으면 「0초에 한 말」이 14번 나오는데, **화면도 서버도  │
 * │ 그것이 틀렸다는 걸 알 방법이 없다** — 예외도 경고도 없이 조용히 틀리는 종류라 제일     │
 * │ 나쁘다. 이 함수가 순수한 것도 그래서다: whisper 없이 숫자만으로 검사할 수 있어야 한다. │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **청크 밖으로 나가는 시각은 청크 경계로 당긴다.** whisper 의 내부 창은 30초라 마지막
 * 구간의 끝이 우리가 시킨 길이를 조금 넘어설 수 있다. 넘은 채로 두면 다음 청크의 첫 구간과
 * 시각이 겹쳐 대화 순서가 뒤바뀐다. 🔴 **글자는 버리지 않는다** — 시각이 몇백 ms 어긋나는
 * 것보다 말이 사라지는 쪽이 훨씬 나쁘다.
 */
export function asrChunkSegments(
  segments: readonly { startMs: number; endMs: number; text: string }[],
  chunk: AsrChunk,
): AsrLocalSegment[] {
  const first = Math.max(0, chunk.offsetMs);
  const last = first + Math.max(0, chunk.durationMs);
  const clamp = (value: number, min: number) => Math.min(last, Math.max(min, value));
  const found: AsrLocalSegment[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    // 빈 구간은 서버 스키마(`text` 최소 1자)가 받지 않고, 화면에는 빈 말풍선으로 선다.
    if (!text) continue;
    // 깨진 숫자 하나가 통화 전체의 시각을 `NaN` 으로 만든다. 그 구간만 버린다.
    if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs)) continue;
    const startMs = clamp(first + Math.round(segment.startMs), first);
    found.push({ startMs, endMs: clamp(first + Math.round(segment.endMs), startMs), text });
  }
  return found;
}

export function freshAsrLocalState(input: AsrLocalInput, now: number): AsrLocalState {
  return {
    version: ASR_STATE_VERSION,
    callId: input.callId,
    wavUri: input.wavUri,
    sourceName: input.sourceName,
    sourceBytes: input.sourceBytes,
    modelId: input.modelId,
    totalMs: input.totalMs,
    nextOffsetMs: 0,
    pieces: [],
    // 새로 시작하는 받아쓰기는 **반드시 빈 배열로** 연다. `undefined` 로 두면 「옛 상태를
    // 이어받았다」와 구분이 안 되어 구간을 한 개도 모으지 않는다(→ `asr-local.ts`).
    segments: [],
    workedMs: 0,
    startedAt: now,
    updatedAt: now,
  };
}

/** 저장된 JSON 이 우리가 쓴 모양인가. 🔴 여기서 안 거르면 깨진 파일이 오프셋을 `NaN` 으로 만든다. */
export function isAsrLocalState(value: unknown): value is AsrLocalState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  const number = (key: string) => typeof state[key] === 'number' && Number.isFinite(state[key] as number);
  const text = (key: string) => typeof state[key] === 'string';
  if (state.version !== ASR_STATE_VERSION) return false;
  if (!text('callId') || !text('wavUri') || !text('sourceName') || !text('modelId')) return false;
  if (!number('sourceBytes') || !number('totalMs') || !number('nextOffsetMs') || !number('startedAt') || !number('updatedAt')) return false;
  if (!Array.isArray(state.pieces) || state.pieces.some((piece) => typeof piece !== 'string')) return false;
  // 🔴 **없는 것은 통과시킨다.** 구간을 모으기 전에 저장된 상태에는 이 필드가 없는데, 여기서
  // 막으면 실기기에 남아 있는 진행 중인 받아쓰기가 전부 「깨진 파일」이 되어 처음부터 돈다.
  if (state.segments !== undefined && !isAsrSegmentList(state.segments)) return false;
  // 🔴 같은 이유로 `workedMs` 도 **없으면 통과**다. 있을 때만 모양을 본다 — 음수나 NaN 이
  // 들어오면 화면의 「N분 M초 경과」가 뒤로 가거나 `NaN분` 이 된다.
  if (state.workedMs !== undefined && !(number('workedMs') && (state.workedMs as number) >= 0)) return false;
  return (state.nextOffsetMs as number) >= 0 && (state.totalMs as number) > 0;
}

function isAsrSegmentList(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const segment = item as Record<string, unknown>;
    return typeof segment.text === 'string'
      && typeof segment.startMs === 'number' && Number.isFinite(segment.startMs)
      && typeof segment.endMs === 'number' && Number.isFinite(segment.endMs);
  });
}

/**
 * 저장본으로 이어할 수 있나. 이어할 수 없으면 `null` 이고, 부른 쪽은 처음부터 시작한다.
 *
 * 🔴 **WAV 경로·모델·길이 중 하나라도 다르면 버린다.** 다른 파일에서 센 오프셋으로 이어가면
 * 앞부분이 통째로 빠진 전사문이 「완성본」으로 나온다 — 실패하지 않으므로 아무도 못 알아챈다.
 */
export function resumableState(saved: AsrLocalState | null, input: AsrLocalInput): AsrLocalState | null {
  if (!saved) return null;
  if (saved.callId !== input.callId) return null;
  if (saved.wavUri !== input.wavUri) return null;
  if (saved.modelId !== input.modelId) return null;
  if (saved.totalMs !== input.totalMs) return null;
  // 오프셋이 길이를 넘는 상태는 우리가 쓴 적이 없다. 그런 파일이면 믿지 않는다.
  if (saved.nextOffsetMs > saved.totalMs) return null;
  // 끝난 청크 수와 조각 수가 어긋나면 어느 쪽이 맞는지 알 수 없다. 처음부터 다시 한다.
  if (saved.pieces.length !== Math.ceil(saved.nextOffsetMs / ASR_CHUNK_MS)) return null;
  return saved;
}
