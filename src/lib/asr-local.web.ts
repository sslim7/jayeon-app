/**
 * 폰 받아쓰기 엔진 — **웹 쪽.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **`whisper.rn` 을 import 하면 웹 번들이 깨진다.** 그래서 갈라 둔다. 여기서 하는    │
 * │ 일은 「웹에서는 안 된다」를 **말해 주는 것**뿐이다 — 조용히 아무것도 하지 않으면        │
 * │ 사용자는 눌렀는데 반응이 없는 화면을 보게 된다.                                   │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 순수 계산(청크 경계·진행률)은 네이티브가 필요 없으므로 웹에서도 그대로 쓴다.
 */
import type { AsrLocalState } from './asr-local-types';

export * from './asr-local-types';

export const ASR_LOCAL_UNSUPPORTED = '받아쓰기는 앱에서만 됩니다. 웹에서는 서버로 보내 주세요.';

/** 웹에는 이어하기 상태가 없다. 「없다」를 돌려주면 부른 쪽은 처음부터로 판단한다. */
export function loadAsrLocalState(_callId: string): Promise<AsrLocalState | null> {
  return Promise.resolve(null);
}

/**
 * 웹에는 진행 중인 받아쓰기가 있을 수 없다 — 시작할 방법 자체가 없다.
 *
 * ⚠️ 그래도 **던지지 않고 빈 목록을 준다.** 설정 화면은 주소로 바로 열 수 있고, 그때 이
 * 목록이 던지면 화면이 「앱에서만 됩니다」 대신 오류 화면으로 선다.
 */
export function listAsrLocalStates(): Promise<AsrLocalState[]> {
  return Promise.resolve([]);
}

/** ⚠️ 조용히 성공한 척한다. 웹에서 저장할 상태 자체가 생기지 않으므로 부를 일이 없다. */
export function saveAsrLocalState(_state: AsrLocalState): Promise<void> {
  return Promise.resolve();
}

export function clearAsrLocalState(_callId: string): Promise<void> {
  return Promise.resolve();
}

export function defaultAsrLocalDeps(): never {
  throw new Error(ASR_LOCAL_UNSUPPORTED);
}

export function runLocalAsr(): { promise: Promise<never>; cancel: () => void } {
  return { promise: Promise.reject(new Error(ASR_LOCAL_UNSUPPORTED)), cancel: () => {} };
}
