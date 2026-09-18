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

export type AsrTranscription = {
  text: string;
  /** 사용자가 멈춰서 끝난 것인지. 중간 결과를 「완성본」으로 착각하지 않게 한다. */
  aborted: boolean;
  elapsedMs: number;
};

export type AsrTranscribeHandle = {
  promise: Promise<AsrTranscription>;
  /** 멈춘다. whisper.cpp 가 지금 창을 끝내고 나오므로 즉시는 아니다. */
  stop: () => void;
};

/**
 * 16kHz WAV 전체를 받아쓴다.
 *
 * 🔴 **고유명사 프롬프트를 넣지 않는다.** 맥북 실측에서 효과가 없었고 CER 은 오히려 미세하게
 * 나빠졌다(→ `docs/on-device-asr.md` 7절 ④). 게다가 whisper.rn 에는 `carryInitialPrompt` 가
 * 없어 프롬프트가 **첫 30초 창에만** 걸린다 — 28분짜리에서는 애초에 무의미하다.
 *
 * `language: 'ko'` 는 고정이다. 자동 감지는 첫 30초로 언어를 정하는데, 통화 첫머리가
 * 인사·잡음이면 엉뚱한 언어로 28분을 전사한다.
 *
 * ⚠️ `onProgress` 는 whisper.cpp 가 주는 0~100 이다. **우리가 시간으로 추정한 값이 아니다.**
 */
export function transcribeAsr(
  session: AsrSession,
  wavUri: string,
  threads: number,
  onProgress: (percent: number) => void,
): AsrTranscribeHandle {
  const started = Date.now();
  const task = session.context.transcribe(wavUri, {
    language: 'ko',
    maxThreads: threads,
    onProgress,
  });
  return {
    stop: () => { void task.stop().catch(() => {}); },
    promise: task.promise.then((result) => ({
      text: result.result ?? '',
      aborted: !!result.isAborted,
      elapsedMs: Date.now() - started,
    })),
  };
}
