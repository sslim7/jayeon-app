import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { CreateCampaignInput } from '@/types/sms';
// Nature 전환에서도 미확정 요청·발송 결과와 로그인 복구를 위해 저장 식별자는 유지한다.
const key = (userId: string) =>
  `jayeon.sms.draft.${Array.from(userId)
    .map((c) => c.codePointAt(0)!.toString(16))
    .join('_')}`;
export async function readSmsDraft(userId: string): Promise<CreateCampaignInput | null> {
  const raw =
    Platform.OS === 'web'
      ? localStorage.getItem(key(userId))
      : await SecureStore.getItemAsync(key(userId));
  if (!raw) return null;
  const draft = JSON.parse(raw) as CreateCampaignInput;
  if (
    !draft ||
    typeof draft.requestId !== 'string' ||
    typeof draft.title !== 'string' ||
    typeof draft.message !== 'string' ||
    !Array.isArray(draft.recipientIds) ||
    !draft.recipientIds.every((id) => typeof id === 'string') ||
    (draft.attachmentIds !== undefined && (!Array.isArray(draft.attachmentIds) || !draft.attachmentIds.every((id) => typeof id === 'string')))
  )
    throw new Error('저장된 발송 준비 내용을 확인할 수 없습니다.');
  return draft;
}
export async function writeSmsDraft(userId: string, draft: CreateCampaignInput): Promise<void> {
  const raw = JSON.stringify(draft);
  if (Platform.OS === 'web') localStorage.setItem(key(userId), raw);
  else await SecureStore.setItemAsync(key(userId), raw);
}
export async function clearSmsDraft(userId: string): Promise<void> {
  if (Platform.OS === 'web') localStorage.removeItem(key(userId));
  else await SecureStore.deleteItemAsync(key(userId));
}
