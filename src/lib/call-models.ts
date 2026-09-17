import * as FS from 'expo-file-system/legacy';
import * as Device from 'expo-device';
import { requireNativeModule, requireOptionalNativeModule } from 'expo-modules-core';
import type { CallModelState } from '@/types/calls';
import { Platform } from 'react-native';

export const MODEL_FILES = [
  { name: 'whisper-base', version: '5359861c739e955e79d9a303bcbc70fb988958b1', file: 'ggml-base.bin', size: 147951465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', repo: 'ggerganov/whisper.cpp' },
  { name: 'Qwen3-0.6B-Q8_0', version: '23749fefcc72300e3a2ad315e1317431b06b590a', file: 'Qwen3-0.6B-Q8_0.gguf', size: 639446688,
    sha256: '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031', repo: 'Qwen/Qwen3-0.6B-GGUF' },
] as const;
export const modelDirectory = `${FS.documentDirectory}call-models/`;
const manifestPath = modelDirectory + 'manifest.json';
const total = MODEL_FILES.reduce((n, m) => n + m.size, 0);
const state: CallModelState = { supported: Platform.OS === 'ios' || Platform.OS === 'android', installed: false, downloading: false, downloaded_bytes: 0, total_bytes: total };
// 검증은 787MB 해시라 무겁다. 프라미스를 공유해 검증 중 들어온 호출도 같은 결과를 기다린다.
let verification: Promise<boolean> | null = null;
let installing: Promise<void> | null = null;
let download: FS.DownloadResumable | null = null;
export function audioNative() { return requireNativeModule<{ sha256(uri: string): Promise<string>; decode(input: string, output: string): Promise<number>; excludeFromBackup(uri: string): Promise<void> }>('NatureCallAudio'); }
export function modelPath(index: number) { return modelDirectory + MODEL_FILES[index].file; }
/** iOS 기본 백업(iCloud)에서 제외한다. Android 는 allowBackup=false 라 no-op 이다. */
export async function excludeFromBackup(uri: string) {
  try { await audioNative().excludeFromBackup(uri); } catch { /* 파일이 아직 없거나 구버전 네이티브 모듈이면 무시한다. */ }
}
async function sized(index: number) {
  const info = await FS.getInfoAsync(modelPath(index));
  return info.exists && !info.isDirectory && info.size === MODEL_FILES[index].size;
}
async function hashed(index: number) {
  return await sized(index) && await audioNative().sha256(modelPath(index)) === MODEL_FILES[index].sha256;
}
async function writeManifest() {
  await FS.writeAsStringAsync(manifestPath, JSON.stringify({ models: MODEL_FILES, downloaded_at: new Date().toISOString() }));
}
/** 설치 뒤에는 manifest + 파일 크기로 확인한다. 전체 해시는 manifest 가 없거나 어긋난 복구 상황에서만 돈다. */
async function verifyInstalled(): Promise<boolean> {
  try {
    const manifest = JSON.parse(await FS.readAsStringAsync(manifestPath)) as { models?: typeof MODEL_FILES };
    const matches = Array.isArray(manifest?.models) && manifest.models.length === MODEL_FILES.length &&
      MODEL_FILES.every((model, index) => {
        const saved = manifest.models![index];
        return saved?.file === model.file && saved?.version === model.version && saved?.sha256 === model.sha256 && saved?.size === model.size;
      });
    if (matches) {
      for (let index = 0; index < MODEL_FILES.length; index++) if (!await sized(index)) return false;
      return true;
    }
  } catch { /* manifest 없음/손상 → 아래에서 전체 해시로 확인한다. */ }
  try {
    for (let index = 0; index < MODEL_FILES.length; index++) if (!await hashed(index)) return false;
    await writeManifest();
    return true;
  } catch { return false; }
}
export async function modelState(): Promise<CallModelState> {
  if (!requireOptionalNativeModule('NatureCallAudio')) return { ...state, supported: false, error: 'AI 기능이 포함된 앱으로 업데이트해 주세요. Expo Go에서는 지원하지 않습니다.' };
  if (Device.totalMemory !== null && Device.totalMemory < 3 * 1024 ** 3) return { ...state, supported: false, error: 'AI 분석에는 메모리 3GB 이상 기기가 필요합니다.' };
  if (!state.downloading) {
    verification ??= verifyInstalled();
    state.installed = await verification;
    if (state.installed) state.downloaded_bytes = total;
  }
  return { ...state };
}
export async function pauseModelDownload() {
  if (!download) return;
  try {
    const saved = await download.pauseAsync();
    await FS.writeAsStringAsync(modelDirectory + 'resume.json', JSON.stringify(saved));
  } catch { /* Partial download can be restarted when the OS did not supply resume data. */ }
}
export async function installModels(): Promise<void> {
  const status = await modelState();
  if (!status.supported) throw new Error(status.error ?? '이 기기에서 AI 분석을 지원하지 않습니다.');
  if (installing || state.installed) return;
  state.downloading = true; state.error = null; state.notice = null;
  installing = (async () => {
    await FS.makeDirectoryAsync(modelDirectory, { intermediates: true });
    await excludeFromBackup(modelDirectory);
    let finished = 0;
    for (let index = 0; index < MODEL_FILES.length; index++) {
      const model = MODEL_FILES[index];
      if (await hashed(index)) { finished += model.size; continue; }
      const free = await FS.getFreeDiskStorageAsync();
      if (free < model.size + 300 * 1024 ** 2) throw new Error('STORAGE');
      const uri = `https://huggingface.co/${model.repo}/resolve/${model.version}/${model.file}`;
      const partial = modelPath(index) + '.partial';
      let resumeData: string | undefined;
      try {
        const saved = JSON.parse(await FS.readAsStringAsync(modelDirectory + 'resume.json')) as FS.DownloadPauseState;
        if (saved.url === uri && saved.fileUri === partial) resumeData = saved.resumeData;
      } catch { /* First installation. */ }
      download = FS.createDownloadResumable(uri, partial, {}, progress => {
        state.downloaded_bytes = finished + progress.totalBytesWritten;
      }, resumeData);
      const result = resumeData ? await download.resumeAsync() : await download.downloadAsync();
      if (!result) throw new Error('PAUSED');
      if (result.status !== 200 && result.status !== 206) throw new Error('DOWNLOAD');
      await excludeFromBackup(partial);
      const info = await FS.getInfoAsync(partial);
      if (!info.exists || info.isDirectory || info.size !== model.size || await audioNative().sha256(partial) !== model.sha256) {
        await FS.deleteAsync(partial, { idempotent: true }); throw new Error('VERIFY');
      }
      await FS.deleteAsync(modelPath(index), { idempotent: true });
      await FS.moveAsync({ from: partial, to: modelPath(index) });
      await excludeFromBackup(modelPath(index));
      await FS.deleteAsync(modelDirectory + 'resume.json', { idempotent: true });
      finished += model.size;
    }
    state.installed = true; state.downloaded_bytes = total;
    await writeManifest();
    // 방금 설치를 확인했으니 다음 modelState 가 해시를 다시 돌 이유가 없다.
    verification = Promise.resolve(true);
  })().catch(error => {
    verification = null;
    const reason = error instanceof Error ? error.message : '';
    // 백그라운드 전환에 의한 일시정지는 오류가 아니다. 저장 공간 부족도 따로 알린다.
    if (reason === 'PAUSED') state.notice = '설치가 멈췄어요. 다시 누르면 이어받습니다.';
    else if (reason === 'STORAGE') state.error = `저장 공간이 부족합니다. ${Math.ceil((total + 300 * 1024 ** 2) / 1e9 * 10) / 10}GB 이상 확보한 뒤 다시 설치해 주세요.`;
    else state.error = 'AI 기능 설치가 완료되지 않았습니다. 저장 공간과 네트워크를 확인하고 다시 설치해 주세요.';
  }).finally(() => { download = null; installing = null; state.downloading = false; });
}
