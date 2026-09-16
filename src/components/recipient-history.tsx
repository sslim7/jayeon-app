import { formatPhone } from '@/lib/phone';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { AttachmentPreview } from '@/components/message-attachments';
import { Loading, Notice, s, smsError, statusLabel } from '@/components/sms-ui';
import { recipientApi } from '@/lib/sms-api';
import type { Recipient, RecipientHistory } from '@/types/sms';
export function RecipientHistorySheet({ recipient, onClose }: { recipient: Recipient; onClose: () => void }) {
  const [items, setItems] = useState<RecipientHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void recipientApi.history(recipient.id).then((rows) => { if (live) setItems(rows); }).catch((e) => { if (live) setError(smsError(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [recipient.id]);
  return <BottomSheet title={`${recipient.name} 발송 이력`} visible onClose={onClose}>
    <Text style={s.body}>{formatPhone(recipient.phone)}</Text>
    {loading ? <Loading /> : null}{error ? <Notice error message={error} /> : null}
    {!loading && !error && !items.length ? <Notice message="발송 이력이 없습니다." /> : null}
    {items.map((item, index) => <View key={`${item.id}-${item.attemptId ?? index}`} style={s.card}>
      <Text style={s.subtitle}>{item.campaignTitle}</Text>
      <Text style={s.meta}>{statusLabel[item.status]} · {new Date(item.sentAt || item.failedAt || item.createdAt).toLocaleString('ko-KR')}</Text>
      <Text selectable style={s.body}>{item.source === 'EXTERNAL' ? '외부에서 발송한 기록입니다.' : item.message || '이미지 메시지'}</Text>
      {item.attachments?.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} />)}
      {item.errorMessage ? <Notice error message={item.errorMessage} /> : null}
    </View>)}
  </BottomSheet>;
}
