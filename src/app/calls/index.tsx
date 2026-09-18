import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CallCreate } from '@/components/call-create';
import { CallStages } from '@/components/call-stages';
import { TextField } from '@/components/form-fields';
import { CallPlayback } from '@/components/call-playback';
import { ButtonRow, Fab, Loading, Notice, SmsButton, SmsPage, s } from '@/components/sms-ui';
import { ViewToggle } from '@/components/view-toggle';
import { colors, spacing } from '@/constants/theme';
import { CALL_BATCH, CALL_POLL_MS, callApi } from '@/lib/call-api';
import { audioReady, callAudio } from '@/lib/call-audio';
import { callBriefTime } from '@/lib/call-date';
import { callFailureText, callRetryable } from '@/lib/call-errors';
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
 * 접힌 한 줄에 적는 상태. **한 낱말로 끊는다.**
 *
 * 위의 `labels` 는 실패 이유를 문장으로 적은 말이고, 그 문장이 한 줄 목록에 들어오면 일시와
 * 이름을 밀어내 줄이 둘·셋으로 접힌다 — 「언제 누구와」를 훑으려고 목록으로 되돌린 이유가
 * 그 순간 사라진다. 자세한 이유는 펼친 칸이 말한다.
 *
 * 🔴 **서버가 보낸 `stage` 를 여기 쓰지 않는다.** 그 값은 「업로드 완료, 순서 기다리는 중」
 * 처럼 길이가 정해져 있지 않아 같은 문제를 일으킨다. 펼친 칸의 단계 카드가 그 한 줄을 맡는다.
 */
const brief: Record<CallStatus, string> = {
  PENDING: '업로드 대기', UPLOADING: '업로드 중', PREPARING: '분석 준비', TRANSCRIBING: '음성 변환 중', ANALYZING: '분석 중', COMPLETED: '분석 완료',
  TRANSCRIPTION_FAILED: '받아쓰기 실패', ANALYSIS_FAILED: '분석 실패', UPLOAD_FAILED: '업로드 실패', UPLOAD_REJECTED: '등록 거절', FAILED: '실패',
};
/**
 * 이 통화에 **저장된 원문이 있는가.**
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️ **목록 응답만으로는 확실히 알 수 없다. 이것은 추정이다.**                        │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * 서버는 목록(`GET /calls`)에서 원문을 빼고 보내는데(§`internal/calls/model.go` 의
 * `listRecord` — 30건마다 수 MB 를 내려보내지 않으려고), **원문이 있는지 알려 주는 필드도
 * 함께 없다.** 녹음에는 `has_audio` 가 있지만 원문에는 그런 짝이 없다.
 *
 * 그래서 **작업 단계로 추정한다**: 받아쓰기를 지나야 분석이 시작되므로 `ANALYZING` 부터는
 * 원문이 있고, `TRANSCRIPTION_FAILED` 에는 없다.
 *
 * 🔴 **틀릴 수 있는 경우가 하나 남는다** — 폰에서 받아쓰기·요약까지 끝내고 결과만 올린 옛
 * 통화는 `COMPLETED` 인데 서버에 원문이 없을 수 있다. 그 통화에서는 버튼이 서고, 누르면
 * 「저장된 통화 원문이 없습니다」가 나온다. 지금 앱이 할 수 있는 최선이다.
 * 📌 **고치려면 서버가 `has_transcript`(불리언)를 목록 응답에 실어 주면 된다** —
 * `has_audio` 와 같은 자리, 같은 모양이면 이 함수는 그 한 줄로 줄어든다.
 */
