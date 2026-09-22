/**
 * 수신자 표 열 배치의 저장소.
 *
 * 📌 **이 기기에만 둔다.** 열 너비는 보는 화면의 폭에 달린 값이라 데스크톱에서 잡은 너비가
 * 폰에서 맞을 이유가 없고, 서버에 두면 이 화면 하나를 고치는 데 서버 배포가 묶인다.
 *
 * 🔴 **읽기·쓰기 실패는 삼킨다.** 사생활 보호 모드나 저장소 차단에서 `localStorage` 접근은
 * 던지는데, 그걸 그대로 올리면 열 배치를 못 읽었다는 이유로 수신자 표가 통째로 안 그려진다.
 * 배치를 잃는 것은 불편이고, 목록을 못 보는 것은 일이 멈추는 것이다.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { isRecipientColumnLayout, recipientColumnStoreKey as key, type RecipientColumnLayout } from '@/lib/recipient-columns';

// 🔴 칸 이름(계정별로 갈리는 규칙)은 순수 모듈에 있다 — 테스트로 고정하기 위해서다
// (→ `lib/recipient-columns.ts` 의 `recipientColumnStoreKey`).

export async function readRecipientColumnLayout(userId: string): Promise<RecipientColumnLayout | null> {
  try {
    const raw = Platform.OS === 'web' ? localStorage.getItem(key(userId)) : await SecureStore.getItemAsync(key(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // 모양이 어긋나면 던지지 않고 없는 셈 친다 → 화면은 기본 배치로 돈다.
    return isRecipientColumnLayout(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeRecipientColumnLayout(userId: string, layout: RecipientColumnLayout): Promise<void> {
  try {
    const raw = JSON.stringify(layout);
    if (Platform.OS === 'web') localStorage.setItem(key(userId), raw);
    else await SecureStore.setItemAsync(key(userId), raw);
  } catch {
    // 저장 실패는 조용히 넘긴다. 다음 접속에서 기본 배치로 보일 뿐, 지금 하던 일은 이어진다.
  }
}

export async function clearRecipientColumnLayout(userId: string): Promise<void> {
  try {
    if (Platform.OS === 'web') localStorage.removeItem(key(userId));
    else await SecureStore.deleteItemAsync(key(userId));
  } catch {
    // 지우기 실패도 마찬가지. 화면 위의 배치는 이미 기본값으로 돌아가 있다.
  }
}
