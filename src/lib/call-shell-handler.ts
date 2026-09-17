import { callDevice } from './call-device';
import type { CallStartInput } from '@/types/calls';
export interface CallShellRequest { type: 'call'; requestId: string; method: string; args?: unknown }
export async function handleCallRequest(request: CallShellRequest): Promise<object> {
  const reply = { requestId: request.requestId };
  try {
    if (typeof request.requestId !== 'string' || request.requestId.length > 150) throw new Error();
    let value: unknown;
    switch (request.method) {
      case 'models': value = await callDevice.models(); break;
      case 'install': value = await callDevice.install(); break;
      case 'pickFile': value = await callDevice.pickFile(); break;
      case 'start': value = await callDevice.start(request.args as CallStartInput); break;
      case 'list': value = await callDevice.list(); break;
      case 'get': case 'retry': {
        const args = request.args as { id?: unknown } | undefined;
        if (typeof args?.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(args.id)) throw new Error();
        value = request.method === 'get' ? await callDevice.get(args.id) : await callDevice.retry(args.id);
        break;
      }
      default: throw new Error();
    }
    return { ...reply, value };
  } catch {
    // Native failures can contain file paths or transcript excerpts. Do not forward them.
    return { ...reply, error: '기기 작업을 완료하지 못했습니다. AI 기능 설치, 저장 공간, 녹음파일과 입력 내용을 확인해 주세요.' };
  }
}
