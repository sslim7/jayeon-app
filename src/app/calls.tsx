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
import { CALL_BATCH, callApi } from '@/lib/call-api';
import { audioReady, callAudio } from '@/lib/call-audio';
import { callFailureText } from '@/lib/call-errors';
import { isActive, isFailed, elapsedLabel, formatDuration, stageText } from '@/lib/call-progress';
import { formatPhone } from '@/lib/phone';
import type { CallRecord, CallStatus } from '@/types/calls';

/**
 * 상태 한 줄. 진행 중인 통화는 서버가 보낸 `stage` 를 쓰고(→ `lib/call-progress.ts`), 여기
 * 적힌 말은 그 값이 없을 때의 기본값이자 끝난 상태의 이름이다.
 */
const labels: Record<CallStatus, string> = {
  PENDING: '업로드 대기', PREPARING: '분석 준비', TRANSCRIBING: '음성 변환', ANALYZING: '분석', COMPLETED: '분석 완료',
  TRANSCRIPTION_FAILED: '받아쓰기를 완료하지 못했습니다.', ANALYSIS_FAILED: '내용 정리를 완료하지 못했습니다.',
  UPLOADING: '업로드 중', UPLOAD_FAILED: '서버에 저장하지 못했습니다.', UPLOAD_REJECTED: '서버가 이 분석을 받지 않았습니다.', FAILED: '분석을 완료하지 못했습니다.',
};
/**
 * 진행 중인 통화를 다시 물어보는 간격.
 *
 * 5초다. 상세 조회는 서명 URL 을 새로 발급하고 작업 문서를 한 번 더 읽으므로 목록 조회보다
 * 비싸고, 서버 단계가 바뀌는 데는 수십 초가 걸린다 — 2초로 조르면 같은 답을 스무 번 더 받을
 * 뿐이다. 🔴 **진행 중인 통화가 없으면 아예 돌지 않는다.**
 */
const POLL_MS = 5_000;
/** 한 번에 물어보는 진행 중 통화 수. 한꺼번에 등록해도 요청이 폭주하지 않게 끊는다. */
const POLL_MAX = 5;
/** 타이핑이 멎었다고 보는 시간. 짧으면 요청이 늘고 길면 「반응이 없다」로 느껴진다. */
const SEARCH_DEBOUNCE_MS = 300;

