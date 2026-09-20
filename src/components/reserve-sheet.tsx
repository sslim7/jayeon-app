import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Loading, Notice, SmsButton, s, smsError } from '@/components/sms-ui';
import { colors } from '@/constants/theme';
import { templateApi } from '@/lib/sms-api';
import type { MessageTemplate } from '@/types/sms';

/**
 * 예약은 「템플릿 하나 + 선택한 수신자」로 캠페인을 만들되 발송은 시작하지 않는 것이다.
 * 그래서 이 시트에서 고를 것은 템플릿뿐이고, 본문 작성은 발송 흐름에 그대로 남겨 둔다.
 *
 * 🔴 **고르는 모양은 「템플릿 가져오기」와 같다**(→ `app/sms/new.tsx` 의 같은 이름 시트).
 * 예전에는 여기만 카드 머리에 작은 체크박스(□)를 두었는데, 발송 흐름에서는 「〇〇 템플릿 선택」
 * 버튼이 또렷하게 서 있다 보니 **같은 일을 하는 두 화면이 서로 다르게 생겨서** 예약 시트에서는
 * 무엇을 눌러야 하는지 알기 어려웠다. 실기기에서 나온 지적이 그것이다.
 *
 * ⚠️ 그러면서도 **누르는 즉시 예약하지는 않는다.** 예약은 서버에 캠페인을 만드는 일이라
 * 되돌리려면 취소가 필요하다 — 고르기와 확정을 두 걸음으로 나눠 둔 지금 구조를 유지한다.
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
      ) : templates.map((item) => {
        const on = selected === item.id;
        return (
          <View key={item.id} style={[s.card, on && { borderColor: colors.greenText }]}>
            <Text style={s.subtitle}>{item.name}</Text>
            <Text style={s.body}>{item.message || '이미지 메시지'}</Text>
            <Text style={s.meta}>첨부 {item.attachments.length}개</Text>
            {/* 고른 것은 초록 테두리로 보이지만, 낭독기에는 테두리가 없다 — 라벨에 적는다. */}
            <SmsButton
              label={`${item.name} 템플릿 선택`}
              accessibilityLabel={on ? `${item.name} 템플릿 선택됨` : `${item.name} 템플릿 선택`}
              secondary={!on}
              disabled={busy}
              onPress={() => setSelected(item.id)}
            />
          </View>
        );
      })}
      {/* 확정 버튼은 **무엇을 몇 명에게** 예약하는지 그대로 적는다. 고르기 전에는 누를 수 없다. */}
      <SmsButton
        label={template ? `「${template.name}」 템플릿으로 ${count}명 예약하기` : '템플릿을 먼저 선택해 주세요'}
        accessibilityLabel="예약 확인"
        disabled={busy || !template}
        onPress={() => { if (template) onReserve(template); }}
      />
    </BottomSheet>
  );
}
