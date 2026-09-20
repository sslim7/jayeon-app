/**
 * 「이 기기에서 폰 받아쓰기가 되는가」의 **판단 규칙** — 순수한 부분.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **기기 이름으로 추측하지 않는다.** 이 프로젝트는 그 추측으로 이미 두 번 틀렸다:     │
 * │ 「Z 폴드는 전부 스냅드래곤」(→ 플립은 엑시노스였다), 「벤치 × 57 이면 28분치」        │
 * │ (→ 실제는 그보다 훨씬 느렸다). 그래서 판정은 ① AP 제조사 문자열과 ② **실제로 돌린**   │
 * │ 벤치 두 가지 사실만으로 한다.                                                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 네이티브 import 가 없다. 그래야 `node --test` 로 판정 규칙 자체를 확인할 수 있다.
 */
import type { AsrModelId } from './asr-models';

/** 저장 형식이 바뀌면 올린다. 옛 판정을 새 규칙으로 읽지 않는다. */
export const ASR_CAPABILITY_VERSION = 1;

/**
 * 인코더가 이 시간을 넘으면 불가.
 *
 * 28분 통화 기준 **12분 초과**에 해당한다(아래 환산식). 그 위로는 서버에 보내는 편이
 * 사용자에게도 빠르고, 폰은 12분 내내 뜨겁다.
 */
export const ASR_ENCODE_LIMIT_MS = 4_000;

/** `bench` 가 재는 창 길이. whisper 의 한 창이 30초다. */
export const ASR_BENCH_WINDOW_MS = 30_000;

/** 「28분 통화」의 기준 녹음. 문서 전반이 쓰는 28분 26초짜리다(→ `docs/on-device-asr.md`). */
export const ASR_REFERENCE_CALL_MS = 1_706_000;

/**
 * 실측 기준점 — **아이폰 15 Pro.**
 *
 * 🔴 이 두 값이 환산식의 전부다. 지어낸 계수를 쓰지 않으려고 실측 한 쌍을 그대로 박아 둔다.
 * 순진한 `인코더 × 창 개수` 는 mel 추출·temperature 재시도·파일 I/O·발열 스로틀링을 빼먹어
 * 아래 계수만큼 낙관적이다.
 *
 * ⚠️ 기준점이 하나뿐이라 **다른 기기에서는 어긋날 수 있다.** 새 실측이 생기면 여기를 고친다.
 */
const ANCHOR_ENCODE_MS = 2_354;
/** 같은 기기에서 위 기준 녹음을 실제로 받아쓴 시간: 7분 18초. */
const ANCHOR_ACTUAL_MS = 438_000;

/**
 * 순진한 환산이 몇 배나 낙관적인가 ≈ **3.27배.**
 *
 * ⚠️ 상수로 적지 않고 기준점에서 나누어 구한다. 손으로 적으면 기준점을 고칠 때 계수가
 * 뒤처지고, 그 어긋남은 「예상 7분」이라고 말해 놓고 20분이 걸리는 모습으로 드러난다.
 * 이 계수는 임계값과도 들어맞는다: 인코더 4,000ms → 28분 통화에 12.4분.
 */
export const ASR_SLOWDOWN = ANCHOR_ACTUAL_MS / (ANCHOR_ENCODE_MS * (ASR_REFERENCE_CALL_MS / ASR_BENCH_WINDOW_MS));

/** 벤치 인코더 시간으로 **그 길이의 통화**에 걸릴 시간을 어림한다(ms). */
export function estimateAsrMs(encodeMs: number, audioMs: number = ASR_REFERENCE_CALL_MS): number {
  if (!Number.isFinite(encodeMs) || encodeMs <= 0 || !Number.isFinite(audioMs) || audioMs <= 0) return 0;
  return Math.round(encodeMs * (audioMs / ASR_BENCH_WINDOW_MS) * ASR_SLOWDOWN);
}

/** 네이티브가 그대로 읽어 준 AP 문자열들. ⚠️ 해석하지 않은 원본이어야 한다. */
export type SocInfo = {
  /** `Build.SOC_MANUFACTURER`(API 31+). 낮은 버전에서는 빈 문자열이다. */
  manufacturer: string;
  /** `Build.SOC_MODEL`(API 31+). */
  model: string;
  /** `Build.HARDWARE`. */
  hardware: string;
  /** `Build.BOARD`. */
  board: string;
};

