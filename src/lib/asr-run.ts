/**
 * whisper.rn 을 여닫고 재는 얇은 껍데기.
 *
 * 화면은 이 파일 너머의 whisper.rn API 를 직접 만지지 않는다. 그래야 측정이 끝나고 **시험
 * 화면만 버릴 때** 받아쓰기 자체는 그대로 남는다(→ `docs/on-device-asr.md` 의 다음 단계).
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이번 측정에서 가장 나쁜 결말은 「NPU 를 쓴다고 생각했는데 CPU 였다」이다.**        │
 * │ ggml-hexagon 은 NPU 를 열지 못해도 **예외를 던지지 않고 CPU 로 내려간다.** 그래서     │
 * │ `gpu` / `reasonNoGPU` 를 반드시 꺼내 화면에 띄운다 — 이 두 값이 없으면 측정한        │
 * │ 숫자가 무엇의 숫자인지 알 수 없다.                                              │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ NPU 를 쓰려면 매니페스트에 `libcdsprpc.so` 선언이 있어야 한다. 없으면 위 폴백이
 * 조용히 일어난다(→ `plugins/with-whisper.cjs`).
 */
import { initWhisper, type WhisperContext } from 'whisper.rn';
import { asrModel, modelUri, type AsrModelId } from './asr-models';

export type AsrSession = {
  context: WhisperContext;
  /** 🔴 NPU(안드로이드 Hexagon)/Metal(iOS)이 **실제로** 잡혔나. 기대가 아니라 결과다. */
  gpu: boolean;
  /** 안 잡혔으면 whisper.cpp 가 대는 이유. 비어 있으면 라이브러리가 이유를 남기지 않은 것이다. */
  reasonNoGPU: string;
  /** 모델을 메모리에 올리는 데 걸린 시간(ms). 547MB 를 읽는 시간이라 무시할 수 없다. */
  loadMs: number;
};

/**
 * 모델을 연다.
 *
 * `useGpu` 를 끌 수 있게 열어 둔 이유는 **같은 모델로 NPU/CPU 를 견줘야** 하기 때문이다.
 * q5_0 은 NPU 가 어차피 못 돌리므로 켜도 CPU 로 떨어지는데, 그 사실 자체가 측정 결과다.
 *
 * ⚠️ `useFlashAttn` 은 NPU 경로에서 whisper.rn 이 항상 켠다. CPU 경로에서 우리가 켜면
 * 변수가 하나 더 늘어 「무엇 때문에 빨라졌는지」를 말할 수 없게 되므로 건드리지 않는다.
 */
export async function openAsrSession(id: AsrModelId, useGpu: boolean): Promise<AsrSession> {
  const started = Date.now();
  const context = await initWhisper({ filePath: modelUri(asrModel(id)), useGpu });
  return { context, gpu: context.gpu, reasonNoGPU: context.reasonNoGPU ?? '', loadMs: Date.now() - started };
}

export async function closeAsrSession(session: AsrSession): Promise<void> {
  // 🔴 놓으면 547MB 가 그대로 잡혀 있다. 다음 모델을 열 때 두 개가 동시에 올라가 죽는다.
  await session.context.release();
}

export type AsrBenchResult = {
  /** whisper.cpp 가 고른 백엔드 문자열(`NEON`, `HEXAGON` 등). 어떤 경로로 돌았는지의 증거다. */
  config: string;
  nThreads: number;
  encodeMs: number;
  decodeMs: number;
  batchMs: number;
  promptMs: number;
};

/**
 * 30초 청크 한 번치 벤치.
 *
 * 🔴 **전체 받아쓰기 전에 이것부터 돌린다.** 몇 초면 끝나고, 여기서 인코더가 1초를 넘게
 * 쓰면 28분 통화는 이미 수 분짜리다 — 30분을 기다린 뒤에 알 이유가 없다.
 *
 * ⚠️ 이 숫자를 28분에 그대로 곱하지 마라. mel 추출·temperature 재시도·파일 I/O·발열
 * 스로틀링이 빠져 있다. 방향을 보는 용도다.
 */
