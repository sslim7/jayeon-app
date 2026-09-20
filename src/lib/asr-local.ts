/**
 * 폰에서 받아쓰기 — **중단돼도 이어서 하는 엔진.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **앱이 백그라운드로 가는 것은 막을 수 없다.** iOS 는 백그라운드 앱에 CPU 를 주지    │
 * │ 않으므로 돌던 청크는 그 자리에서 얼어붙고, 안드로이드는 메모리가 모자라면 앱을 죽인다.  │
 * │ 그래서 이 엔진은 「끊기지 않게 하는」 설계가 아니라 **「끊겨도 잃는 것이 2분뿐인」**     │
 * │ 설계다: 120초 청크 하나가 끝날 때마다 디스크에 남기고, **돌다 만 청크는 버린다.**      │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * # 왜 파일을 자르지 않나
 *
 * whisper.rn 의 `TranscribeOptions` 에 `offset`(ms)·`duration`(ms) 이 있다. 변환된 WAV
 * 하나를 두고 창만 옮겨 가며 부르면 된다(→ `asr-run.ts` 의 `AsrWindow`). 28분치 WAV 는
 * 55MB 라 청크 파일을 따로 만들면 저장 공간이 먼저 터진다.
 *
 * # 왜 세션을 청크마다 열고 닫지 않나
 *
 * ⚠️ 모델 적재가 **17.8초**다(실측). 15청크면 그것만 4분 반이다. 그래서 한 번 열어 여러
 * 청크를 돌리고 **중단·완료 시에만** 닫는다. 반대로 834MB 를 쥔 채로 백그라운드에 오래 두면
 * 메모리 압박으로 앱이 죽으므로, 멈출 때는 반드시 닫는다.
 *
 * 판단(청크 경계·진행률·이어하기 가능 여부)은 전부 `asr-local-types.ts` 에 있다. 이 파일은
 * 파일과 세션만 만진다.
 */
import * as FS from 'expo-file-system/legacy';
import { AppState } from 'react-native';

import type { AsrModelId } from './asr-models';
import { closeAsrSession, openAsrSession, transcribeAsr, type AsrSession, type AsrTranscribeHandle, type AsrWindow } from './asr-run';
import { excludeFromBackup } from './call-native';
import {
  asrChunkAt, asrChunkSegments, asrLocalProgress, asrLocalText, freshAsrLocalState, isAsrLocalState, resumableState,
  type AsrLocalInput, type AsrLocalProgress, type AsrLocalSegment, type AsrLocalState,
} from './asr-local-types';

// 순수 계산과 타입은 그대로 내보낸다. 화면이 「청크가 몇 개인가」를 물으려고 파일 두 개를
// 따로 import 하게 만들 이유가 없다.
export * from './asr-local-types';

/**
 * 상태 파일이 있는 곳.
 *
 * 🔴 **캐시가 아니라 문서 폴더다.** 캐시는 OS 가 언제든 지운다 — 이어하기 정보가 사라지면
 * 사용자는 28분을 처음부터 다시 기다린다. 대신 ⚠️ **이 파일에는 통화 원문 조각이 들어 있으므로**
 * 백업에서 뺀다. iCloud 로 통화 내용이 새면 그건 우리가 만든 유출이다.
 */
const DIRECTORY = `${FS.documentDirectory}asr-local/`;

/** 파일 이름이 되는 값이라 글자를 제한한다. `../` 가 섞이면 앱 저장소 밖을 건드린다. */
const CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;

function stateUri(callId: string): string {
  if (!CALL_ID.test(callId)) throw new Error('통화 ID 에 쓸 수 없는 글자가 있습니다.');
  return `${DIRECTORY}${callId}.json`;
}

