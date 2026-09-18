import type { CallDevice, CallModelState } from '@/types/calls';
type Reply = { requestId: string; value?: unknown; error?: string };
type BridgeWindow = Window & { __NATURE_CALL_BRIDGE__?: { receive(reply: Reply): void } };
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
let sequence = 0;
function supported() {
  if (typeof window === 'undefined') return false;
  const info = window.__NATURE_NATIVE__ as { callApiVersion?: number } | undefined;
  return info?.callApiVersion === 1 && !!window.ReactNativeWebView;
}
if (typeof window !== 'undefined') (window as BridgeWindow).__NATURE_CALL_BRIDGE__ = {
  receive(reply) {
    const item = pending.get(reply?.requestId);
    if (!item) return;
    pending.delete(reply.requestId); clearTimeout(item.timer);
    if (reply.error) item.reject(new Error(reply.error)); else item.resolve(reply.value);
  },
};
function invoke<T>(method: string, args?: unknown): Promise<T> {
  // 분석은 서버로 옮기는 중이고, 브라우저에서 올리는 길은 서버 업로드 API 가 붙어야 열린다.
  // 그때까지는 **할 수 없다는 사실만** 말한다 — 없는 기능을 약속하지 않는다.
  if (!supported()) return Promise.reject(new Error('지금은 Nature 앱에서만 녹음파일을 고를 수 있어요.'));
  const requestId = `call-${Date.now()}-${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('기기 응답을 확인하지 못했습니다. 통화 목록을 다시 확인해 주세요.')); }, 180_000);
    pending.set(requestId, { resolve: value => resolve(value as T), reject, timer });
    try { window.ReactNativeWebView!.postMessage(JSON.stringify({ type: 'call', requestId, method, args })); }
    catch { clearTimeout(timer); pending.delete(requestId); reject(new Error('앱 연결이 끊겼습니다.')); }
  });
}
const unavailable: CallModelState = { supported: false, installed: false, downloading: false, downloaded_bytes: 0, total_bytes: 787398153 };
export const callDevice: CallDevice = {
  models: () => supported() ? invoke('models') : Promise.resolve(unavailable),
  install: () => invoke('install'), pickFile: () => invoke('pickFile'), start: args => invoke('start', args),
  list: () => supported() ? invoke('list') : Promise.resolve([]),
  get: id => supported() ? invoke('get', { id }) : Promise.resolve(null), retry: id => invoke('retry', { id }),
};
