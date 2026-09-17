import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Choice, Loading, Notice, SmsButton, s, smsError } from '@/components/sms-ui';
import { colors } from '@/constants/theme';
import { templateApi } from '@/lib/sms-api';
import type { MessageTemplate } from '@/types/sms';

/**
 * 예약은 「템플릿 하나 + 선택한 수신자」로 캠페인을 만들되 발송은 시작하지 않는 것이다.
 * 그래서 이 시트에서 고를 것은 템플릿뿐이고, 본문 작성은 발송 흐름에 그대로 남겨 둔다.
 */
export function ReserveSheet({ count, busy, onClose, onReserve }: {
  count: number;
  busy: boolean;
  onClose: () => void;
  onReserve: (template: MessageTemplate) => void;
}) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    templateApi.list().then(setTemplates).catch((e) => setError(smsError(e))).finally(() => setLoading(false));
  }, []);
  const template = templates.find((item) => item.id === selected);
  return (
    <BottomSheet title="예약하기" visible onClose={onClose}>
      <Text style={s.subtitle}>수신자 {count}명 선택</Text>
      <Notice message="템플릿을 고르면 발송하지 않은 예약으로 저장합니다. 실제 발송은 「예약 문자 보내기」에서 합니다." />
      {loading ? <Loading /> : error ? <Notice error message={error} /> : !templates.length ? (
        <Notice message="등록된 템플릿이 없습니다. 헤더의 템플릿 버튼에서 먼저 등록해 주세요." />
      ) : templates.map((item) => (
        <View key={item.id} style={[s.card, selected === item.id && { borderColor: colors.greenText }]}>
          <Choice plain label={item.name} selected={selected === item.id} disabled={busy} onPress={() => setSelected(item.id)} />
          <Text style={s.body}>{item.message || '이미지 메시지'}</Text>
          <Text style={s.meta}>첨부 {item.attachments.length}개</Text>
        </View>
      ))}
      <SmsButton label="예약하기" accessibilityLabel="예약 확인" disabled={busy || !template} onPress={() => { if (template) onReserve(template); }} />
    </BottomSheet>
  );
}