export default function CallsScreen() {
  const mobile = useWindowDimensions().width < 650;
  const [rowsById, setRowsById] = useState<CallRecord[]>([]);
  /** 서버의 다음 페이지 표. `null` 이면 더 없다. */
  const [cursor, setCursor] = useState<string | null>(null);
  const [appending, setAppending] = useState(false);
  /** 입력칸에 적힌 글자. 타이핑마다 요청을 보내지 않으려고 아래 `search` 와 나눠 둔다. */
  const [query, setQuery] = useState('');
  /** 서버에 실제로 보낸 검색어. `query` 가 멎은 뒤에야 따라온다. */
  const [search, setSearch] = useState('');
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
  /** 받은 통화 한 건을 목록에 덮어쓴다. 폴링·재분석이 같은 길을 쓴다. */
  const merge = useCallback((item: CallRecord) => {
    setRowsById((rows) => rows.map((row) => row.call_id === item.call_id ? { ...row, ...item } : row));
  }, []);
  /**
   * 지금 화면이 보여 주는 검색어. **응답이 늦게 도착해도 지난 검색 결과를 그리지 않게 하는
   * 열쇠다** — 「김」을 지우고 「박」을 친 뒤 「김」의 응답이 오면, 사용자는 자기가 지운 검색
   * 결과를 보게 된다.
   */
  const showing = useRef('');
  // 첫 묶음만 받는다. 나머지는 아래로 내릴 때 이어 받는다(→ `more`).
  const load = useCallback(async (q: string) => {
    showing.current = q;
    setLoading(true);
    try {
      // 🔴 **검색어가 바뀌면 커서를 버린다.** 다른 검색어로 만든 위치에서 이어 읽으면 서버가
      // 400 을 준다(커서 안에 그 검색어가 들어 있다).
      const page = await callApi.batch({ q });
      if (!alive.current || showing.current !== q) return;
      setRowsById(page.items); setCursor(page.nextCursor); setError('');
    } catch {
      if (alive.current && showing.current === q) setError('통화 목록을 불러오지 못했습니다. 연결을 확인하고 잠시 뒤 다시 열어 주세요.');
    } finally {
      if (alive.current && showing.current === q) setLoading(false);
    }
  }, []);
  /** 바닥이 가까워지면 다음 묶음을 잇는다. 같은 통화가 두 번 들어오지 않게 id 로 거른다. */
  const more = useCallback(async () => {
    if (!cursor || appending || loading) return;
    const q = showing.current;
    setAppending(true);
    try {
      const next = await callApi.batch({ q, cursor });
      if (!alive.current || showing.current !== q) return;
      setRowsById((rows) => { const seen = new Set(rows.map((row) => row.call_id)); return [...rows, ...next.items.filter((row) => !seen.has(row.call_id))]; });
      setCursor(next.nextCursor);
    } catch { if (alive.current && showing.current === q) setError('다음 통화를 불러오지 못했습니다. 연결을 확인해 주세요.'); }
    finally { if (alive.current && showing.current === q) setAppending(false); }
  }, [cursor, appending, loading]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  /**
   * 타이핑이 멎은 뒤에 검색한다.
   *
   * 한 글자마다 부르면 「홍길동」을 치는 동안 요청이 여섯 번 나가고, 그 여섯 번이 전부 서버의
   * 문서 스캔이다. 첫 실행에서는 둘 다 빈 문자열이라 기다림 없이 바로 전체 목록을 받는다.
   */
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === search) return;
    const timer = setTimeout(() => setSearch(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, search]);
  // 다음 틱으로 미룬다. 효과 안에서 곧바로 상태를 바꾸면 렌더 중 갱신으로 잡힌다(react-compiler 규칙).
  useEffect(() => { void Promise.resolve().then(() => load(search)); }, [load, search]);
  /**
   * 🔴 **여기서 다시 거르지 않는다.** 거르기는 서버가 한다 — 클라이언트 필터를 남겨 두면
   * 서버가 찾아 준 통화를 앱이 한 번 더 떨어뜨리고(규칙이 어긋나는 순간 조용히), 「받아 온
   * 범위 안에서만 찾는다」는 옛 한계가 그대로 돌아온다.
   */
  const loaded = useMemo(() => [...rowsById].sort((a, b) => b.call.recorded_at.localeCompare(a.call.recorded_at)), [rowsById]);
  const rows = loaded;
  /**
   * 진행 중인 통화의 ID. **이 값이 비면 폴링도 시계도 돌지 않는다** — 끝난 목록을 열어 둔
   * 화면이 5초마다 서버를 부를 이유가 없다.
   */
  const pending = useMemo(() => loaded.filter((item) => isActive(item.status)).slice(0, POLL_MAX).map((item) => item.call_id).join(','), [loaded]);
  useEffect(() => {
    if (!pending) return;
    const ids = pending.split(',');
    let polling = false;
    const tick = () => {
      if (polling) return;
      polling = true;
      // 🔴 목록이 아니라 **상세**를 묻는다. 진행 중 한 건의 단계가 궁금한 것인데 목록을 다시
      // 받으면 30건을 통째로 받게 되고, 그래도 `stage` 말고는 새로 알 것이 없다.
      void Promise.allSettled(ids.map((id) => callApi.get(id)))
        .then((results) => { if (!alive.current) return; for (const result of results) if (result.status === 'fulfilled' && result.value) merge(result.value); })
        .finally(() => { polling = false; });
    };
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, merge]);
  // 경과 시간만 1초마다 다시 그린다. 폴링 타이머와 분리해 요청이 늘지 않게 한다.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  /**
   * 다시 시도 = **`reanalyze`.**
   *
   * 오디오를 다시 전사하지 않고 저장된 원문으로 분석만 다시 돌린다 — 전사가 이 파이프라인에서
   * 가장 비싼 단계이고, 다시 분석해야 하는 이유는 대개 분석 쪽에서 났기 때문이다.
   */
  async function retry(id: string) {
    if (retrying) return;
    setRetrying(id);
    try { merge(await callApi.reanalyze(id)); setError(''); }
    catch { setError('다시 분석하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'); }
    finally { setRetrying(null); }
  }
  // 등록은 오른쪽 아래 「+」 하나로 연다. 목록을 끝까지 내려도 자리를 잃지 않는다.
  return <SmsPage title="통화분석" hideTitle wide fab={<Fab accessibilityLabel="통화분석 등록하기" onPress={() => setCreating(true)} />} onEndReached={() => void more()}>
    {/* 검색칸은 placeholder 가 같은 말을 하므로 라벨 글자를 걷는다(낭독기에는 그대로 읽힌다). */}
    <TextField hideLabel label="이름 또는 폰번호 뒷4자리" value={query} onChangeText={setQuery} placeholder="이름 또는 폰번호 뒷4자리" />
    {/*
      🔧 **여기에 안내 문단을 두지 않는다.** 목록을 열 때마다 읽히는 자리인데 읽을 이유는 한
      번뿐이고, 그 한 번은 파일을 올리기 **직전**이어야 한다 — 원본 녹음이 서버에 올라가
      보관된다는 사실은 등록 시트가 말한다(→ `components/call-create.tsx`). 목록은 목록을 보인다.
    */}
    <View style={s.row}>
      {/* 🔴 「검색 N건」은 **지금까지 받은 수**다. 커서가 남아 있으면 더 있을 수 있다는 뜻으로 읽히게 적는다. */}
      <Text style={s.meta}>{search ? `검색 결과 ${loaded.length}건${cursor ? '+' : ''}` : `불러온 ${loaded.length}건`}</Text>
      <View style={styles.toggle}><ViewToggle allInfo={allInfo} onChange={setAllInfo} dense={mobile} /></View>
    </View>
    {error ? <Notice error message={error} /> : null}{loading ? <Loading /> : null}
    {/*
      `contentContainerStyle` 의 `flexGrow` 가 없으면 표가 **내용 폭에서 끝나** 넓은 화면에서
      머리글 배경만 중간에 잘린 것처럼 보인다. 남는 자리는 마지막 열(`fill`)이 가져간다.
    */}
    <ScrollView horizontal={!mobile} contentContainerStyle={!mobile ? styles.tableContent : undefined}><View style={!mobile ? [styles.table, { minWidth: allInfo ? 1210 : 830 }] : undefined}>
      {!mobile ? <View style={[styles.row, styles.heading]}>
        <Text style={[s.meta, styles.cell, styles.when]}>통화일시</Text>
        <Text style={[s.meta, styles.cell, styles.name]}>이름</Text>
        <Text style={[s.meta, styles.cell, styles.phone]}>전화번호</Text>
        <Text style={[s.meta, styles.cell, styles.play]}>통화시간</Text>
        <Text style={[s.meta, styles.cell, styles.state, !allInfo && styles.fill]}>상태</Text>
        {allInfo ? <Text style={[s.meta, styles.cell, styles.summary, styles.fill]}>요약 한 줄</Text> : null}
      </View> : null}
      {rows.map((item) => { const active = isActive(item.status); const failed = isFailed(item.status);
        // 네 단계는 실제로 돌고 있는 통화와 멈춘 통화에만 편다. 완료까지 펴면 목록이 카드 더미가 된다.
        const stages = active || failed;
        /*
          통화 길이와 ▶ 를 한 칸에 둔다. 길이는 전사 전에는 없으므로 그 자리는 비우고 버튼만
          남긴다 — 「0초」로 채우면 없는 값을 아는 척하는 것이다.

          🔴 목록 응답에는 녹음 주소가 없다. 서버가 주는 것은 `has_audio` 하나뿐이고, 그것이
          버튼을 열지 정하는 유일한 근거다(주소는 패널이 상세에서 받는다).
        */
        const ready = audioReady(item);
        const spoken = item.call.duration ? formatDuration(item.call.duration * 1000) : '';
        const listen = <View style={styles.playCell}>
          {spoken ? <Text style={s.meta}>{spoken}</Text> : null}
          <SmsButton secondary label="▶" accessibilityLabel={ready ? `${item.contact.name} 녹음 듣기` : `${item.contact.name} 녹음 듣기 · ${callAudio(item).reason}`} disabled={!ready} onPress={() => setPlaying(item)} />
        </View>;
        const summary = item.summary || item.status === 'COMPLETED' ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.contact.name} 통화 요약 보기`} onPress={() => setDetail(item)}><Text style={s.link} numberOfLines={1}>{item.summary?.replace(/\s+/g, ' ') || '통화 요약 보기'}</Text></Pressable> : null;
        const state = <>
          {/* 끝난 통화의 상태는 「완료」가 아니라 **다음에 할 일**이다 — 분석을 열어 보는 것. */}
          {item.status === 'COMPLETED' ? <SmsButton secondary label="분석 보기" accessibilityLabel={`${item.contact.name} 분석 보기`} onPress={() => setDetail(item)} /> : null}
          {/*
            단계 카드가 펴진 행에는 **같은 말을 두 번 하지 않는다.** 카드가 단계·경과 시간·진행률을
            모두 말하므로 위의 한 줄 요약은 그 행에서 걷는다.
          */}
          {!stages && item.status !== 'COMPLETED' ? <View style={s.row}><ActivityIndicator color={colors.green} accessibilityLabel={labels[item.status]} /><Text accessibilityLiveRegion="polite" style={s.meta}>{stageText(item)}{elapsedLabel(item, now) ? ` · ${elapsedLabel(item, now)}` : ''}</Text></View> : null}
          {/* 실패 이유는 여기 한 곳에만 둔다. 카드는 「어디서 멈췄는지」만 말한다. */}
          {failed ? <Text style={s.meta}>{callFailureText(item)}</Text> : null}
          {stages ? <CallStages item={item} now={now} /> : null}
          {/*
            🔴 다시 시도할 수 있는 것은 **분석이 실패한 통화뿐**이다. 받아쓰기가 실패한 통화에는
            다시 분석할 원문이 없어 서버가 409 로 거절한다 — 누를 수 있는 버튼을 세워 두고
            거절당하게 하느니, 무엇을 해야 하는지 적는다.
          */}
          {item.status === 'ANALYSIS_FAILED' ? <SmsButton secondary label="분석 다시 시도" disabled={retrying !== null} onPress={() => void retry(item.call_id)} /> : null}
          {item.status === 'TRANSCRIPTION_FAILED' ? <Text style={s.meta}>다른 녹음 파일로 다시 등록해 주세요.</Text> : null}
          {item.status === 'ANALYSIS_FAILED' ? <SmsButton secondary label="저장된 원문 보기" onPress={() => setDetail(item)} /> : null}
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
          <View style={[styles.cell, styles.state, styles.stateCell, !allInfo && styles.fill]}>{state}</View>
          {allInfo ? <View style={[styles.cell, styles.summary, styles.fill]}>{summary}</View> : null}
        </View>; })}
    </View></ScrollView>
    {/*
      🔴 **커서가 남아 있으면 「없다」고 말하지 않는다.** 검색 중에는 서버가 스캔 상한에 걸려
      0건 + 커서를 돌려줄 수 있다 — 그때 「해당하는 통화가 없습니다」를 띄우면 아직 찾는 중인
      것을 못 찾았다고 말하는 셈이다. 그 경우는 아래의 「더 찾는 중」이 맡는다.
    */}
    {!loading && !rows.length && !cursor ? <Notice message={search ? '검색어에 해당하는 통화가 없습니다.' : '분석된 통화가 없습니다. 오른쪽 아래 + 버튼으로 시작해 보세요.'} /> : null}
    {!loading && !appending && !rows.length && cursor ? <Text style={s.meta}>여기까지는 찾지 못했습니다. 아래로 내리면 이어서 찾습니다.</Text> : null}
    {appending ? <Loading /> : null}
    {!loading && !appending && !cursor && loaded.length > CALL_BATCH ? <Text style={s.meta}>마지막 통화까지 모두 불러왔습니다.</Text> : null}
    {/* 등록이 끝나면 **지금 보고 있는 검색어 그대로** 다시 받는다. 검색을 말없이 풀지 않는다. */}
    {creating ? <CallCreate onClose={() => setCreating(false)} onStarted={() => void load(showing.current)} /> : null}
    {detail ? <CallDetail key={detail.call_id} item={detail} onClose={() => setDetail(null)} /> : null}
    {playing ? <CallPlayback key={playing.call_id} item={playing} onClose={() => setPlaying(null)} /> : null}
  </SmsPage>;
}
const styles = StyleSheet.create({
  mobileRow: { borderBottomWidth: 1, borderColor: colors.borderCard, paddingVertical: spacing.lg, gap: spacing.sm },
  mobileActions: { flexDirection: 'row', gap: spacing.sm },
  table: { flexGrow: 1 },
  tableContent: { flexGrow: 1 },
  /** 남는 가로 자리를 가져가는 열. 머리글과 본문에 **같이** 붙어야 두 줄의 폭이 맞는다. */
  fill: { flex: 1 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.borderCard, alignItems: 'center' },
  heading: { backgroundColor: colors.sageRow },
  toggle: { marginLeft: 'auto' },
  cell: { padding: spacing.md },
  // 열 폭은 담기는 것에 맞춘다 — 통화일시는 줄바꿈되면 무슨 날인지 읽기 어렵다.
  when: { width: 210 },
  name: { width: 110 },
  phone: { width: 140 },
  play: { width: 150 },
  playCell: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  state: { width: 220 },
  stateCell: { gap: spacing.sm },
  summary: { width: 380, gap: spacing.sm },
});
