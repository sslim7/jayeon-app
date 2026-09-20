/**
 * 「이 기기에서 폰 받아쓰기가 되는가」 — **재서 판정하고, 그 결과를 남긴다.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **기기 이름으로 추측하지 않는다.** 판정 규칙은 전부 `asr-capability-types.ts` 에   │
 * │ 있고, 이 파일은 ① AP 문자열을 읽고 ② **실제로 벤치를 돌리고** ③ 결과를 저장한다.      │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ 판정은 비싸다 — 모델 적재 **17.8초**(실측) + 벤치 몇 초. 그래서 한 번 잰 값을 남겨
 * 두고 다시 쓰고, **모델이 바뀌거나 앱이 업데이트되면** 다시 잰다.
 */
import * as FS from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { APP_VERSION } from '@/constants/app-meta';
import { asrModel, modelStatus, type AsrModelId } from './asr-models';
import { benchAsr, closeAsrSession, openAsrSession, type AsrSession } from './asr-run';
import { asrThreads } from './asr-threads';
import { callAudioNativeAvailable, cpuCores, socInfo } from './call-native';
import {
  benchReason, buildAsrCapability, isAsrCapability, isFreshCapability, preBenchReason,
  type AsrCapability,
} from './asr-capability-types';

export * from './asr-capability-types';

/** 판정 결과를 두는 곳. 🔴 캐시 폴더면 OS 가 지워 17.8초를 또 쓰게 된다. */
const CACHE_URI = `${FS.documentDirectory}asr-capability.json`;

type CapabilityFile = { version: number; byModel: Partial<Record<AsrModelId, AsrCapability>> };

async function readFile(): Promise<CapabilityFile> {
  try {
    const parsed = JSON.parse(await FS.readAsStringAsync(CACHE_URI)) as CapabilityFile;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.byModel !== 'object') return { version: 1, byModel: {} };
    return parsed;
  } catch {
    return { version: 1, byModel: {} };
  }
}

/** 저장된 판정 하나. 깨졌거나 없으면 `null`. **신선한지는 여기서 보지 않는다.** */
export async function loadAsrCapability(modelId: AsrModelId): Promise<AsrCapability | null> {
  const saved = (await readFile()).byModel[modelId];
  return isAsrCapability(saved) ? saved : null;
}

export async function saveAsrCapability(capability: AsrCapability): Promise<void> {
  const file = await readFile();
  file.byModel[capability.modelId] = capability;
  await FS.writeAsStringAsync(CACHE_URI, JSON.stringify(file));
}

/** 저장된 판정을 전부 버린다. 「다시 재 보기」 버튼이 쓸 함수다. */
export async function clearAsrCapability(): Promise<void> {
  await FS.deleteAsync(CACHE_URI, { idempotent: true });
}

/**
 * **재서** 판정한다. 저장된 값이 있어도 무시하고 다시 잰다.
 *
 * ⚠️ 모델을 열고 닫는 데에만 20초 가까이 든다. 화면은 이 함수를 부르는 동안 「재는 중」을
 * 보여 줘야 한다 — 아무 표시 없이 20초가 흐르면 사용자는 앱이 멈춘 줄 안다.
 */
export async function measureAsrCapability(modelId: AsrModelId): Promise<AsrCapability> {
  const soc = socInfo();
  const nativeAvailable = Platform.OS !== 'web' && callAudioNativeAvailable();
  const now = () => Date.now();

  // 🔴 모델 상태는 네이티브가 있는 앱에서만 본다. 없는 앱에서 파일을 뒤져 봐야 답이 바뀌지 않는다.
  const modelInstalled = nativeAvailable ? (await modelStatus(asrModel(modelId))).installed : false;
  const early = preBenchReason({ platform: Platform.OS, nativeAvailable, soc, modelInstalled });
  if (early) {
    const capability = buildAsrCapability({ reason: early, modelId, soc, encodeMs: null, now: now(), appVersion: APP_VERSION });
    await saveAsrCapability(capability).catch(() => {});
    return capability;
  }

  const threads = asrThreads(cpuCores());
  let session: AsrSession | null = null;
  try {
    // NPU/Metal 을 켜고 연다. 안 잡히면 whisper 가 조용히 CPU 로 내려가는데, 그 폴백이야말로
    // 벤치가 잡아내야 할 대상이다 — 그래서 끄고 재지 않는다.
    session = await openAsrSession(modelId, true);
    const bench = await benchAsr(session, threads);
    const capability = buildAsrCapability({
      reason: benchReason(bench.encodeMs), modelId, soc, encodeMs: bench.encodeMs,
      benchConfig: bench.config, gpu: session.gpu, threads, now: now(), appVersion: APP_VERSION,
    });
    await saveAsrCapability(capability).catch(() => {});
    return capability;
  } catch {
    // 열지도 재지도 못했다. 🔴 「불가」가 아니라 **「모른다」**다 — 캐시가 이 값을 재사용하지 않는다.
    const capability = buildAsrCapability({ reason: 'ERROR', modelId, soc, encodeMs: null, threads, now: now(), appVersion: APP_VERSION });
    await saveAsrCapability(capability).catch(() => {});
    return capability;
  } finally {
    // ⚠️ 834MB 를 쥔 채로 나가면 다음 작업이 두 개를 동시에 올리다 죽는다.
    if (session) await closeAsrSession(session).catch(() => {});
  }
}

/**
 * 판정을 얻는다 — **저장된 값이 아직 쓸 만하면 그대로, 아니면 다시 재서.**
 *
 * 화면은 이 함수만 부르면 된다.
 */
export async function asrCapability(modelId: AsrModelId): Promise<AsrCapability> {
  const saved = await loadAsrCapability(modelId);
  if (isFreshCapability(saved, modelId, APP_VERSION)) return saved as AsrCapability;
  return await measureAsrCapability(modelId);
}
