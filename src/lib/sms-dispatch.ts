import { smsApi } from '@/lib/sms-api';
import { shellMessageMaxBytes, smsDevice } from '@/lib/sms-device';
import { getSessionVersion } from '@/lib/auth-tokens';
import { bridgeAttachmentBudget } from '@/lib/image-shrink-plan';
import { SmsRunner } from '@/lib/sms-runner';

let sequence = 0;
export function newSmsRequestId(): string {
  // 충돌 시에도 서버가 다른 입력을 허용하지 않는다. 매 사용자 동작에서 생성해 재요청 시 유지한다.
  return `sms-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2, 14)}`;
}
/**
 * 껍데기 다리를 실제로 건널 수 있는 첨부 바이트.
 *
 * 🔴 **부를 때마다 다시 읽는다.** 값을 모듈 평가 시점에 굳히면, 껍데기가 밝힌 한도를
 * 아직 못 읽은 순간(주입 전 평가·옛 껍데기 판정)이 그대로 얼어붙는다. 껍데기 밖(브라우저)
 * 과 껍데기를 끈 네이티브 빌드에서는 `Infinity` 라 아무것도 막지 않는다
 * (→ `lib/sms-device(.web).ts` 의 `shellMessageMaxBytes`).
 */
export const smsDispatch = new SmsRunner(smsApi, smsDevice, getSessionVersion, newSmsRequestId,
  () => bridgeAttachmentBudget(shellMessageMaxBytes()));
