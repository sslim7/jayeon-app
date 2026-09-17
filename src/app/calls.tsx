import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useHeaderActions } from '@/components/app-navigation';
import { CallCreate } from '@/components/call-create';
import { CallDetail } from '@/components/call-detail';
import { TextField } from '@/components/form-fields';
import { Loading, Notice, SmsButton, SmsPage, s } from '@/components/sms-ui';
import { colors, spacing } from '@/constants/theme';
import { callApi } from '@/lib/call-api';
import { callDevice } from '@/lib/call-device';
import { formatPhone } from '@/lib/phone';
import type { CallRecord, CallStatus } from '@/types/calls';

const labels: Record<CallStatus, string> = { PENDING: '분석 대기', PREPARING: '파일 준비 중…', TRANSCRIBING: '음성 내용을 확인하고 있습니다…', ANALYZING: '통화 내용을 분석하고 있습니다…', UPLOADING: '분석 결과를 저장하고 있습니다…', COMPLETED: '분석 완료', FAILED: '분석을 완료하지 못했습니다.', TRANSCRIPTION_FAILED: '음성 변환을 완료하지 못했습니다.', ANALYSIS_FAILED: '음성 변환은 완료되었지만 AI 분석을 완료하지 못했습니다.', UPLOAD_FAILED: '분석은 완료되었지만 서버에 저장하지 못했습니다.', UPLOAD_REJECTED: '분석 결과를 서버가 받지 못했습니다. 다시 분석해 주세요.' };
const retryLabels: Partial<Record<CallStatus, string>> = { FAILED: '다시 시도', TRANSCRIPTION_FAILED: '음성 변환 다시 시도', ANALYSIS_FAILED: '분석 다시 시도', UPLOAD_FAILED: '서버 저장 다시 시도', UPLOAD_REJECTED: '분석 다시 시도' };
export default function CallsScreen() {
  const mobile = useWindowDimensions().width < 650;
  const [page, setPage] = useState(0);
  const [remote, setRemote] = useState<CallRecord[]>([]);
  const [local, setLocal] = useState<CallRecord[]>([]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<CallRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState<string | null>(null);
  const alive = useRef(true);
  const header = useMemo(() => <SmsButton label="분석하기" onPress={() => setCreating(true)} />, []);
  useHeaderActions(header);
  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([callApi.list(), callDevice.list()]);
    if (!alive.current) return;
    if (results[0].status === 'fulfilled') { setRemote(results[0].value); setError(''); }
    else setError('서버 통화 목록을 불러오지 못했습니다. 연결을 확인하고 새로고침해 주세요.');
    if (results[1].status === 'fulfilled') setLocal(results[1].value);
    setLoading(false);
  }, []);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(load);
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void callDevice.list().then((rows) => { if (alive.current) setLocal(rows); }).catch(() => {}).finally(() => { polling = false; });
    }, 2000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [load]);
  const rows = useMemo(() => {
    const merged = new Map(remote.map((item) => [item.call_id, item]));
    local.forEach((item) => merged.set(item.call_id, item));
    return [...merged.values()].filter((item) => item.contact.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => b.call.recorded_at.localeCompare(a.call.recorded_at));
  }, [local, remote, query]);
  async function retry(id: string) {
    if (retrying) return;
    setRetrying(id);
    try { await callDevice.retry(id); await load(); }
    catch { setError('다시 시작하지 못했습니다. AI 기능과 파일 접근 권한을 확인해 주세요.'); }
    finally { setRetrying(null); }
  }
  return <SmsPage title="통화분석" hideTitle wide>
    <TextField label="이름으로 필터링" value={query} onChangeText={(value) => { setQuery(value); setPage(0); }} placeholder="통화 상대 이름" />
    <Text style={s.meta}>AI 분석은 기기에서 처리됩니다. 요약을 누르면 저장된 분석 내용을 볼 수 있습니다.</Text>
    {error ? <Notice error message={error} /> : null}{loading ? <Loading /> : null}
    <ScrollView horizontal={!mobile}><View style={!mobile ? styles.table : undefined}>
      {!mobile ? <View style={[styles.row, styles.heading]}>{['이름', '전화번호', '통화일시', '요약 한 줄'].map((label, i) => <Text key={label} style={[s.meta, styles.cell, i === 3 && styles.summary]}>{label}</Text>)}</View> : null}
      {rows.slice(page * 50, (page + 1) * 50).map((item) => { const active = ['PENDING', 'PREPARING', 'TRANSCRIBING', 'ANALYZING', 'UPLOADING'].includes(item.status); return <View key={item.call_id} style={mobile ? styles.mobileRow : styles.row}>
        <Text style={[s.body, !mobile && styles.cell]}>{item.contact.name}</Text><Text selectable style={[s.body, !mobile && styles.cell]}>{formatPhone(item.contact.phone)}</Text><Text style={[s.meta, !mobile && styles.cell]}>{new Date(item.call.recorded_at).toLocaleString('ko-KR')}</Text>
        <View style={[!mobile && styles.cell, !mobile && styles.summary]}>{item.summary || item.analysis || item.status === 'COMPLETED' ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.contact.name} 통화 요약 보기`} onPress={() => setDetail(item)}><Text style={s.link} numberOfLines={1}>{(item.analysis?.summary || item.summary)?.replace(/\s+/g, ' ') || '통화 요약 보기'}</Text></Pressable> : null}
          <View style={s.row}>{active ? <ActivityIndicator color={colors.green} accessibilityLabel={labels[item.status]} /> : null}<Text accessibilityLiveRegion="polite" style={s.meta}>{labels[item.status]}{active && typeof item.progress === 'number' ? ` ${item.progress}%` : ''}</Text></View>
          {retryLabels[item.status] && local.some((row) => row.call_id === item.call_id) ? <SmsButton secondary label={retryLabels[item.status]!} disabled={retrying !== null} onPress={() => void retry(item.call_id)} /> : null}
          {(item.transcript || item.status === 'ANALYSIS_FAILED') && !item.analysis ? <SmsButton secondary label="저장된 원문 보기" onPress={() => setDetail(item)} /> : null}
        </View>
      </View>; })}
    </View></ScrollView>
    {!loading && !rows.length ? <Notice message={query ? '이름에 해당하는 통화가 없습니다.' : '분석된 통화가 없습니다. 오른쪽 위 분석하기로 시작해 보세요.'} /> : null}
    {rows.length > 50 ? <View style={s.row}><SmsButton secondary label="이전 통화" disabled={page === 0} onPress={() => setPage((p) => p - 1)} /><Text style={s.meta}>{page + 1} / {Math.ceil(rows.length / 50)}</Text><SmsButton secondary label="다음 통화" disabled={(page + 1) * 50 >= rows.length} onPress={() => setPage((p) => p + 1)} /></View> : null}
    <SmsButton secondary label="목록 새로고침" disabled={loading} onPress={() => void load()} />
    {creating ? <CallCreate onClose={() => setCreating(false)} onStarted={() => void load()} /> : null}
    {detail ? <CallDetail key={detail.call_id} item={detail} onClose={() => setDetail(null)} /> : null}
  </SmsPage>;
}
const styles = StyleSheet.create({ mobileRow: { borderBottomWidth: 1, borderColor: colors.borderCard, paddingVertical: spacing.lg, gap: spacing.sm }, table: { minWidth: 890, flexGrow: 1 }, row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.borderCard, alignItems: 'center' }, heading: { backgroundColor: colors.sageRow }, cell: { width: 155, padding: spacing.md }, summary: { width: 425, gap: spacing.sm } });
