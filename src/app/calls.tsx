import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CallCreate } from '@/components/call-create';
import { CallDetail } from '@/components/call-detail';
import { CallStages } from '@/components/call-stages';
import { TextField } from '@/components/form-fields';
import { CallPlayback } from '@/components/call-playback';
import { Fab, Loading, Notice, SmsButton, SmsPage, s } from '@/components/sms-ui';
import { ViewToggle } from '@/components/view-toggle';
import { colors, spacing } from '@/constants/theme';
import { callApi } from '@/lib/call-api';
import { callAudio } from '@/lib/call-audio';
import { callDevice } from '@/lib/call-device';
import { ACTIVE_STATUSES, currentStageLabel, elapsedLabel, skippedNotice } from '@/lib/call-progress';
import { formatPhone } from '@/lib/phone';
import { matchesRecipientQuery } from '@/lib/recipient-search';
import type { CallRecord, CallStatus } from '@/types/calls';

// 진행 중인 단계 이름은 `call-progress.ts` 가 갖는다(화면 넷으로 묶은 단계와 같은 이름이어야 한다).
const labels: Record<CallStatus, string> = { PENDING: '분석 대기', PREPARING: '분석 준비', TRANSCRIBING: '음성 변환', ANALYZING: '요약 생성', UPLOADING: '결과 저장', COMPLETED: '분석 완료', FAILED: '분석을 완료하지 못했습니다.', TRANSCRIPTION_FAILED: '음성 변환을 완료하지 못했습니다.', ANALYSIS_FAILED: '음성 변환은 완료되었지만 요약을 만들지 못했습니다.', UPLOAD_FAILED: '분석은 완료되었지만 서버에 저장하지 못했습니다.', UPLOAD_REJECTED: '분석 결과를 서버가 받지 못했습니다. 다시 분석해 주세요.' };
/** 멈춘 자리를 함께 보여 줄 상태. 실패는 「어디까지 갔는지」가 유일한 단서다. */
const STOPPED: CallStatus[] = ['FAILED', 'TRANSCRIPTION_FAILED', 'ANALYSIS_FAILED', 'UPLOAD_FAILED', 'UPLOAD_REJECTED'];
const retryLabels: Partial<Record<CallStatus, string>> = { FAILED: '다시 시도', TRANSCRIPTION_FAILED: '음성 변환 다시 시도', ANALYSIS_FAILED: '분석 다시 시도', UPLOAD_FAILED: '서버 저장 다시 시도', UPLOAD_REJECTED: '분석 다시 시도' };
export default function CallsScreen() {
  const mobile = useWindowDimensions().width < 650;
  const [page, setPage] = useState(0);
  const [remote, setRemote] = useState<CallRecord[]>([]);
  const [local, setLocal] = useState<CallRecord[]>([]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<CallRecord | null>(null);
  const [playing, setPlaying] = useState<CallRecord | null>(null);
  /** 폰에서는 열이 좁다. 기본은 요약 보기이고, 요약 한 줄은 「전체정보뷰」에서만 편다. */
  const [allInfo, setAllInfo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
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
    return [...merged.values()].filter((item) => matchesRecipientQuery(query, item.contact)).sort((a, b) => b.call.recorded_at.localeCompare(a.call.recorded_at));
  }, [local, remote, query]);
  const running = rows.some((item) => ACTIVE_STATUSES.includes(item.status));
  // 경과 시간만 1초마다 다시 그린다. 목록 재조회(2초) 타이머와 분리해 요청이 늘지 않게 한다.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  async function retry(id: string) {
    if (retrying) return;
    setRetrying(id);
    try { await callDevice.retry(id); await load(); }
    catch { setError('다시 시작하지 못했습니다. AI 기능과 파일 접근 권한을 확인해 주세요.'); }
    finally { setRetrying(null); }
  }
  // 등록은 오른쪽 아래 「+」 하나로 연다. 목록을 끝까지 내려도 자리를 잃지 않는다.
  return <SmsPage title="통화분석" hideTitle wide fab={<Fab accessibilityLabel="통화분석 등록하기" onPress={() => setCreating(true)} />}>
    {/* 검색칸은 placeholder 가 같은 말을 하므로 라벨 글자를 걷는다(낭독기에는 그대로 읽힌다). */}
    <TextField hideLabel label="이름 또는 폰번호 뒷4자리" value={query} onChangeText={(value) => { setQuery(value); setPage(0); }} placeholder="이름 또는 폰번호 뒷4자리" />
    {/*
      분석이 어디서 도는지는 곧 바뀐다(서버 분석). 지금 확실한 것만 적는다 — 순서와, 이 줄에서
      무엇을 누를 수 있는지. 녹음은 서버에 올라가기 전까지 들을 수 없으므로 그 사실도 같이 적는다.
    */}
    <Text style={s.meta}>최근 통화가 위에 옵니다. 분석이 끝난 통화는 「분석 보기」로 요약과 원문을 볼 수 있습니다. 녹음 듣기는 녹음이 서버에 저장된 뒤에 열립니다.</Text>
    <View style={s.row}>
      <Text style={s.meta}>전체 {rows.length}건</Text>
      <View style={styles.toggle}><ViewToggle allInfo={allInfo} onChange={setAllInfo} dense={mobile} /></View>
    </View>
    {error ? <Notice error message={error} /> : null}{loading ? <Loading /> : null}
    <ScrollView horizontal={!mobile}><View style={!mobile ? [styles.table, { minWidth: allInfo ? 1140 : 760 }] : undefined}>
      {!mobile ? <View style={[styles.row, styles.heading]}>
        <Text style={[s.meta, styles.cell, styles.when]}>통화일시</Text>
        <Text style={[s.meta, styles.cell, styles.name]}>이름</Text>
        <Text style={[s.meta, styles.cell, styles.phone]}>전화번호</Text>
        <Text style={[s.meta, styles.cell, styles.play]}>듣기</Text>
        <Text style={[s.meta, styles.cell, styles.state]}>상태</Text>
        {allInfo ? <Text style={[s.meta, styles.cell, styles.summary]}>요약 한 줄</Text> : null}
      </View> : null}
      {rows.slice(page * 50, (page + 1) * 50).map((item) => { const active = ACTIVE_STATUSES.includes(item.status); const elapsed = elapsedLabel(item.timing, now);
        // 네 단계는 실제로 돌고 있는 통화와 멈춘 통화에만 편다. 대기·완료까지 펴면 목록이 카드 더미가 된다.
        const stages = (active && item.status !== 'PENDING') || STOPPED.includes(item.status);
        const audio = callAudio(item);
        /*
          ▶ 는 **들을 수 있을 때만** 눌린다. 들을 수 없으면 이유를 버튼 이름에 실어 둔다 —
          줄마다 같은 문장을 적으면 목록이 안내문 더미가 되고, 낭독기는 이유를 그대로 읽는다.
        */
        const listen = <SmsButton secondary label="▶" accessibilityLabel={audio.url !== null ? `${item.contact.name} 녹음 듣기` : `${item.contact.name} 녹음 듣기 · ${audio.reason}`} disabled={audio.url === null} onPress={() => setPlaying(item)} />;
        const summary = item.summary || item.analysis || item.status === 'COMPLETED' ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.contact.name} 통화 요약 보기`} onPress={() => setDetail(item)}><Text style={s.link} numberOfLines={1}>{(item.analysis?.summary || item.summary)?.replace(/\s+/g, ' ') || '통화 요약 보기'}</Text></Pressable> : null;
        const state = <>
          {/* 끝난 통화의 상태는 「완료」가 아니라 **다음에 할 일**이다 — 분석을 열어 보는 것. */}
          {item.status === 'COMPLETED' ? <SmsButton secondary label="분석 보기" accessibilityLabel={`${item.contact.name} 분석 보기`} onPress={() => setDetail(item)} /> : null}
          {/*
            단계 카드가 펴진 행에는 **같은 말을 두 번 하지 않는다.** 카드가 단계·경과 시간·진행률을
            모두 말하므로 위의 한 줄 요약(단계명·경과·스피너)은 그 행에서 걷는다.
            카드가 없고 아직 끝나지 않은 행(대기·실패)만 한 줄로 줄여 보여 준다.
          */}
          {!stages && item.status !== 'COMPLETED' ? <View style={s.row}>{active && typeof item.progress !== 'number' ? <ActivityIndicator color={colors.green} accessibilityLabel={labels[item.status]} /> : null}<Text accessibilityLiveRegion="polite" style={s.meta}>{active ? `${currentStageLabel(item)}${elapsed ? ` · ${elapsed}` : ''}` : labels[item.status]}</Text></View> : null}
          {/* 실패 이유는 여기 한 곳에만 둔다. 카드는 「어디서 멈췄는지」만 말한다. */}
          {stages && item.error ? <Text style={s.meta}>{item.error}</Text> : null}
          {!stages && !active && elapsed ? <Text style={s.meta}>{elapsed}</Text> : null}
          {/* 부분 성공을 숨기지 않는다 — 빠진 구간이 있으면 목록에서 바로 보인다. */}
          {skippedNotice(item.timing) ? <Text style={s.meta}>{skippedNotice(item.timing)}</Text> : null}
          {stages ? <CallStages item={item} now={now} /> : null}
          {retryLabels[item.status] && local.some((row) => row.call_id === item.call_id) ? <SmsButton secondary label={retryLabels[item.status]!} disabled={retrying !== null} onPress={() => void retry(item.call_id)} /> : null}
          {(item.transcript || item.status === 'ANALYSIS_FAILED') && !item.analysis ? <SmsButton secondary label="저장된 원문 보기" onPress={() => setDetail(item)} /> : null}
        </>;
        // 폰에서는 열이 아니라 줄로 쌓는다. 가로 스크롤은 한 손으로 쓰기 어렵다.
        if (mobile) return <View key={item.call_id} style={styles.mobileRow}>
          <Text style={s.meta}>{new Date(item.call.recorded_at).toLocaleString('ko-KR')}</Text>
          <Text style={s.body}>{item.contact.name}</Text>
          <Text selectable style={s.body}>{formatPhone(item.contact.phone)}</Text>
          <View style={styles.mobileActions}>{listen}</View>
          <View style={styles.stateCell}>{state}</View>
          {allInfo ? summary : null}
        </View>;
        return <View key={item.call_id} style={styles.row}>
          <Text style={[s.meta, styles.cell, styles.when]}>{new Date(item.call.recorded_at).toLocaleString('ko-KR')}</Text>
          <Text style={[s.body, styles.cell, styles.name]}>{item.contact.name}</Text>
          <Text selectable style={[s.body, styles.cell, styles.phone]}>{formatPhone(item.contact.phone)}</Text>
          <View style={[styles.cell, styles.play]}>{listen}</View>
          <View style={[styles.cell, styles.state, styles.stateCell]}>{state}</View>
          {allInfo ? <View style={[styles.cell, styles.summary]}>{summary}</View> : null}
        </View>; })}
    </View></ScrollView>
    {!loading && !rows.length ? <Notice message={query ? '검색어에 해당하는 통화가 없습니다.' : '분석된 통화가 없습니다. 오른쪽 아래 + 버튼으로 시작해 보세요.'} /> : null}
    {rows.length > 50 ? <View style={s.row}><SmsButton secondary label="이전 통화" disabled={page === 0} onPress={() => setPage((p) => p - 1)} /><Text style={s.meta}>{page + 1} / {Math.ceil(rows.length / 50)}</Text><SmsButton secondary label="다음 통화" disabled={(page + 1) * 50 >= rows.length} onPress={() => setPage((p) => p + 1)} /></View> : null}
    <SmsButton secondary label="목록 새로고침" disabled={loading} onPress={() => void load()} />
    {creating ? <CallCreate onClose={() => setCreating(false)} onStarted={() => void load()} /> : null}
    {detail ? <CallDetail key={detail.call_id} item={detail} onClose={() => setDetail(null)} /> : null}
    {playing ? <CallPlayback key={playing.call_id} item={playing} onClose={() => setPlaying(null)} /> : null}
  </SmsPage>;
}
const styles = StyleSheet.create({
  mobileRow: { borderBottomWidth: 1, borderColor: colors.borderCard, paddingVertical: spacing.lg, gap: spacing.sm },
  mobileActions: { flexDirection: 'row', gap: spacing.sm },
  table: { flexGrow: 1 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.borderCard, alignItems: 'center' },
  heading: { backgroundColor: colors.sageRow },
  toggle: { marginLeft: 'auto' },
  cell: { padding: spacing.md },
  // 열 폭은 담기는 것에 맞춘다 — 통화일시는 줄바꿈되면 무슨 날인지 읽기 어렵다.
  when: { width: 210 },
  name: { width: 110 },
  phone: { width: 140 },
  play: { width: 80 },
  state: { width: 220 },
  stateCell: { gap: spacing.sm },
  summary: { width: 380, gap: spacing.sm },
});