export async function benchAsr(session: AsrSession, threads: number): Promise<AsrBenchResult> {
  const result = await session.context.bench(threads);
  return {
    config: result.config,
    nThreads: result.nThreads,
    encodeMs: result.encodeMs,
    decodeMs: result.decodeMs,
    batchMs: result.batchMs,
    promptMs: result.promptMs,
  };
}

/**
 * 받아쓴 **구간 하나** — 말한 시각과 그때 한 말.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **시각은 「이 호출의 창」을 0 으로 잰 ms 다.** 파일 처음부터의 시각이 **아니다.**    │
 * │ 창을 옮겨 가며 부르는 쪽(`asr-local.ts`)이 오프셋을 더해 절대 시각으로 만든다 —       │
 * │ `onProgress` 의 0~100 이 창 안의 값인 것과 같은 규칙이다.                        │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 **화자는 없다.** whisper 는 누가 말했는지 알려 주지 않는다. 없는 것을 빈 문자열로라도
 * 채우지 않는다 — 채우는 순간 받는 쪽이 「모른다」와 「아무개다」를 구분할 수 없게 된다.
 */
export type AsrSegment = {
  /** 창 시작으로부터의 시각(ms). */
  startMs: number;
  /** 창 시작으로부터의 끝 시각(ms). */
  endMs: number;
  text: string;
};

export type AsrTranscription = {
  text: string;
  /** 구간별 결과. ⚠️ 빈 배열일 수 있다 — 무음 구간만 있는 창에서는 하나도 나오지 않는다. */
  segments: AsrSegment[];
  /** 사용자가 멈춰서 끝난 것인지. 중간 결과를 「완성본」으로 착각하지 않게 한다. */
  aborted: boolean;
  elapsedMs: number;
};

/**
 * whisper 가 준 구간을 **창 기준 ms** 로 옮긴다.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **`t0`/`t1` 은 10ms 단위이고, `offset` 이 이미 더해진 값이다.** 근거는 라이브러리가 │
 * │ 품고 있는 whisper.cpp 다: `whisper_full_with_state` 가 `seek_start = offset_ms/10` 에서 │
 * │ 시작하고 구간 시각을 `seek + 2*(…)` 로 만든다. 그래서 여기서 창 시작을 **빼서** 창    │
 * │ 기준으로 되돌린다 — 더하는 자리는 `asr-local.ts` 한 곳뿐이어야 한다.                │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ 라이브러리가 언젠가 창 기준 값을 주도록 바뀌면, 그때도 빼는 코드는 **실패하지 않고**
 * 시각만 2분씩 앞당긴다 — 제일 나쁜 종류다. 그래서 빼기 전에 값으로 확인한다: 창 기준
 * 값은 창 길이(≤120초)를 넘을 수 없으므로, 가장 이른 구간이 창 시작보다 뒤에 있으면 이미
 * 더해진 값이 확실하다. 아니면 빼지 않는다.
 */
function windowSegments(raw: readonly { t0: number; t1: number; text: string }[], offsetMs: number): AsrSegment[] {
  const earliest = raw.reduce((min, segment) => Math.min(min, segment.t0 * 10), Infinity);
  const shift = Number.isFinite(earliest) && earliest >= offsetMs ? offsetMs : 0;
  return raw
    .map((segment) => ({ startMs: segment.t0 * 10 - shift, endMs: segment.t1 * 10 - shift, text: (segment.text ?? '').trim() }))
    // 빈 구간은 버린다. 서버 스키마가 빈 글의 구간을 받지 않고, 화면에도 빈 말풍선이 선다.
    .filter((segment) => segment.text.length > 0);
}

