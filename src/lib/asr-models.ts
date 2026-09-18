/**
 * 받아쓰기 모델 내려받기·검증.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **모델을 APK 에 넣지 마라.** q5_0 하나가 547MB 다. Play Store 번들 한도를        │
 * │ 넘기고, 받아쓰기를 쓰지 않는 사용자에게도 그 용량을 지운다. 최초 사용 시 내려받아      │
 * │ 앱 저장소에 둔다.                                                             │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * # 왜 두 크기를 다 받을 수 있어야 하나
 *
 * 🔴 **q5_0 과 q8_0 중 어느 쪽이 폰에서 빠른지 아직 아무도 모른다.** 맥북 실측에서는 q5_0 이
 * 300MB 작은데 손실은 1%p 차이였다(CER 4.84% vs 3.75%, 고유명사는 셋 다 동일 —
 * → `docs/on-device-asr.md` 7절). 그런데 **갤럭시의 Hexagon NPU 는 q5 를 지원하지 않아
 * CPU 로 폴백한다.** 즉 「작지만 CPU」와 「크지만 NPU」의 대결이고, 재 보기 전에는 답이 없다.
 * 그래서 둘을 **동시에 보관**할 수 있게 만든다 — 하나씩 지웠다 받으면 비교 자체가 고역이다.
 *
 * # 검증을 어떻게 하나 — 두 단계로 나눈 이유
 *
 * ⚠️ **부분 다운로드된 파일을 「있다」고 판단하면 whisper 는 기동에 실패하는데, 그 실패
 * 메시지에는 원인이 드러나지 않는다.** 그래서 두 겹으로 막는다:
 *
 * 1. 받는 동안에는 `.partial` 로 쓴다. 최종 이름은 **검증을 통과한 뒤에만** 생긴다 —
 *    즉 최종 이름의 파일은 존재 자체가 이미 한 번 검증됐다는 뜻이다.
 * 2. 받은 직후 **SHA-256 을 한 번** 맞춰 본다. 크기만 맞고 내용이 깨진 경우는 이때만
 *    생길 수 있으므로, 여기서 한 번 거르면 이후에는 크기만 봐도 된다. 🔴 **앱을 열 때마다
 *    547MB 를 해싱하지 않는다** — 그 몇 초는 사용자가 이유를 알 수 없는 멈춤이 된다.
 */
import * as FS from 'expo-file-system/legacy';
import { excludeFromBackup, sha256File } from './call-native';

export type AsrModelId = 'q5_0' | 'q8_0';

export type AsrModel = {
  id: AsrModelId;
  label: string;
  /** 정확한 바이트 수. HuggingFace 의 `content-length` 실측(2026-09-18). */
  bytes: number;
  /** HuggingFace LFS 의 `x-linked-etag`. 받은 직후 한 번만 맞춰 본다. */
  sha256: string;
  /** NPU(ggml-hexagon)가 이 양자화를 돌릴 수 있나. 화면이 「왜 CPU 인지」를 설명하는 근거다. */
  npuCapable: boolean;
  note: string;
};

/**
 * 🔴 **turbo 의 q4_0 은 이 저장소에 없다**(2026-09-18 확인). 「더 작은 걸 써 보자」는 다음
 * 사람이 여기서 시간을 버리지 않도록 적어 둔다. 영어 기준으로도 q4_0 은 WER 이 유의하게
 * 나빠지는 지점이라(p=0.001) 굳이 찾아다닐 값도 아니다.
 */
export const ASR_MODELS: readonly AsrModel[] = [
  {
    id: 'q5_0',
    label: 'q5_0 (547MB)',
    bytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    npuCapable: false,
    note: '맥북 CER 4.84%. NPU 가 q5 를 못 돌려 CPU 로 떨어진다.',
  },
  {
    id: 'q8_0',
    label: 'q8_0 (834MB)',
    bytes: 874_188_075,
    sha256: '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1',
    npuCapable: true,
    note: '맥북 CER 3.75%. NPU 를 쓸 수 있는 쪽.',
  },
] as const;

export function asrModel(id: AsrModelId): AsrModel {
  const found = ASR_MODELS.find((model) => model.id === id);
  if (!found) throw new Error(`알 수 없는 모델: ${id}`);
  return found;
}

