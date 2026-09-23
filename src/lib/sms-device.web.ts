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

function shellInfo(): { platform?: string; smsApiVersion?: number; messageMaxBytes?: number } | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__NATURE_NATIVE__ ?? window.__JAYEON_NATIVE__;
}

function supportedShell(): boolean {
  if (typeof window === 'undefined') return false;
  const info = shellInfo();
  return info?.platform === 'android' && info.smsApiVersion === 1 && !!window.ReactNativeWebView;
}

/**
 * 옛 껍데기의 메시지 상한. **껍데기가 자기 값을 밝히지 않을 때 쓰는 가정이다.**
 *
 * 🔴 **낙관적으로 잡으면 안 된다.** 09-17 이후의 껍데기는 웹이 보낸 원문이 64KB 를 넘으면
 * **통째로 버렸고**, 첨부는 base64 로 그 통로를 건넌다 — 첨부 47.7KB 부터 발송 메시지가
 * 사라졌고 서버의 수신자는 `SENDING` 으로 잠긴 채 남았다(2026-09-23). 값을 밝히는 껍데기가
 * 나오기 전에 깔린 빌드가 지금 사용자 폰에 있으므로, **모르면 그 시절 상한으로 본다.**
 * 그러면 **웹만 배포해도** 그 폰에서 큰 첨부가 갇히는 대신 발송 직전에 분명한 문구로
 * 실패한다(→ `lib/sms-runner.ts`).
 *
 * 📌 껍데기 밖(그냥 브라우저)에서도 이 값이 나오지만 아무 일도 하지 않는다 — 거기서는
 * 발송이 단말 능력 확인에서 이미 막힌다(아래 `supportedShell`).
 */
const LEGACY_SHELL_MESSAGE_MAX_BYTES = 64 * 1024;

/**
 * 이 껍데기가 한 번에 받아 줄 수 있는 메시지 크기(→ `components/web-shell.tsx` 의
 * `SHELL_MESSAGE_MAX_BYTES`). 밝히지 않는 껍데기·브라우저에서는 옛 상한으로 가정한다.
 */
export function shellMessageMaxBytes(): number {
  const declared = shellInfo()?.messageMaxBytes;
  return typeof declared === 'number' && Number.isFinite(declared) && declared > 0
    ? declared
    : LEGACY_SHELL_MESSAGE_MAX_BYTES;
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
      reject(new Error('단말 응답을 확인하지 못했어요. 재발송하지 말고 결과 다시 확인을 눌러 주세요.'));
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
