import { useState } from 'react';
import { useWindowDimensions } from 'react-native';
import type { Recipient } from '@/types/sms';
export function useRecipientTableColumns(items: Recipient[]) {
  const { width } = useWindowDimensions();
  const [preference, setPreference] = useState<boolean | null>(null);
  const allInfo = preference ?? width >= 768;
  const fields = [...new Set(items.flatMap((item) => (item.customFields ?? []).map((field) => field.name)))];
  return { allInfo, compact: width < 768 && !allInfo, viewportWidth: width, setAllInfo: setPreference, fields: allInfo ? fields : [] };
}
export function recipientSentSummary(item: Recipient) {
  return `${item.sentCount ?? 0}건 (${item.latestSentAt ? new Date(item.latestSentAt).toLocaleString('ko-KR') : '발송 이력 없음'})`;
}
