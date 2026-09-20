/**
 * 받아쓰기에 먹일 오디오 준비 — **고르기 + 16kHz 변환.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **변환 시간은 받아쓰기 시간의 일부다.** 전사만 재고 변환을 빼면 그 숫자는 사용자가 │
 * │ 실제로 기다리는 시간이 아니다. 여기서 재서 화면이 **따로, 그리고 합계로** 보여 준다.  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * # 왜 변환이 필요한가
 *
 * 통화 녹음은 m4a(AAC, 48kHz 모노)이고 whisper.cpp 는 **16kHz 모노 PCM** 만 받는다.
 * ⚠️ 샘플레이트가 다른 것을 넣으면 **실패하지 않는다** — 소리가 느리거나 빨라진 것으로 들려
 * 그럴듯한 헛소리를 전사해 낸다. 알아채기 가장 어려운 고장이라 변환을 건너뛸 길은 없다.
 *
 * whisper.rn 도 WAV 아닌 파일을 직접 받지 않는다. 변환은 `NatureCallAudio.decode` 가
 * MediaCodec(안드로이드)/AVAssetReader(iOS)로 한다(→ `modules/nature-call-audio`).
 */
import * as FS from 'expo-file-system/legacy';
import * as Picker from 'expo-document-picker';
import { decodeToWav } from './call-native';

export type PickedAudio = { name: string; uri: string; bytes: number };

/**
 * 시험할 녹음 고르기.
 *
 * 🔴 `copyToCacheDirectory` 를 끄면 안 된다. 두 가지가 동시에 깨진다:
 * 1. 원본 URI 는 `content://` 이고, 네이티브 변환기는 **앱 전용 저장소의 `file://` 만**
 *    받는다(→ `modules/nature-call-audio` 의 `privateFile`). `/sdcard/Download/...` 는 거부된다.
 * 2. 콘텐츠 제공자는 URI 를 언제든 회수한다. 28분짜리 처리가 도는 동안 사라지면 그 실패에는
 *    단서가 남지 않는다.
 *
 * ⚠️ 그래서 복사에도 시간이 든다(28분 녹음 ≈ 28MB). 그 시간은 **변환 시간에 포함해서** 잰다 —
 * 실제 사용 흐름에서도 사용자는 그만큼 기다린다.
 */