export type AsrTranscribeHandle = {
  promise: Promise<AsrTranscription>;
  /** 멈춘다. whisper.cpp 가 지금 창을 끝내고 나오므로 즉시는 아니다. */
  stop: () => void;
};

/**
 * 같은 WAV 파일의 **일부 구간**만 전사하라는 지정.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이것이 있으니 파일을 자르지 않는다.** whisper.rn 의 `TranscribeOptions` 에는     │
 * │ `offset`(ms)·`duration`(ms) 이 있다. 청크 WAV 를 따로 쓰거나 헤더를 다시 만드는      │
 * │ 코드는 전부 불필요하고, 55MB 짜리 임시 파일을 14개 만들다 저장 공간을 터뜨린다.        │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
export type AsrWindow = {
  /** 파일 처음부터의 오프셋(ms). */
  offsetMs: number;
  /** 이 호출에서 처리할 길이(ms). */
  durationMs: number;
};

/**
 * 16kHz WAV 를 받아쓴다. `window` 를 주면 그 구간만, 주지 않으면 파일 전체다.
 *
 * 🔴 **고유명사 프롬프트를 넣지 않는다.** 맥북 실측에서 효과가 없었고 CER 은 오히려 미세하게
 * 나빠졌다(→ `docs/on-device-asr.md` 7절 ④). 게다가 whisper.rn 에는 `carryInitialPrompt` 가
 * 없어 프롬프트가 **첫 30초 창에만** 걸린다 — 28분짜리에서는 애초에 무의미하다.
 *
 * `language: 'ko'` 는 고정이다. 자동 감지는 첫 30초로 언어를 정하는데, 통화 첫머리가
 * 인사·잡음이면 엉뚱한 언어로 28분을 전사한다.
 *
 * ⚠️ `onProgress` 는 whisper.cpp 가 주는 0~100 이다. **우리가 시간으로 추정한 값이 아니다.**
 * 🔴 `window` 를 주면 이 값은 **그 구간 안에서의** 0~100 이다. 파일 전체 진행률이 아니다 —
 * 두 개를 섞으면 진행 막대가 청크마다 0 으로 되돌아간다(→ `asr-local.ts` 가 환산한다).
 *
 * ⚠️ `window` 는 **선택 인자다.** 기존 호출부(`asr-bench.tsx`)는 파일 전체를 한 번에 돌리고,
 * 그 측정값이 문서의 기준이라 호출 모양이 바뀌면 안 된다.
 *
 * 🔴 **결과에는 글 전체와 구간이 함께 있다**(`segments`). 구간은 **더해진 값**이라 `text` 만
 * 보던 호출부는 그대로 돌아간다 — 반대로 여기서 구간을 버리면 통화 원문 화면이 그릴 근거를
 * 잃는다(실제로 그래서 저장된 원문이 화면에서 비어 보였다).
 */
export function transcribeAsr(
  session: AsrSession,
  wavUri: string,
  threads: number,
  onProgress: (percent: number) => void,
  window?: AsrWindow,
): AsrTranscribeHandle {
  const started = Date.now();
  const offsetMs = window ? Math.max(0, Math.round(window.offsetMs)) : 0;
  const task = session.context.transcribe(wavUri, {
    language: 'ko',
    maxThreads: threads,
    onProgress,
    // 창을 주지 않았으면 두 값을 아예 넣지 않는다. 0 을 넣어도 같은 뜻이지만, 옵션이
    // 없는 호출과 있는 호출을 로그에서 구분할 수 있게 둔다.
    ...(window ? { offset: offsetMs, duration: Math.max(0, Math.round(window.durationMs)) } : {}),
  });
  return {
    stop: () => { void task.stop().catch(() => {}); },
    promise: task.promise.then((result) => ({
      text: result.result ?? '',
      segments: windowSegments(result.segments ?? [], offsetMs),
      aborted: !!result.isAborted,
      elapsedMs: Date.now() - started,
    })),
  };
}
