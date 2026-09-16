import { useState } from 'react';
import { useWindowDimensions } from 'react-native';
import type { Recipient } from '@/types/sms';
/** 이 폭 미만을 폰 화면으로 본다. */
export const COMPACT_MAX_WIDTH = 768;
export function useRecipientTableColumns(items: Recipient[]) {
  const { width } = useWindowDimensions();
  const [preference, setPreference] = useState<boolean | null>(null);
  const allInfo = preference ?? width >= COMPACT_MAX_WIDTH;
  const fields = [...new Set(items.flatMap((item) => (item.customFields ?? []).map((field) => field.name)))];
  return { allInfo, compact: width < COMPACT_MAX_WIDTH && !allInfo, viewportWidth: width, setAllInfo: setPreference, fields: allInfo ? fields : [] };
}
export function recipientSentSummary(item: Recipient, short = false) {
  if (!item.sentCount) return '';
  // 한 줄 목록에서는 날짜를 월/일만 남긴다(전체 시각은 이력 시트에서 확인).
  if (short) {
    const date = item.latestSentAt ? new Date(item.latestSentAt) : null;
    return `${item.sentCount}건${date ? `·${date.getMonth() + 1}/${date.getDate()}` : ''}`;
  }
  return `${item.sentCount}건${item.latestSentAt ? ` (${new Date(item.latestSentAt).toLocaleString('ko-KR')})` : ''}`;
}