export async function pickAudio(): Promise<PickedAudio | null> {
  const selected = await Picker.getDocumentAsync({
    type: ['audio/*', 'application/ogg', 'video/3gpp'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (selected.canceled) return null;
  const asset = selected.assets[0];
  if (!asset) return null;
  return { name: asset.name, uri: asset.uri, bytes: asset.size ?? 0 };
}

export type ConvertedAudio = {
  /** whisper 에 넘길 16kHz 모노 WAV 경로. */
  uri: string;
  /** 오디오 길이(초). 「28분 통화에 몇 분」을 말하려면 분모가 필요하다. */
  seconds: number;
  /** 변환에 걸린 실제 시간(ms). 🔴 이것도 측정 대상이다. */
  elapsedMs: number;
};

const WORK_DIRECTORY = `${FS.cacheDirectory}asr-bench/`;

/**
 * 고른 파일을 16kHz 모노 WAV 로 바꾼다.
 *
 * ⚠️ 결과는 **캐시**에 둔다. 28분이면 약 55MB 이고, 측정이 끝나면 쓸모가 없다. 문서 폴더에
 * 두면 사용자가 지울 방법이 없는 채로 남는다.
 */
export async function convertToWav(source: PickedAudio): Promise<ConvertedAudio> {
  await FS.makeDirectoryAsync(WORK_DIRECTORY, { intermediates: true });
  const target = `${WORK_DIRECTORY}input-16k.wav`;
  // 이전 측정이 남긴 WAV 를 지운다. 남아 있으면 변환이 실패해도 옛 파일로 전사가 「성공」한다.
  await FS.deleteAsync(target, { idempotent: true });
  const started = Date.now();
  const seconds = await decodeToWav(source.uri, target);
  return { uri: target, seconds, elapsedMs: Date.now() - started };
}

/** 측정이 끝난 뒤 남은 WAV 를 걷는다. 다음 측정을 위해 캐시를 비워 둔다. */
export async function clearWorkFiles(): Promise<void> {
  await FS.deleteAsync(WORK_DIRECTORY, { idempotent: true });
}

/**
 * 통화 받아쓰기용 WAV 를 두는 곳. **통화마다 파일이 따로다.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **시험 화면처럼 이름을 고정하면 안 된다.** 이어하기 상태는 WAV 경로로 「같은          │
 * │ 파일인가」를 판단한다(→ `asr-local-types.ts` 의 `resumableState`). 경로 하나를        │
 * │ 돌려 쓰면, 통화 B 를 등록하는 순간 통화 A 의 WAV 가 덮어써지고 A 를 이어할 때          │
 * │ **B 의 소리를 A 의 오프셋부터** 받아쓴다. 실패하지 않으므로 아무도 못 알아챈다.         │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ 여전히 **캐시**다. 28분이면 55MB 이고, 전사문을 보내고 나면 쓸모가 없다. 캐시가
 * 비워져 이어하기가 깨지는 경우는 화면이 「처음부터 다시」로 받는다.
 */
const CALL_DIRECTORY = `${FS.cacheDirectory}asr-call/`;

/** 파일 이름이 되는 값이라 글자를 제한한다. `../` 가 섞이면 앱 저장소 밖을 건드린다. */
const CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function callWavUri(callId: string): string {
  if (!CALL_ID.test(callId)) throw new Error('통화 ID 에 쓸 수 없는 글자가 있습니다.');
  return `${CALL_DIRECTORY}${callId}.wav`;
}

/**
 * 통화 하나의 녹음을 16kHz 모노 WAV 로 바꾼다.
 *
 * ⚠️ 이미 변환본이 있으면 **다시 만들지 않는다.** 이어하기로 돌아온 경우가 그것인데, 여기서
 * 새로 만들면 28분치 변환을 한 번 더 기다리게 된다. 다만 길이는 다시 알아야 하므로,
 * 있는 파일을 쓸 때는 부른 쪽이 저장된 상태의 `totalMs` 를 쓴다.
 */
export async function convertCallToWav(callId: string, source: PickedAudio): Promise<ConvertedAudio> {
  const target = callWavUri(callId);
  await FS.makeDirectoryAsync(CALL_DIRECTORY, { intermediates: true });
  // 같은 통화를 「처음부터 다시」 할 때 옛 변환본이 남아 있으면 안 된다 — 변환이 실패해도
  // 옛 파일로 받아쓰기가 「성공」해 버린다.
  await FS.deleteAsync(target, { idempotent: true });
  const started = Date.now();
  const seconds = await decodeToWav(source.uri, target);
  return { uri: target, seconds, elapsedMs: Date.now() - started };
}

/** 이 통화의 변환본이 아직 있나. 이어하기를 시작할 수 있는지의 근거다. */
export async function callWavExists(callId: string): Promise<boolean> {
  const info = await FS.getInfoAsync(callWavUri(callId));
  return info.exists && !info.isDirectory && (info.size ?? 0) > 0;
}

/** 전사문을 보내고 나면 55MB 를 들고 있을 이유가 없다. 포기했을 때도 같다. */
export async function clearCallWav(callId: string): Promise<void> {
  await FS.deleteAsync(callWavUri(callId), { idempotent: true });
}

/** `1,706초` 를 `28분 26초` 로. 결과표에서 분모와 분자를 같은 단위로 읽게 한다. */
export function durationLabel(seconds: number): string {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return minutes > 0 ? `${minutes}분 ${whole % 60}초` : `${whole}초`;
}
