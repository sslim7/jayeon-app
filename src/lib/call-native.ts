/**
 * `NatureCallAudio` 네이티브 모듈로 가는 유일한 통로(→ `modules/nature-call-audio`).
 *
 * 네 가지를 준다. 셋은 **폰 받아쓰기 측정**이 되살린 것이고(→ `docs/on-device-asr.md`),
 * 하나는 예전부터 남아 있던 것이다:
 *
 * - `decodeToWav`   : 🔴 m4a → 16kHz 모노 WAV. whisper 가 먹을 수 있는 유일한 형태다.
 * - `sha256File`    : 내려받은 모델이 온전한지 **한 번** 확인한다.
 * - `cpuCores`      : 추론 스레드 수의 유일한 근거(→ `asr-threads.ts`).
 * - `excludeFromBackup` : 옛 기기 분석이 남긴 통화 원문이 iCloud 백업으로 새지 않게 한다.
 *
 * 🔴 **웹에서는 이 모듈이 없다.** `requireOptionalNativeModule` 은 없으면 `null` 을 주므로
 * import 만으로 웹 번들이 깨지지는 않지만, 부르면 실패한다. 웹에서 받아쓰기 화면이 열리지
 * 않도록 갈라 둔 이유가 이것이다(→ `components/asr-bench.web.tsx`).
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

type CallAudioNative = {
  decode(input: string, output: string): Promise<number>;
  sha256(uri: string): Promise<string>;
  excludeFromBackup(uri: string): Promise<void>;
  /** 옛 네이티브 껍데기에는 없다. 그래서 선택적이다. */
  cpuCount?(): number;
  /** 〃. 값은 해석하지 않은 `Build.*` 원본이다. iOS 는 빈 값을 돌려준다. */
  socInfo?(): Record<string, unknown> | null;
};

/**
 * 기기 AP 문자열 — **해석하지 않은 원본.**
 *
 * ⚠️ 이 타입을 `asr-capability-types.ts` 에서 import 하지 않고 여기 다시 적는다. 그쪽은
 * `asr-models` 를, `asr-models` 는 이 파일을 불러서 순환이 생긴다. 모양이 같으면 구조적으로
 * 그대로 맞으므로 실익 없는 순환을 만들 이유가 없다.
 */
export type NativeSocInfo = { manufacturer: string; model: string; hardware: string; board: string };

function native(): CallAudioNative | null {
  return requireOptionalNativeModule<CallAudioNative>('NatureCallAudio');
}

/** 네이티브 모듈이 실린 앱인가. 받아쓰기 화면이 「왜 안 되는지」를 말해 주려면 필요하다. */
export function callAudioNativeAvailable(): boolean {
  return native() !== null;
}

export async function excludeFromBackup(uri: string): Promise<void> {
  try { await native()?.excludeFromBackup(uri); }
  catch { /* 파일이 아직 없거나 구버전 네이티브 껍데기면 무시한다. 백업 제외는 결과를 바꾸지 않는다. */ }
}

/**
 * 녹음을 16kHz 모노 WAV 로 바꾸고 **길이(초)** 를 돌려준다.
 *
 * ⚠️ 두 경로 모두 **앱 전용 저장소 안**이어야 한다. 네이티브가 그 밖의 경로를 거부한다 —
 * `/sdcard/Download/...` 를 그대로 넘기면 여기서 실패한다(→ `asr-audio.ts` 가 먼저 복사한다).
 */
export async function decodeToWav(inputUri: string, outputUri: string): Promise<number> {
  const module = native();
  if (!module) throw new Error('오디오 변환 네이티브 모듈이 없는 앱입니다.');
  return await module.decode(inputUri, outputUri);
}

export async function sha256File(uri: string): Promise<string> {
  const module = native();
  if (!module) throw new Error('해시 네이티브 모듈이 없는 앱입니다.');
  return await module.sha256(uri);
}

/**
 * 기기 AP 가 무엇인가. 모르면 `null`(옛 껍데기이거나 iOS 다).
 *
 * 🔴 **여기서 판정하지 않는다.** 「스냅드래곤인가」는 `asr-capability-types.ts` 가 정하고,
 * 이 함수는 네이티브가 준 문자열을 그대로 넘기기만 한다 — 판정을 네이티브 경계 밖에 두어야
 * `node --test` 로 확인할 수 있다.
 */
export function socInfo(): NativeSocInfo | null {
  try {
    const raw = native()?.socInfo?.();
    if (!raw) return null;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    const info: NativeSocInfo = {
      manufacturer: text(raw.manufacturer), model: text(raw.model), hardware: text(raw.hardware), board: text(raw.board),
    };
    // iOS 는 빈 값을 돌려준다(그쪽은 Metal 경로라 이 판정이 필요 없다). 전부 비었으면 모르는 것이다.
    return info.manufacturer || info.model || info.hardware || info.board ? info : null;
  } catch { return null; }
}

/** 기기 코어 수. 옛 네이티브 껍데기에는 이 함수가 없으므로 모르면 `null` 이다. */
export function cpuCores(): number | null {
  try {
    const value = native()?.cpuCount?.();
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}