export type SocVerdict = 'snapdragon' | 'other' | 'unknown';

/** API 31+ 의 제조사 문자열. 퀄컴은 `Qualcomm` 또는 `QTI` 로 적힌다. */
const QUALCOMM_MAKER = /^(qualcomm|qti)\b/i;
/** API 30 이하에서만 쓰는 대체 단서. `Build.HARDWARE` 가 `qcom` 인 기기가 대부분이다. */
const QUALCOMM_BOARD = /(^|[^a-z])qcom|^(sm|sdm|msm|apq)\d{3,4}/i;
/** 같은 자리에서 확실히 퀄컴이 **아닌** 것으로 읽히는 값들. */
const OTHER_BOARD = /exynos|universal\d{4}|^s5e\d{4}|^mt\d{4}|kirin|^hi\d{4}|tensor|^gs\d{3}|zuma|unisoc/i;

/**
 * 이 AP 가 스냅드래곤인가.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **ggml-hexagon 은 퀄컴 Hexagon NPU 전용이다.** 엑시노스·미디어텍에서는 예외가     │
 * │ 나지 않고 **조용히 CPU 로 내려가서** 28분 통화가 33분~3시간이 된다. 실패하지 않으므로 │
 * │ 사용자는 「원래 이렇게 느린 앱」이라고 생각하게 된다.                              │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 **`unknown` 은 「아니다」가 아니다.** 여기서 모른다고 막아 버리면 API 30 짜리 스냅드래곤
 * 기기가 통째로 배제된다. 모를 때는 **벤치로 실측해서** 판정한다 — 느리면 어차피 벤치에서
 * 걸린다(CPU 폴백은 인코더가 30초대다).
 */
export function socVerdict(soc: SocInfo | null): SocVerdict {
  if (!soc) return 'unknown';
  // ① API 31+ 는 이 한 값이 정답이다. 제조사가 적혀 있는데 퀄컴이 아니면 다른 것이다.
  const maker = soc.manufacturer.trim();
  if (maker && maker.toLowerCase() !== 'unknown') return QUALCOMM_MAKER.test(maker) ? 'snapdragon' : 'other';
  // ② 낮은 버전은 보드/하드웨어 이름으로 짚는다. 둘 다 안 걸리면 모르는 것으로 둔다.
  for (const value of [soc.model, soc.hardware, soc.board]) {
    const text = value.trim();
    if (!text) continue;
    if (QUALCOMM_BOARD.test(text)) return 'snapdragon';
    if (OTHER_BOARD.test(text)) return 'other';
  }
  return 'unknown';
}

export type AsrCapabilityReason =
  /** 쓸 수 있다. */
  | 'OK'
  /** 웹이다. whisper.rn 이 없다. */
  | 'WEB'
  /** 네이티브 모듈이 없는 앱(옛 껍데기)이다. */
  | 'NO_NATIVE'
  /** 퀄컴이 아닌 AP 다. NPU 가 없어 CPU 로만 돈다. */
  | 'NOT_SNAPDRAGON'
  /** 모델을 아직 내려받지 않아 재 볼 수 없다. */
  | 'MODEL_MISSING'
  /** 재 봤더니 느리다. */
  | 'SLOW'
  /** 재는 중에 실패했다. */
  | 'ERROR';

export type AsrCapability = {
  version: number;
  /** 로컬 받아쓰기를 써도 되나. */
  ok: boolean;
  reason: AsrCapabilityReason;
  /** 🔴 사용자에게 그대로 보여 줄 한 줄. 「안 됩니다」만 말하면 앱을 의심한다. */
  message: string;
  modelId: AsrModelId;
  /** 판정 근거가 된 AP 문자열. 나중에 「왜 막혔지」를 물었을 때 답할 수 있어야 한다. */
  soc: SocInfo | null;
  /** 실제로 돌린 벤치의 인코더 시간(ms). 못 쟀으면 `null` — 0 으로 채우지 않는다. */
  encodeMs: number | null;
  /** 같은 벤치의 백엔드 문자열(`NEON`/`HEXAGON` 등). 어느 경로로 돌았는지의 증거다. */
  benchConfig: string | null;
  /** NPU/Metal 이 **실제로** 잡혔나. 기대가 아니라 결과다. */
  gpu: boolean | null;
  /** 28분 통화 예상 처리 시간(ms). 못 쟀으면 `null`. */
  estimateMs: number | null;
  threads: number | null;
  checkedAt: number;
  /** 어느 앱 버전에서 잰 값인가. 업데이트되면 다시 잰다. */
  appVersion: string;
};