/** 저장된 이어하기 상태. 없거나 깨졌으면 `null` 이고, 부른 쪽은 처음부터 시작한다. */
export async function loadAsrLocalState(callId: string): Promise<AsrLocalState | null> {
  try {
    const parsed: unknown = JSON.parse(await FS.readAsStringAsync(stateUri(callId)));
    return isAsrLocalState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * **아직 안 끝난 받아쓰기 전부.** 최근에 움직인 것이 앞에 온다.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **폴더를 아는 것은 이 파일뿐이어야 한다.** 이 함수가 없던 동안 설정 화면이 경로       │
 * │ 상수를 복제해 두고 직접 훑었는데, 그러면 엔진이 폴더를 옮기는 날 목록이 **오류 없이**   │
 * │ 조용히 비어 「하던 일이 사라졌다」로 보인다. 아무것도 깨지지 않으니 아무도 알아채지      │
 * │ 못하는 종류의 고장이다(→ `app/asr-setup.tsx`).                                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **읽을 수 없는 것은 조용히 건너뛴다.** 폴더가 없는 것은 실패가 아니라 「한 번도 받아쓴
 * 적이 없다」는 뜻이고, 깨진 파일 하나 때문에 나머지 목록까지 잃으면 안 된다. 🔴 대신 깨진
 * 것을 **빈 줄로 세우지도 않는다** — 누를 곳 없는 줄이 되어 고장으로 읽힌다.
 */
export async function listAsrLocalStates(): Promise<AsrLocalState[]> {
  let names: string[];
  try {
    names = await FS.readDirectoryAsync(DIRECTORY);
  } catch {
    return [];
  }
  const found: AsrLocalState[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const callId = name.slice(0, -'.json'.length);
    // 우리가 쓴 이름이 아니다. `stateUri` 가 어차피 던지므로 여기서 걸러 조용히 넘어간다.
    if (!CALL_ID.test(callId)) continue;
    const state = await loadAsrLocalState(callId);
    if (state) found.push(state);
  }
  // 여러 개가 남는 일은 드물지만, 그때 고를 근거가 시간뿐이다.
  return found.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveAsrLocalState(state: AsrLocalState): Promise<void> {
  await FS.makeDirectoryAsync(DIRECTORY, { intermediates: true });
  await excludeFromBackup(DIRECTORY);
  await FS.writeAsStringAsync(stateUri(state.callId), JSON.stringify(state));
  await excludeFromBackup(stateUri(state.callId));
}

/**
 * 이어하기를 **포기**한다(사용자가 그만두거나 되살릴 수 없는 실패일 때).
 *
 * 🔴 실패했다고 엔진이 알아서 지우지 않는다. 일시적인 실패(메모리 부족·파일 잠김)에서도
 * 지워 버리면 이미 끝낸 12분치가 함께 사라진다. 지우는 것은 **부른 쪽의 결정**이다.
 */
export async function clearAsrLocalState(callId: string): Promise<void> {
  await FS.deleteAsync(stateUri(callId), { idempotent: true });
}

/**
 * 엔진이 바깥에 기대는 것 전부.
 *
 * ⚠️ whisper 를 테스트에서 돌릴 수 없으므로 **전사·세션·저장을 전부 갈아 끼울 수 있게** 둔다.
 * 기본값은 진짜 구현이라 화면은 `deps` 를 몰라도 된다.
 */
export type AsrLocalDeps = {
  openSession: (modelId: AsrModelId, useGpu: boolean) => Promise<AsrSession>;
  closeSession: (session: AsrSession) => Promise<void>;
  transcribeChunk: (
    session: AsrSession, wavUri: string, threads: number, window: AsrWindow, onPercent: (percent: number) => void,
  ) => AsrTranscribeHandle;
  readState: (callId: string) => Promise<AsrLocalState | null>;
  writeState: (state: AsrLocalState) => Promise<void>;
  removeState: (callId: string) => Promise<void>;
  now: () => number;
  /** 앱이 앞에 있나. 백그라운드면 다음 청크를 **시작하지 않는다** — 시작해도 진행되지 않는다. */
  isForeground: () => boolean;
  /** 백그라운드로 밀릴 때 알려 준다. 해제 함수를 돌려준다. */
  watchBackground: (onBackground: () => void) => () => void;
};

export function defaultAsrLocalDeps(): AsrLocalDeps {
  return {
    openSession: openAsrSession,
    closeSession: closeAsrSession,
    transcribeChunk: (session, wavUri, threads, window, onPercent) => transcribeAsr(session, wavUri, threads, onPercent, window),
    readState: loadAsrLocalState,
    writeState: saveAsrLocalState,
    removeState: clearAsrLocalState,
    now: () => Date.now(),
    // ⚠️ iOS 의 `inactive`(알림 센터를 내린 상태 등)에서는 CPU 가 계속 돈다. 거기서 멈추면
    // 멀쩡한 청크를 버리게 되므로 **`background` 만** 중단으로 본다.
    isForeground: () => AppState.currentState !== 'background',
    watchBackground: (onBackground) => {
      const sub = AppState.addEventListener('change', (next) => { if (next === 'background') onBackground(); });
      return () => sub.remove();
    },
  };
}

/** 왜 끝났나. 🔴 「끝까지 갔다」와 「멈췄다」를 한 값으로 뭉개면 반쪽 전사문이 완성본이 된다. */
export type AsrLocalStop =
  /** 파일 끝까지 갔다. */
  | 'done'
  /** 사용자가 멈췄다. */
  | 'canceled'
  /** 앱이 백그라운드로 밀렸다. */
  | 'background'
  /** whisper 가 우리가 시키지 않은 이유로 멈췄다. ⚠️ 원인을 모르므로 완료로 치지 않는다. */
  | 'interrupted';

export type AsrLocalResult = {
  /** 지금까지 완료된 청크들을 이어 붙인 것. 🔴 돌다 만 청크는 들어 있지 않다. */
  text: string;
  /**
   * 같은 범위의 구간들. 시각은 **파일 처음부터** 잰 것이다.
   *
   * ⚠️ **비어 있어도 `text` 는 멀쩡하다.** 구간을 모으기 전에 시작한 받아쓰기를 이어받으면
   * 여기는 끝까지 비어 있다 — 그때는 글만 보낸다(→ `lib/call-transcript.ts`).
   */
  segments: AsrLocalSegment[];
  /** 끝까지 갔나. 거짓이면 `text` 는 중간 결과다. */
  done: boolean;
  reason: AsrLocalStop;
  /** 남아 있는 이어하기 상태. 완료됐으면 `null`(디스크에서도 지웠다). */
  state: AsrLocalState | null;
  /** 이번 실행에서 실제로 끝낸 청크 수. 0 이면 한 청크도 못 넘겼다는 뜻이다. */
  chunksRun: number;
  elapsedMs: number;
};

export type AsrLocalHandle = {
  promise: Promise<AsrLocalResult>;
  /** 멈춘다. ⚠️ 즉시는 아니다 — whisper 가 지금 30초 창을 끝내고 나온다. */
  cancel: () => void;
};

export type AsrLocalOptions = {
  threads: number;
  /** NPU/Metal 을 쓸 것인가. 기본은 켠다 — 안 잡히면 whisper 가 알아서 CPU 로 내려간다. */
  useGpu?: boolean;
  onProgress?: (progress: AsrLocalProgress) => void;
  deps?: Partial<AsrLocalDeps>;
};

/**
 * 받아쓴다. 저장된 상태가 있으면 **그 오프셋부터**, 없으면 처음부터.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **저장은 청크가 끝난 뒤에만 한다.** 돌다 만 청크의 텍스트는 어디에도 남기지 않는다 — │
 * │ 남기면 같은 구간을 다시 돌렸을 때 그 절반이 결과에 두 번 들어가고, 그 중복은 나중에     │
 * │ 어떤 방법으로도 걷어낼 수 없다.                                                 │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ 전사가 **실패**하면(예외) 상태는 그대로 둔 채 거절한다. 되살릴 수 없는 실패라고
 * 판단한 쪽이 `clearAsrLocalState` 로 지운다.
 */
export function runLocalAsr(input: AsrLocalInput, options: AsrLocalOptions): AsrLocalHandle {
  const deps: AsrLocalDeps = { ...defaultAsrLocalDeps(), ...options.deps };
  const useGpu = options.useGpu ?? true;

  let canceled = false;
  let background = false;
  let current: AsrTranscribeHandle | null = null;

  const cancel = () => { canceled = true; current?.stop(); };

  const promise = (async (): Promise<AsrLocalResult> => {
    const started = deps.now();
    let chunksRun = 0;

    let state = resumableState(await deps.readState(input.callId), input) ?? freshAsrLocalState(input, deps.now());
    state = { ...state, updatedAt: deps.now() };
    await deps.writeState(state);
    const report = (percent: number | null) => options.onProgress?.(asrLocalProgress(state, percent));
    report(null);

    // 백그라운드 감시는 세션을 열기 전부터 건다. 17.8초짜리 적재 중에 밀릴 수도 있다.
    const unwatch = deps.watchBackground(() => { background = true; current?.stop(); });

    try {
      // 이미 끝난 상태로 저장돼 있었던 경우(마지막 청크 뒤에 지우지 못하고 죽었다).
      if (asrChunkAt(state.totalMs, state.nextOffsetMs) !== null && !canceled && deps.isForeground()) {
        const session = await deps.openSession(state.modelId, useGpu);
        try {
          while (!canceled && !background) {
            const chunk = asrChunkAt(state.totalMs, state.nextOffsetMs);
            if (!chunk) break;
            // 다음 청크를 **시작하기 전에** 다시 본다. 백그라운드에서 시작하면 그 2분은
            // 진행되지 않은 채 흘러가고, 돌아왔을 때 처음부터 다시 돈다.
            if (!deps.isForeground()) { background = true; break; }

            const handle = deps.transcribeChunk(
              session, state.wavUri, options.threads,
              { offsetMs: chunk.offsetMs, durationMs: chunk.durationMs },
              // ⚠️ whisper 가 주는 0~100 은 **이 창 안에서의** 값이다. 그대로 전체 진행률로
              // 쓰면 청크마다 0 으로 되돌아간다.
              (percent) => report(percent),
            );
            current = handle;
            let result;
            try { result = await handle.promise; } finally { current = null; }

            // 🔴 여기가 설계의 핵심이다. 멈춘 청크의 텍스트는 **버린다.**
            if (result.aborted) break;

            /*
              🔴 **청크 오프셋을 여기서 더한다.** 전사기는 창 안에서의 시각을 주므로 청크
              14개가 전부 「0초부터」를 말한다. 더하지 않으면 같은 시각이 14번 반복되는데,
              그 전사문은 저장도 되고 화면에도 뜨고 분석도 통과한다 — **틀렸다는 것을
              알아챌 방법이 아무 데도 없다.** 더하는 계산 자체는 `asrChunkSegments` 에
              두었다: whisper 없이 숫자만으로 검사할 수 있어야 하기 때문이다.

              🔴 **`state.segments` 가 없으면 끝까지 모으지 않는다.** 구간을 모으기 전에
              시작해 저장된 상태라 앞의 청크들은 되찾을 수 없다. 뒤쪽만 모아 보내면 통화가
              14분째에 시작하는 대화로 보이는데, 그것이 「구간 없음」보다 나쁘다.
            */
            const collected = state.segments;
            state = {
              ...state,
              pieces: [...state.pieces, result.text.trim()],
              ...(collected ? { segments: [...collected, ...asrChunkSegments(result.segments, chunk)] } : {}),
              nextOffsetMs: chunk.offsetMs + chunk.durationMs,
              updatedAt: deps.now(),
            };
            await deps.writeState(state);
            chunksRun += 1;
            report(null);
          }
        } finally {
          // ⚠️ 834MB 를 쥔 채 백그라운드로 가면 OS 가 앱을 죽인다. 중단이든 완료든 닫는다.
          // 이어할 때 17.8초를 다시 쓰는 편이 앱이 죽는 것보다 싸다.
          await deps.closeSession(session).catch(() => {});
        }
      } else if (!deps.isForeground()) {
        background = true;
      }
    } finally {
      unwatch();
    }

    const done = state.nextOffsetMs >= state.totalMs;
    if (done) await deps.removeState(input.callId);
    const reason: AsrLocalStop = done ? 'done' : canceled ? 'canceled' : background ? 'background' : 'interrupted';
    return {
      text: asrLocalText(state.pieces),
      segments: state.segments ?? [],
      done,
      reason,
      state: done ? null : state,
      chunksRun,
      elapsedMs: deps.now() - started,
    };
  })();

  return { promise, cancel };
}
