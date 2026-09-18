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

/** `1,706초` 를 `28분 26초` 로. 결과표에서 분모와 분자를 같은 단위로 읽게 한다. */
export function durationLabel(seconds: number): string {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return minutes > 0 ? `${minutes}분 ${whole % 60}초` : `${whole}초`;
}
