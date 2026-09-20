/**
 * 기기 판정 — **웹 쪽.**
 *
 * 🔴 `whisper.rn` 을 import 하면 웹 번들이 깨진다. 웹에서는 잴 것도 없으므로 **「불가」를
 * 그 이유와 함께** 돌려준다. 판정 규칙 자체는 순수 파일에 있어 그대로 쓴다.
 *
 * ⚠️ `AsrModelId` 는 **타입으로만** 가져온다. 값으로 가져오면 `asr-models` 가 딸려 들어와
 * 웹 번들에 547MB 짜리 다운로드 코드가 실린다.
 */
import type { AsrModelId } from './asr-models';
import { buildAsrCapability, type AsrCapability } from './asr-capability-types';

export * from './asr-capability-types';

function webCapability(modelId: AsrModelId): AsrCapability {
  return buildAsrCapability({ reason: 'WEB', modelId, soc: null, encodeMs: null, now: Date.now(), appVersion: '' });
}

/** 웹에는 저장된 판정이 없다. 대신 「웹이라 안 된다」를 그대로 돌려준다. */
export function loadAsrCapability(modelId: AsrModelId): Promise<AsrCapability | null> {
  return Promise.resolve(webCapability(modelId));
}

export function saveAsrCapability(_capability: AsrCapability): Promise<void> {
  return Promise.resolve();
}

export function clearAsrCapability(): Promise<void> {
  return Promise.resolve();
}

export function measureAsrCapability(modelId: AsrModelId): Promise<AsrCapability> {
  return Promise.resolve(webCapability(modelId));
}

export function asrCapability(modelId: AsrModelId): Promise<AsrCapability> {
  return Promise.resolve(webCapability(modelId));
}
