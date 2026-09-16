import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { Loading, Notice, SmsButton, SmsPage, s, smsError, statusLabel } from '@/components/sms-ui';
import { smsApi } from '@/lib/sms-api';
import type { Campaign } from '@/types/sms';
export default function CampaignsScreen() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await smsApi.list());
      setError('');
    } catch (e) {
      setError(smsError(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  return (
    <SmsPage title="발송 이력">
      <SmsButton label="새 문자 작성" onPress={() => router.push('/sms/new')} />
      <Notice message="성공은 Android의 발송 요청 성공입니다. 수신 또는 읽음 확인을 의미하지 않습니다." />
      {error ? <Notice error message={error} /> : null}
      {loading ? (
        <Loading />
      ) : !rows.length ? (
        <Notice message="아직 발송 이력이 없습니다." />
      ) : (
        rows.map((c) => (
          <View key={c.id} style={s.card}>
            <Text selectable style={s.subtitle}>
              {c.title}
            </Text>
            <Text style={s.meta}>
              {statusLabel[c.status]} · {c.recipientCount}명 ·{' '}
              {new Date(c.createdAt).toLocaleString('ko-KR')}
            </Text>
            <Text numberOfLines={3} style={s.body}>
              {c.message}
            </Text>
            <SmsButton
              label={`${c.title} 상세 보기`}
              secondary
              onPress={() => router.push({ pathname: '/sms/[id]', params: { id: c.id } })}
            />
          </View>
        ))
      )}
      <SmsButton
        label="발송 이력 새로고침"
        secondary
        disabled={loading}
        onPress={() => void load()}
      />
    </SmsPage>
  );
}