const hasTranscript = (item: CallRecord): boolean =>
  item.status === 'ANALYZING' || item.status === 'COMPLETED' || item.status === 'ANALYSIS_FAILED';

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
  const [playing, setPlaying] = useState<CallRecord | null>(null);
  /**
   * 「간단뷰(기본) / 전체정보뷰」.
   *
   * 간단뷰는 **한 줄 목록 + 누른 자리에서 펼치기**다(발송 이력과 같은 규칙 —
   * §`components/campaign-history-sheet.tsx`). 전체정보뷰는 넓은 화면에서 표, 폰에서는
   * 줄 쌓기로 **모든 칸을 편 채** 보인다.
   */
  const [allInfo, setAllInfo] = useState(false);
  /**
   * 간단뷰에서 펼쳐 둔 줄. 한 번에 하나만 편다 — 여러 줄이 펼쳐지면 목록으로 되돌린 이유가 없다.
   *
   * 🔴 **`call_id` 로 들고 있다. 인덱스로 들면 안 된다** — 폴링이나 새 등록으로 앞줄이
   * 끼어드는 순간 사용자가 열어 둔 통화가 아니라 그 자리에 새로 온 통화가 펼쳐진다.
   * id 로 들고 있으면 목록이 통째로 갱신돼도 같은 통화가 열린 채 남는다.
   */
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  /** 받은 통화 한 건을 목록에 덮어쓴다. 폴링·재분석·보고서에서 돌아온 길이 모두 여기로 모인다. */
  const merge = useCallback((item: CallRecord) => {
    setRowsById((rows) => rows.map((row) => row.call_id === item.call_id ? { ...row, ...item } : row));
  }, []);
  /**
   * 보고서 화면으로 보낸 통화의 id. **돌아왔을 때 한 번만 다시 묻기 위한 표시다.**
   *
   * 🔴 **보고서를 보는 동안 이 목록은 폴링을 멈춘다**(아래 `useFocusEffect`). 그 사이에
   * 보고서가 본 변화를 목록은 모르는데, 돌아왔을 때 그 통화가 이미 끝나 있으면 폴링도
   * 손대지 않는다 — 폴링은 `isActive` 인 통화만 묻기 때문이다. 즉 **스스로는 영영 못 벗어나는
   * 상태**가 되고, 목록은 끝난 분석을 「분석 중」으로 계속 보여 준다. 사용자는 접수가 안 된
   * 줄 알고 한 번 더 누른다.
   *
   * 상태가 아니라 ref 인 이유: 이 값이 바뀐다고 목록을 다시 그릴 이유가 없다.
   */
  const visited = useRef<string | null>(null);
  /** 보고서로 간다. 목록은 이 화면 스택 아래에 그대로 남는다(→ `app/calls/_layout.tsx`). */
  const openReport = useCallback((item: CallRecord) => {
    visited.current = item.call_id;
    // 🔴 문자열을 이어 붙이지 않는다. `params` 로 넘겨야 id 안의 특수문자가 제대로 실리고,
    // typedRoutes 가 경로 오타를 컴파일 시점에 잡는다(→ app.json 의 `experiments.typedRoutes`).
    router.push({ pathname: '/calls/[id]', params: { id: item.call_id } });
  }, []);
  /** 원문으로 간다. 보고서와 **형제**다 — 하나를 보려고 다른 하나를 지나치지 않는다. */
  const openTranscript = useCallback((item: CallRecord) => {
    visited.current = item.call_id;
    router.push({ pathname: '/calls/[id]/transcript', params: { id: item.call_id } });
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
  /**
   * 🔴 **`useEffect` 가 아니라 `useFocusEffect` 다.**
   *
   * 보고서 화면을 열어도 이 목록은 스택 아래에 **살아 있다**(→ `app/calls/_layout.tsx`).
   * 그래서 평범한 효과로 타이머를 걸면 보고서가 떠 있는 내내 목록도 같은 통화를 계속 묻고,
   * 같은 통화가 5초마다 **두 번** 조회된다 — 상세 조회는 서명 URL 발급과 작업 문서 읽기를
   * 함께 하는 비싼 호출이라 그 두 배가 그대로 서버 부하가 된다. 포커스를 잃는 동안은
   * 보고서가 자기 통화를 맡는다(→ `app/calls/[id].tsx`).
   */
  useFocusEffect(useCallback(() => {
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
    const timer = setInterval(tick, CALL_POLL_MS);
    return () => clearInterval(timer);
  }, [pending, merge]));
  /**
   * 보고서에서 돌아왔다. **거기서 무슨 일이 있었는지는 목록이 모른다.**
   *
   * 🔴 다녀온 한 건만 다시 묻는다(→ 위 `visited`). 목록을 통째로 다시 받으면 무한 스크롤로
   * 쌓아 둔 페이지가 첫 묶음으로 잘려 나가 사용자가 보던 자리를 잃는다 — 화면을 살려 둔
   * 이유가 그 자리를 지키는 것인데, 여기서 다시 받으면 그 수고가 그대로 무의미해진다.
   */
  useFocusEffect(useCallback(() => {
    const id = visited.current;
    if (!id) return;
    visited.current = null;
    void callApi.get(id).then((found) => { if (alive.current && found) merge(found); }).catch(() => {});
  }, [merge]));
  // 경과 시간만 1초마다 다시 그린다. 폴링 타이머와 분리해 요청이 늘지 않게 한다.
  // 이쪽도 포커스를 따른다 — 보이지도 않는 목록을 1초마다 다시 그리는 것은 배터리만 쓴다.
  useFocusEffect(useCallback(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]));
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
  /**
   * 한 통화의 줄. 세 가지 모습 중 하나로 나온다 — 간단뷰의 접히는 줄, 전체정보뷰의 폰용 줄,
   * 전체정보뷰의 표 행. **계산은 한 번만 한다** — 듣기·상태·요약을 모습마다 따로 만들면
   * 한쪽만 고쳐지고 세 화면의 말이 달라진다.
   */
  const body = rows.map((item, index) => { const active = isActive(item.status); const failed = isFailed(item.status);
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
    const summary = item.summary || item.status === 'COMPLETED' ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.contact.name} 통화 요약 보기`} onPress={() => openReport(item)}><Text style={s.link} numberOfLines={1}>{item.summary?.replace(/\s+/g, ' ') || '통화 요약 보기'}</Text></Pressable> : null;
    const state = <>
      {/*
        **읽을 수 있는 것 둘을 나란히 세운다: 분석과 원문.**

        ┌────────────────────────────────────────────────────────────────────────┐
        │ 🔴 **무게가 다르다.** 「분석 보기」만 채운 버튼이다.                        │
        └────────────────────────────────────────────────────────────────────────┘
        분석은 이 제품이 만들어 낸 것이고 원문은 그 **근거**다 — 열에 아홉은 분석을 보러
        오고, 원문은 「분석이 이상한데」 싶을 때 확인하러 간다. 둘을 같은 무게로 세우면
        매번 어느 쪽인지 고르게 되고, 그 고민은 대부분의 경우 값이 없다.

        🔴 **원문이 있을 때만 세운다.** 눌러서 「저장된 통화 원문이 없습니다」만 보는 화면으로
        보내는 것은 버튼이 약속을 어기는 것이다(→ 위 `hasTranscript`).

        ⚠️ 한 줄에 나란히 둔다(`ButtonRow` + `fill`). 세로로 쌓으면 넓은 화면에서 **화면 폭을
        다 쓰는 막대 둘**이 되어, 읽으러 들어가는 길이 이 줄에서 가장 큰 것이 된다 — 목록은
        「언제 누구와」를 훑는 자리다. 한쪽만 설 때는 그 하나가 줄을 다 쓴다.
      */}
      {item.status === 'COMPLETED' || hasTranscript(item) ? <ButtonRow>
        {item.status === 'COMPLETED' ? <SmsButton fill label="분석 보기" accessibilityLabel={`${item.contact.name} 분석 보기`} onPress={() => openReport(item)} /> : null}
        {hasTranscript(item) ? <SmsButton fill secondary label="통화 원문" accessibilityLabel={`${item.contact.name} 통화 원문`} onPress={() => openTranscript(item)} /> : null}
      </ButtonRow> : null}
      {/*
        단계 카드가 펴진 행에는 **같은 말을 두 번 하지 않는다.** 카드가 단계·경과 시간·진행률을
        모두 말하므로 위의 한 줄 요약은 그 행에서 걷는다.
      */}
      {!stages && item.status !== 'COMPLETED' ? <View style={s.row}><ActivityIndicator color={colors.green} accessibilityLabel={labels[item.status]} /><Text accessibilityLiveRegion="polite" style={s.meta}>{stageText(item)}{elapsedLabel(item, now) ? ` · ${elapsedLabel(item, now)}` : ''}</Text></View> : null}
      {/* 실패 이유는 여기 한 곳에만 둔다. 카드는 「어디서 멈췄는지」만 말한다. */}
      {failed ? <Text style={s.meta}>{callFailureText(item)}</Text> : null}
      {stages ? <CallStages item={item} now={now} /> : null}
      {/*
        🔴 다시 시도할 수 있는 것은 **분석이 실패한 통화 중에서도 결과가 달라질 수 있는
        것뿐**이다(→ `lib/call-errors.ts` 의 `callRetryable`). 받아쓰기가 실패한 통화에는
        다시 분석할 원문이 없어 서버가 409 로 거절하고, 서버 처리 시간이 모자라 멈춘 통화는
        몇 번을 눌러도 같은 자리에서 멈춘다 — 누를 수 있는 버튼을 세워 두고 거절당하거나
        같은 실패를 되풀이하게 하느니, 위의 실패 이유가 무엇을 해야 하는지 말한다.
      */}
      {callRetryable(item) ? <SmsButton secondary label="분석 다시 시도" disabled={retrying !== null} onPress={() => void retry(item.call_id)} /> : null}
      {item.status === 'TRANSCRIPTION_FAILED' ? <Text style={s.meta}>다른 녹음 파일로 다시 등록해 주세요.</Text> : null}
      {/*
        🔧 여기 있던 「저장된 원문 보기」는 걷었다. 바로 위의 「통화 원문」이 같은 일을 하고,
        같은 줄에 같은 곳으로 가는 버튼이 둘이면 사용자는 **둘이 다른 곳으로 간다고 읽는다.**
      */}
    </>;
    /*
      **간단뷰 — 목록이 먼저다.**

      모든 줄을 펴 두면 진행 중인 통화 두세 건만으로 한 화면이 차서 「언제 누구와 통화했나」를
      훑을 수가 없다. 그래서 한 줄에는 **통화일시 · 이름 · 상태**만 세우고, 전화번호·듣기·
      단계·요약처럼 한 건을 들여다볼 때만 필요한 것은 누른 자리에서 편다(발송 이력과 같은
      규칙 — §`components/campaign-history-sheet.tsx`).

      🔴 **접힌 줄도 살아 있다.** 폴링은 화면에 무엇이 펴졌는지 보지 않고 `isActive` 인
      통화를 묻는다(위 `pending`) — 접혔다고 폴링에서 빠지면 「분석 중」이 영원히 그대로다.
    */
    if (!allInfo) {
      const open = openRow === item.call_id;
      const when = callBriefTime(item.call.recorded_at);
      /*
        🔴 **첫 줄 위에도 선을 긋는다.** 줄 사이에만 선이 있으면 목록이 어디서 시작하는지가
        화면에 없어서, 위의 「N건」과 첫 줄이 한 덩어리로 붙어 보인다. 첫 줄에만 붙이는
        이유는 나머지 줄의 위쪽은 **앞 줄의 아래 선**이 이미 긋고 있기 때문이다 — 전부에
        붙이면 줄마다 선이 두 겹으로 겹쳐 굵기가 들쭉날쭉해진다.
      */
      return <View key={item.call_id} style={[styles.briefRow, index === 0 && styles.briefFirst]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          // aria-* 로도 적는다. react-native-web 은 RN 의 `expanded` 상태를 옮기지 않는다(§sms-ui `Choice`).
          aria-expanded={open}
          accessibilityLabel={`${when} ${item.contact.name} ${brief[item.status]} ${open ? '접기' : '펼치기'}`}
          onPress={() => setOpenRow(open ? null : item.call_id)}
          style={styles.briefHead}
        >
          <Text style={s.meta}>{when}</Text>
          {/* 이름만 줄어든다 — 일시가 줄면 무슨 날인지 알 수 없고, 상태가 줄면 줄을 훑는 이유가 없다. */}
          <Text style={[s.body, styles.briefName]} numberOfLines={1}>{item.contact.name}</Text>
          <View style={styles.briefState}>
            {/* 돌아가는 원은 옆 글자가 같은 말을 하므로 접근성 트리에서 숨긴다. */}
            {active ? <ActivityIndicator size="small" color={colors.green} aria-hidden /> : null}
            <Text accessibilityLiveRegion="polite" style={[s.meta, failed && styles.failedText]}>{brief[item.status]}</Text>
          </View>
          {/*
            여닫기 화살표. **상태 글자 바깥, 줄의 오른쪽 끝**에 선다.

            🔴 이것은 **표시이지 버튼이 아니다.** 누르는 자리는 지금처럼 줄 전체(이 `Pressable`)
            다 — 화살표만 눌리게 만들면 손가락이 닿아야 할 자리가 20픽셀로 줄어 지금보다
            쓰기 어려워진다. 화살표가 하는 일은 「이 줄은 눌러서 여닫는 줄이다」를 말하는
            것뿐이고, 펼친 뒤 **어디를 눌러야 닫히는지 모르겠다**는 물음에 답하는 것이 그것이다.
            🔴 낭독기에서는 숨긴다(`aria-hidden`). 여닫힘은 위의 `expanded` 상태와 접근성
            이름의 「펼치기/접기」가 이미 말한다 — 같은 말을 세 번 하면 줄 하나를 읽는 데
            세 번 걸린다.
          */}
          <Chevron up={open} />
        </Pressable>
        {open ? <View style={[styles.briefDetail, styles.stateCell]}>
          <Text selectable style={s.meta}>{formatPhone(item.contact.phone)}</Text>
          {listen}
          {/* 요약 한 줄이 먼저다 — 「무슨 통화였나」를 읽고 나서 열지 말지 고른다. */}
          {summary}
          {state}
        </View> : null}
      </View>;
    }
    // 폰에서는 열이 아니라 줄로 쌓는다. 가로 스크롤은 한 손으로 쓰기 어렵다.
    if (mobile) return <View key={item.call_id} style={styles.mobileRow}>
      <Text style={s.meta}>{new Date(item.call.recorded_at).toLocaleString('ko-KR')}</Text>
      <Text style={s.body}>{item.contact.name}</Text>
      <Text selectable style={s.body}>{formatPhone(item.contact.phone)}</Text>
      <View style={styles.mobileActions}>{listen}</View>
      <View style={styles.stateCell}>{state}</View>
      {summary}
    </View>;
    return <View key={item.call_id} style={styles.row}>
      <Text style={[s.meta, styles.cell, styles.when]}>{new Date(item.call.recorded_at).toLocaleString('ko-KR')}</Text>
      <Text style={[s.body, styles.cell, styles.name]}>{item.contact.name}</Text>
      <Text selectable style={[s.body, styles.cell, styles.phone]}>{formatPhone(item.contact.phone)}</Text>
      <View style={[styles.cell, styles.play]}>{listen}</View>
      <View style={[styles.cell, styles.state, styles.stateCell]}>{state}</View>
      <View style={[styles.cell, styles.summary, styles.fill]}>{summary}</View>
    </View>; });
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
      {/*
        **바로 아래 목록에 지금 몇 줄이 서 있는가.** 그것 말고는 아무 말도 하지 않는다 —
        「불러온」·「검색 결과」 같은 머리말은 붙은 자리가 목록 바로 위라 이미 아는 사실을
        한 번 더 말하는 꼴이고, 그만큼 숫자가 늦게 읽힌다.

        🔴 **`+` 는 남긴다.** 이 수는 **지금까지 받은 수**이지 전부가 아니다. 검색 중에는
        서버가 스캔 상한에 걸려 「2건」을 돌려주고도 커서를 함께 줄 수 있는데, 그때 `+` 가
        없으면 화면이 「이 검색어에 해당하는 통화는 2건뿐」이라고 단정해 버린다.
      */}
      <Text style={s.meta}>{loaded.length}건{search && cursor ? '+' : ''}</Text>
      <View style={styles.toggle}><ViewToggle allInfo={allInfo} onChange={setAllInfo} dense={mobile} /></View>
    </View>
    {error ? <Notice error message={error} /> : null}{loading ? <Loading /> : null}
    {/*
      표는 **넓은 화면의 전체정보뷰에서만** 선다.

      간단뷰는 한 줄짜리 목록이라 열이 필요 없고(열 하나가 세 값을 담는다), 폰의 전체정보뷰는
      가로 스크롤 대신 줄로 쌓는다 — 한 손으로 가로로 미는 조작은 쓰기 어렵다.

      `contentContainerStyle` 의 `flexGrow` 가 없으면 표가 **내용 폭에서 끝나** 넓은 화면에서
      머리글 배경만 중간에 잘린 것처럼 보인다. 남는 자리는 마지막 열(`fill`)이 가져간다.

      🔴 **간단뷰만 따로 묶어 싼다(`briefList`).** 페이지 바탕(`s.page`)이 자식 사이에 16 을
      벌려 두는데, 한 줄짜리 목록에서는 그 16 이 **줄 위에만 얹혀** 글자가 구분선에서 아래로
      밀려 보인다(위 28 · 아래 12). 묶어 싸면 벌어지는 자리가 바깥으로 한 번만 생긴다.
    */}
    {allInfo && !mobile ? <ScrollView horizontal contentContainerStyle={styles.tableContent}><View style={[styles.table, styles.tableWide]}>
      <View style={[styles.row, styles.heading]}>
        <Text style={[s.meta, styles.cell, styles.when]}>통화일시</Text>
        <Text style={[s.meta, styles.cell, styles.name]}>이름</Text>
        <Text style={[s.meta, styles.cell, styles.phone]}>전화번호</Text>
        <Text style={[s.meta, styles.cell, styles.play]}>통화시간</Text>
        <Text style={[s.meta, styles.cell, styles.state]}>상태</Text>
        <Text style={[s.meta, styles.cell, styles.summary, styles.fill]}>요약 한 줄</Text>
      </View>
      {body}
    </View></ScrollView> : allInfo ? body : <View style={styles.briefList}>{body}</View>}
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
    {playing ? <CallPlayback key={playing.call_id} item={playing} onClose={() => setPlaying(null)} /> : null}
  </SmsPage>;
}
/**
 * 접힘/펼침을 가리키는 홑화살표.
 *
 * 🔴 **이모지(⌄·˅)를 쓰지 않는다.** 기기마다 글리프가 달라 어떤 폰에서는 점 하나로, 어떤
 * 폰에서는 컬러 그림으로 나온다 — 방향을 읽히게 하려고 넣은 표시가 방향을 못 말하게 된다.
 * 앱의 다른 아이콘과 같은 방식(react-native-svg)으로 그린다(§`components/app-navigation.tsx`).
 *
 * ⚠️ 전체정보뷰에는 이 표시가 붙지 않는다 — 그 화면은 모든 줄이 펴진 표라 여닫을 것이 없다.
 * 이 컴포넌트를 부르는 자리가 간단뷰 한 곳뿐인 것이 그 보장이다.
 */
function Chevron({ up }: { up: boolean }) {
  return <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.mid} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden={true}>
    <Path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
  </Svg>;
}

const styles = StyleSheet.create({
  mobileRow: { borderBottomWidth: 1, borderColor: colors.borderCard, paddingVertical: spacing.lg, gap: spacing.sm },
  mobileActions: { flexDirection: 'row', gap: spacing.sm },
  /* 간단뷰 — 접히는 한 줄. */
  /**
   * 🔴 **줄을 한 묶음으로 싼다.** 페이지 바탕(`sms-ui` 의 `s.page`)이 자식 사이를 16 벌리는데,
   * 줄이 그 바탕의 직계 자식이면 그 16 이 **구분선과 글자 사이에만** 들어가 위아래 여백이
   * 28 대 12 로 어긋난다 — 「줄이 선에서 아래로 밀려 보인다」의 정체가 그것이다.
   * 여기서 `gap` 을 주지 않는 것이 이 묶음의 존재 이유이므로, 나중에라도 넣지 마라.
   */
  briefList: {},
  briefRow: { borderBottomWidth: 1, borderColor: colors.borderCard },
  /** 첫 줄 위의 선. 나머지 줄의 위쪽은 앞 줄의 아래 선이 긋는다(→ 위 `body` 의 주석). */
  briefFirst: { borderTopWidth: 1, borderColor: colors.borderCard },
  // `minHeight` 은 손가락이 닿을 자리다. 48 미만이면 옆 줄을 같이 눌러 엉뚱한 통화가 펼쳐진다.
  briefHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 48 },
  /** 이름만 남는 자리를 쓰고, 좁으면 이름만 줄어든다(일시·상태는 줄면 읽을 수 없다). */
  briefName: { flex: 1 },
  briefState: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  failedText: { color: colors.red },
  briefDetail: { paddingBottom: spacing.lg },
  table: { flexGrow: 1 },
  tableContent: { flexGrow: 1 },
  /** 여섯 열이 줄바꿈 없이 서는 최소 폭. 이보다 좁은 창에서는 표가 가로로 스크롤한다. */
  tableWide: { minWidth: 1210 },
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
