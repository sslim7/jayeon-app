import { smsApi } from '@/lib/sms-api';
import { smsDevice } from '@/lib/sms-device';
import { getSessionVersion } from '@/lib/auth-tokens';
import { SmsRunner } from '@/lib/sms-runner';

let sequence = 0;
export function newSmsRequestId(): string {
  // 충돌 시에도 서버가 다른 입력을 허용하지 않는다. 매 사용자 동작에서 생성해 재요청 시 유지한다.
  return `sms-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2, 14)}`;
}
export const smsDispatch = new SmsRunner(smsApi, smsDevice, getSessionVersion, newSmsRequestId);