const DIRECTORY = `${FS.documentDirectory}asr-models/`;
const fileName = (model: AsrModel) => `ggml-large-v3-turbo-${model.id}.bin`;
const url = (model: AsrModel) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${fileName(model)}`;

/** whisper.rn 에 넘길 경로. **설치가 끝난 모델만** 이 이름으로 존재한다. */
export function modelUri(model: AsrModel): string { return DIRECTORY + fileName(model); }
const partialUri = (model: AsrModel) => `${modelUri(model)}.partial`;
const resumeUri = (model: AsrModel) => `${modelUri(model)}.resume.json`;

export type AsrModelStatus = {
  /** 바로 쓸 수 있나. 크기까지 맞아야 참이다. */
  installed: boolean;
  /** 받다 만 바이트. 0 이면 아직 시작도 안 했다. 이어받기의 근거이자 화면의 진행률이다. */
  partialBytes: number;
};

async function size(uri: string): Promise<number> {
  const info = await FS.getInfoAsync(uri);
  return info.exists && !info.isDirectory ? (info.size ?? 0) : 0;
}

/**
 * 지금 이 모델이 어떤 상태인가.
 *
 * ⚠️ 크기를 **정확히** 비교한다. `>=` 로 두면 이어받기가 어긋나 늘어난 파일을 완성본으로
 * 오인한다. 부등호 하나가 「whisper 가 기동을 못 하는데 이유를 모르는」 상태를 만든다.
 */
export async function modelStatus(model: AsrModel): Promise<AsrModelStatus> {
  return {
    installed: (await size(modelUri(model))) === model.bytes,
    partialBytes: await size(partialUri(model)),
  };
}

export async function deleteModel(model: AsrModel): Promise<void> {
  await FS.deleteAsync(modelUri(model), { idempotent: true });
  await FS.deleteAsync(partialUri(model), { idempotent: true });
  await FS.deleteAsync(resumeUri(model), { idempotent: true });
}

export type AsrDownload = {
  /** 끝나면 resolve. 취소하면 `DOWNLOAD_CANCELED` 로 reject 한다. */
  promise: Promise<void>;
  /** 멈춘다. 받아 둔 바이트는 남고 다음 호출이 이어받는다. */
  cancel: () => void;
};

/**
 * 내려받기. **진행률은 서버가 알려 준 실제 바이트 수다** — 지어내지 않는다.
 *
 * ⚠️ 이어받기는 서버와 OS 가 모두 도와줄 때만 된다. `pauseAsync()` 가 이어받기 정보를 주지
 * 못하는 경우가 있어서, 그때는 **다음 호출이 처음부터 다시 받는다.** 그래서 실패를 「멈췄다」로
 * 표시하되 남은 바이트를 지우지는 않는다 — 될 때는 되고, 안 될 때도 사용자는 같은 버튼을
 * 한 번 더 누르면 된다.
 */
export function downloadModel(model: AsrModel, onProgress: (bytes: number) => void): AsrDownload {
  let task: FS.DownloadResumable | null = null;
  let canceled = false;

  const promise = (async () => {
    await FS.makeDirectoryAsync(DIRECTORY, { intermediates: true });
    await excludeFromBackup(DIRECTORY);

    // 🔴 남은 공간을 먼저 본다. 500MB 를 받다가 마지막에 「공간 없음」으로 죽으면 사용자는
    // 데이터 요금과 시간을 둘 다 잃는다. 여유 300MB 는 변환 WAV(28분 = 약 55MB)와 OS 몫이다.
    const free = await FS.getFreeDiskStorageAsync();
    const already = await size(partialUri(model));
    if (free + already < model.bytes + 300 * 1024 ** 2) throw new Error('DOWNLOAD_STORAGE');

    let resumeData: string | undefined;
    try {
      const saved = JSON.parse(await FS.readAsStringAsync(resumeUri(model))) as FS.DownloadPauseState;
      if (saved.url === url(model) && saved.fileUri === partialUri(model)) resumeData = saved.resumeData;
    } catch { /* 처음 받는 중이거나 이어받기 정보가 없다. 처음부터 받는다. */ }

    task = FS.createDownloadResumable(url(model), partialUri(model), {}, (progress) => {
      onProgress(progress.totalBytesWritten);
    }, resumeData);

    const result = resumeData ? await task.resumeAsync() : await task.downloadAsync();
    if (canceled) throw new Error('DOWNLOAD_CANCELED');
    // 취소했을 때도 null 이 온다. 위에서 걸러지지 않았으면 연결이 끊긴 것이다.
    if (!result) throw new Error('DOWNLOAD_NETWORK');
    if (result.status !== 200 && result.status !== 206) throw new Error(`DOWNLOAD_HTTP_${result.status}`);

    // 🔴 검증은 최종 이름을 붙이기 **전**이다. 순서를 뒤집으면 깨진 파일이 완성본 이름을
    // 달고 남아, 다음 실행부터는 「받을 필요 없다」고 판단되어 영원히 고쳐지지 않는다.
    if ((await size(partialUri(model))) !== model.bytes) {
      await FS.deleteAsync(partialUri(model), { idempotent: true });
      throw new Error('DOWNLOAD_SIZE');
    }
    await excludeFromBackup(partialUri(model));
    if ((await sha256File(partialUri(model))) !== model.sha256) {
      await FS.deleteAsync(partialUri(model), { idempotent: true });
      throw new Error('DOWNLOAD_HASH');
    }

    await FS.deleteAsync(modelUri(model), { idempotent: true });
    await FS.moveAsync({ from: partialUri(model), to: modelUri(model) });
    await excludeFromBackup(modelUri(model));
    await FS.deleteAsync(resumeUri(model), { idempotent: true });
    onProgress(model.bytes);
  })();

  const cancel = () => {
    canceled = true;
    void (async () => {
      if (!task) return;
      try {
        const saved = await task.pauseAsync();
        await FS.writeAsStringAsync(resumeUri(model), JSON.stringify(saved));
      } catch { /* 이어받기 정보를 못 받았다. 받아 둔 바이트는 남기고 다음에 처음부터 받는다. */ }
    })();
  };

  return { promise, cancel };
}

/** 화면에 그대로 내보낼 한 줄. 실패를 「알 수 없는 오류」로 뭉개지 않는다. */
export function asrDownloadMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'DOWNLOAD_CANCELED') return '내려받기를 멈췄어요. 다시 누르면 이어받습니다.';
  if (code === 'DOWNLOAD_STORAGE') return '저장 공간이 부족합니다. 모델 크기 + 300MB 를 비운 뒤 다시 시도해 주세요.';
  if (code === 'DOWNLOAD_NETWORK') return '연결이 끊겼어요. 다시 누르면 이어받습니다.';
  if (code === 'DOWNLOAD_SIZE') return '받은 파일 크기가 맞지 않아 지웠습니다. 다시 받아 주세요.';
  if (code === 'DOWNLOAD_HASH') return '받은 파일이 손상되어 지웠습니다. 다시 받아 주세요.';
  if (code.startsWith('DOWNLOAD_HTTP_')) return `HuggingFace 가 ${code.slice('DOWNLOAD_HTTP_'.length)} 를 돌려줬어요.`;
  return code || '내려받지 못했습니다.';
}
