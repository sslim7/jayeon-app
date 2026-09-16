import type { SmsDevice } from './sms-device-types';
import { unavailable } from './sms-device-types';

export type { SmsCapabilities, SmsNativeResult, SmsSendInput } from './sms-device-types';

type Reply = { requestId: string; value?: unknown; error?: string };
type SmsBridgeWindow = Window & {
  __NATURE_SMS_BRIDGE__?: { receive(reply: Reply): void };
  __JAYEON_SMS_BRIDGE__?: { receive(reply: Reply): void };
};

const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
let sequence = 0;

function supportedShell(): boolean {
  if (typeof window === 'undefined') return false;
  const info = (window.__NATURE_NATIVE__ ?? window.__JAYEON_NATIVE__) as { platform?: string; smsApiVersion?: number } | undefined;
  return info?.platform === 'android' && info.smsApiVersion === 1 && !!window.ReactNativeWebView;
}

// SMS 응답은 별도 수신구로 받는다. 기존 라우팅/인증 메시지 형식을 바꾸지 않는다.
if (typeof window !== 'undefined') {
  (window as SmsBridgeWindow).__NATURE_SMS_BRIDGE__ = {
    receive(reply) {
      if (!reply || typeof reply.requestId !== 'string') return;
      const call = pending.get(reply.requestId);
      if (!call) return;
      pending.delete(reply.requestId);
      clearTimeout(call.timer);
      if (reply.error) call.reject(new Error(reply.error));
      else call.resolve(reply.value);
    },
  };
  // 이미 배포된 껍데기의 SMS 결과도 같은 pending 요청으로 수렴한다.
  (window as SmsBridgeWindow).__JAYEON_SMS_BRIDGE__ = (window as SmsBridgeWindow).__NATURE_SMS_BRIDGE__;
}

function invoke<T>(method: string, args?: unknown): Promise<T> {
  if (!supportedShell()) return Promise.reject(new Error('이 기능은 Android 앱에서 사용할 수 있습니다.'));
  const requestId = `sms-${Date.now()}-${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('단말 응답을 확인하지 못했어요. 재발송하지 말고 결과 동기화를 눌러 주세요.'));
    }, 150_000);
    pending.set(requestId, { resolve: (value) => resolve(value as T), reject, timer });
    try {
      window.ReactNativeWebView!.postMessage(JSON.stringify({ type: 'sms', requestId, method, args }));
    } catch {
      clearTimeout(timer);
      pending.delete(requestId);
      reject(new Error('Android 앱 연결이 끊겼어요. 발송 결과를 먼저 확인해 주세요.'));
    }
  });
}

export const smsDevice: SmsDevice = {
  getCapabilities: () => supportedShell() ? invoke('capabilities') : Promise.resolve(unavailable),
  requestPermissions: () => supportedShell() ? invoke('permissions') : Promise.resolve(unavailable),
  send: (input) => invoke('send', input),
  getResults: () => supportedShell() ? invoke('results') : Promise.resolve([]),
  acknowledge: (attemptId) => invoke('acknowledge', { attemptId }),
};
export const getCapabilities = smsDevice.getCapabilities;
export const requestPermissions = smsDevice.requestPermissions;
