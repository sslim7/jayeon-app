import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Loading, Notice, SmsButton, SmsPage, s, smsError, statusLabel } from '@/components/sms-ui';
import { smsApi } from '@/lib/sms-api';
import { readSmsLeave, smsExit, SMS_LEAVE_PARAM, SMS_ORIGIN_PARAM } from '@/lib/sms-origin';
import type { Campaign } from '@/types/sms';
export default function CampaignsScreen() {
  // 상세를 닫고 여기로 돌아온 경우의 한 줄. 어느 화면으로 돌아가 무슨 말을 할지는 출처가
  // 정한다(→ `lib/sms-origin.ts`).
  const params = useLocalSearchParams<{ closed?: string }>();
  const [notice] = useState(() => {
    const leave = readSmsLeave(params[SMS_LEAVE_PARAM]);
    return leave ? smsExit('history', leave).notice : '';
  });
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
      {notice ? <Notice message={notice} /> : null}
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
              // ⚠️ 출처를 실어 보낸다 — 안 실으면 상세의 「닫기」가 발송 이력이 아니라 문자 보내기로 나간다.
              onPress={() => router.push({ pathname: '/sms/[id]', params: { id: c.id, [SMS_ORIGIN_PARAM]: 'history' } })}
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