/** `438000` 을 `7분 18초` 로. ⚠️ 판정 결과는 네이티브 없이도 문장으로 만들 수 있어야 한다. */
export function asrDurationLabel(ms: number): string {
  const whole = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(whole / 60);
  return minutes > 0 ? `${minutes}분 ${whole % 60}초` : `${whole}초`;
}

/** 어느 AP 라고 말해 줄 것인가. 빈 값이면 이름을 지어내지 않는다. */
function socLabel(soc: SocInfo | null): string {
  const name = [soc?.manufacturer, soc?.model].map((value) => (value ?? '').trim()).filter(Boolean).join(' ');
  return name && name.toLowerCase() !== 'unknown' ? name : '이 기기의 AP';
}

/** 판정 하나를 한국어 한 줄로. 🔴 불가일 때도 **왜, 그리고 얼마나 걸리는지**를 함께 말한다. */
export function asrCapabilityMessage(reason: AsrCapabilityReason, estimateMs: number | null, soc: SocInfo | null): string {
  const guess = estimateMs !== null ? `28분 통화에 약 ${asrDurationLabel(estimateMs)} 걸립니다.` : '';
  switch (reason) {
    case 'OK':
      return `이 기기에서 받아쓸 수 있어요. ${guess}`.trim();
    case 'SLOW':
      return `이 기기에서는 너무 느려요 — ${guess || '28분 통화에 12분이 넘습니다.'} 서버로 보내는 편이 빠릅니다.`;
    case 'NOT_SNAPDRAGON':
      return `${socLabel(soc)}에는 받아쓰기가 쓰는 NPU 가 없어 CPU 로만 돌아갑니다. 28분 통화에 30분이 넘어 서버로 보내야 합니다.`;
    case 'MODEL_MISSING':
      return '먼저 받아쓰기 모델을 내려받아야 이 기기에서 되는지 잴 수 있어요.';
    case 'NO_NATIVE':
      return '이 버전의 앱에는 받아쓰기 기능이 들어 있지 않습니다. 앱을 업데이트해 주세요.';
    case 'WEB':
      return '받아쓰기는 앱에서만 됩니다. 웹에서는 서버로 보내 주세요.';
    case 'ERROR':
      return '이 기기에서 되는지 재 보지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  }
}

/**
 * **모델을 받아 봐야 소용없는 기기인가.** 막을 이유가 있으면 그 사유를, 없으면 `null`.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **834MB 를 받게 두면 안 되는 경우가 하나 있다** — 퀄컴이 **아닌 것이 확실한** AP.   │
 * │ ggml-hexagon 은 Hexagon NPU 전용이라 거기서는 조용히 CPU 로 떨어지고, 28분 통화가    │
 * │ 30분을 넘긴다. 받아도 쓸 수 없는데 버튼이 살아 있으면 사용자는 용량만 버린다.          │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 **`unknown` 은 막지 않는다.** 구형 안드로이드는 AP 를 짚을 수 없을 뿐이고, 여기서
 * 막으면 멀쩡한 구형 스냅드래곤이 통째로 배제된다 — 느리면 어차피 벤치에서 걸린다
 * (→ 위 `socVerdict`). iOS 도 마찬가지다: Metal 경로라 Hexagon 여부가 뜻이 없다.
 *
 * ⚠️ **이 판정은 「받기」에만 건다.** 이미 받아 둔 모델을 **지우는 길은 언제나 열려 있어야
 * 한다** — 용량을 되찾는 유일한 방법이 그것이다(→ `app/asr-setup.tsx`).
 */
export function modelDownloadBlockReason(facts: { platform: string; soc: SocInfo | null }): 'NOT_SNAPDRAGON' | null {
  return facts.platform === 'android' && socVerdict(facts.soc) === 'other' ? 'NOT_SNAPDRAGON' : null;
}

/** 벤치를 돌리기 **전에** 이미 결론이 나는 경우. `null` 이면 재 봐야 안다. */
export function preBenchReason(facts: {
  platform: string;
  nativeAvailable: boolean;
  soc: SocInfo | null;
  modelInstalled: boolean;
}): AsrCapabilityReason | null {
  if (facts.platform === 'web') return 'WEB';
  if (!facts.nativeAvailable) return 'NO_NATIVE';
  /*
   * 🔴 AP 판정은 안드로이드에만 해당한다(iOS 는 Metal 경로). 조건을 여기 다시 적지 않고
   * 위 함수를 부르는 이유는, 「판정은 불가인데 내려받기 버튼은 살아 있다」처럼 두 자리가
   * 어긋나는 상태를 아예 만들 수 없게 하려는 것이다.
   */
  const blocked = modelDownloadBlockReason(facts);
  if (blocked) return blocked;
  // 모델이 없으면 벤치 자체를 돌릴 수 없다. 「불가」가 아니라 「아직 모른다」다.
  if (!facts.modelInstalled) return 'MODEL_MISSING';
  return null;
}

/** 벤치를 돌린 뒤의 결론. ⚠️ 여기서만 속도를 판정한다 — 이름·세대·모델명은 보지 않는다. */
export function benchReason(encodeMs: number): 'OK' | 'SLOW' {
  return Number.isFinite(encodeMs) && encodeMs > 0 && encodeMs <= ASR_ENCODE_LIMIT_MS ? 'OK' : 'SLOW';
}

/** 판정 하나를 완성한다. 화면이 쓰는 값은 전부 여기서 만들어진다. */
export function buildAsrCapability(parts: {
  reason: AsrCapabilityReason;
  modelId: AsrModelId;
  soc: SocInfo | null;
  encodeMs: number | null;
  benchConfig?: string | null;
  gpu?: boolean | null;
  threads?: number | null;
  now: number;
  appVersion: string;
}): AsrCapability {
  const estimateMs = parts.encodeMs !== null ? estimateAsrMs(parts.encodeMs) : null;
  return {
    version: ASR_CAPABILITY_VERSION,
    ok: parts.reason === 'OK',
    reason: parts.reason,
    message: asrCapabilityMessage(parts.reason, estimateMs, parts.soc),
    modelId: parts.modelId,
    soc: parts.soc,
    encodeMs: parts.encodeMs,
    benchConfig: parts.benchConfig ?? null,
    gpu: parts.gpu ?? null,
    estimateMs,
    threads: parts.threads ?? null,
    checkedAt: parts.now,
    appVersion: parts.appVersion,
  };
}

/**
 * 저장해 둔 판정을 그대로 써도 되나.
 *
 * ⚠️ 판정은 비싸다 — 모델 적재 17.8초 + 벤치. 그래서 남겨 두고 다시 쓴다. 다만 **모델이
 * 바뀌거나 앱이 업데이트되면** 다시 잰다: 백엔드·양자화·whisper.rn 버전이 함께 바뀌므로
 * 옛 숫자는 더 이상 이 앱의 숫자가 아니다.
 *
 * 🔴 「아직 모른다」(`MODEL_MISSING`/`ERROR`)는 재사용하지 않는다. 그걸 캐시하면 모델을
 * 내려받은 뒤에도 영원히 「모델이 없다」고 말하게 된다.
 */
export function isFreshCapability(saved: AsrCapability | null, modelId: AsrModelId, appVersion: string): boolean {
  if (!saved) return false;
  if (saved.version !== ASR_CAPABILITY_VERSION) return false;
  if (saved.modelId !== modelId) return false;
  if (saved.appVersion !== appVersion) return false;
  return saved.reason !== 'MODEL_MISSING' && saved.reason !== 'ERROR';
}

/** 저장된 JSON 이 우리가 쓴 모양인가. 깨진 파일로 「불가」를 선언하지 않는다. */
export function isAsrCapability(value: unknown): value is AsrCapability {
  if (typeof value !== 'object' || value === null) return false;
  const saved = value as Record<string, unknown>;
  if (saved.version !== ASR_CAPABILITY_VERSION) return false;
  if (typeof saved.ok !== 'boolean' || typeof saved.reason !== 'string') return false;
  if (typeof saved.message !== 'string' || typeof saved.modelId !== 'string') return false;
  if (typeof saved.appVersion !== 'string' || typeof saved.checkedAt !== 'number') return false;
  return true;
}
