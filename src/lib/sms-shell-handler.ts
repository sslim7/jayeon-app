import { smsDevice } from '@/lib/sms-device';
import { useUserStore } from '@/store/user-store';
import type { SmsSendInput } from '@/lib/sms-device-types';

export interface SmsShellRequest { type: 'sms'; requestId: string; method: string; args?: unknown }

// 호출 가능한 native 기능을 고정한다. 웹이 임의의 모듈 메서드를 실행할 수 없게 한다.
export async function handleSmsRequest(request: SmsShellRequest): Promise<object> {
  const reply = { requestId: request.requestId };
  try {
    if (typeof request.requestId !== 'string' || request.requestId.length > 150) throw new Error('잘못된 요청');
    if (useUserStore.getState().stage !== 'authed') throw new Error('로그인이 필요해요');
    let value: unknown;
    switch (request.method) {
      case 'capabilities': value = await smsDevice.getCapabilities(); break;
      case 'permissions': value = await smsDevice.requestPermissions(); break;
      case 'results': value = await smsDevice.getResults(); break;
      case 'send': {
        const input = request.args as SmsSendInput | undefined;
        if (!input || typeof input.campaignRecipientId !== 'string' || typeof input.attemptId !== 'string' ||
          typeof input.phone !== 'string' || typeof input.message !== 'string' || !Number.isInteger(input.subscriptionId)) {
          throw new Error('발송 요청이 올바르지 않아요');
        }
        if (input.attachments !== undefined && (!Array.isArray(input.attachments) || input.attachments.length > 3 ||
          input.attachments.some(file => !file || typeof file.name !== 'string' || file.name.length > 255 ||
            !['image/jpeg', 'image/png'].includes(file.mimeType) || typeof file.dataBase64 !== 'string' || file.dataBase64.length > 409600))) {
          throw new Error('첨부파일이 올바르지 않아요');
        }
        if (input.attachments?.length && (await smsDevice.getCapabilities()).mmsSupported !== true) {
          throw new Error('이미지 발송을 지원하는 앱이 필요해요');
        }
        value = await smsDevice.send(input);
        break;
      }
      case 'acknowledge': {
        const args = request.args as { attemptId?: unknown } | undefined;
        if (typeof args?.attemptId !== 'string') throw new Error('발송 식별자가 없어요');
        await smsDevice.acknowledge(args.attemptId);
        break;
      }
      default: throw new Error('지원하지 않는 SMS 기능이에요');
    }
    return { ...reply, value };
  } catch {
    // native 예외 문자열에 수신번호가 섞여도 웹/로그에 그대로 내보내지 않는다.
    return { ...reply, error: '단말 SMS 작업을 완료하지 못했어요. 권한·SIM과 발송 결과를 확인해 주세요.' };
  }
}
