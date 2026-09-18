import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Loading, Notice, SmsButton, s } from '@/components/sms-ui';
import { callApi } from '@/lib/call-api';
import { CallStages } from '@/components/call-stages';
import { costLine } from '@/lib/call-cost';
import { callFailureText, callRetryable } from '@/lib/call-errors';
import { isActive, isFailed, missingAnalysisNotice } from '@/lib/call-progress';
import { formatPhone } from '@/lib/phone';
import type { CallAnalysis, CallRecord } from '@/types/calls';

const sections = { customer_needs: '고객 요구사항', questions: '질문', concerns: '우려사항', objections: '반대 / 거절 요소', important_points: '중요 발언', followups: '후속 조치' } as const;
/**
 * 펼 탭을 정한다. 「통화 요약」과 「통화 원문」은 늘 있고, 나머지는 **내용이 있을 때만** 편다.
 *
 * 비어 있을 탭을 띄워 두고 「이 버전에서는 제공하지 않습니다」를 적느니 탭 자체를 걷는다 —
 * 누를 것이 없는 탭은 사용자를 두 번 헛걸음시킨다. 대신 **내용이 있으면 탭이 저절로 돌아온다**:
 * 요약만 만들던 옛 기기 기록에도, 상세 항목까지 채우는 서버 분석에도 같은 함수가 쓰인다.
 */
function tabsFor(analysis: CallAnalysis | undefined): string[] {
  const extra: string[] = [];
  if (analysis?.details.length) extra.push('상세 내용');
  if (analysis?.todos.length) extra.push('할 일');
  if (analysis && Object.values(analysis.consulting).some((list) => list.length)) extra.push('상담 분석');
  return ['통화 요약', ...extra, '통화 원문'];
}
const time = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

/**
 * 통화 한 건의 내용.
 *
 * 🔴 **목록이 준 값으로는 부족하다.** 목록 응답에는 원문·분석이 실리지 않는다(30건마다 수 MB 를
 * 내려보내지 않기 위해서다, §`internal/calls/model.go` 의 `listRecord`). 그래서 열릴 때 상세를
 * 한 번 물어본다 — 서버 단계(`stage`)와 재생 주소도 그 응답에만 온다.
 */
export function CallDetail({ item, onClose, onUpdated }: { item: CallRecord; onClose: () => void; onUpdated: (record: CallRecord) => void }) {
  /** 상세 응답. 원문·분석·재생 주소·비용은 **여기에만** 있다. 아직 못 받았으면 `null` 이다. */
  const [fetched, setFetched] = useState<CallRecord | null>(null);
  const [tab, setTab] = useState<string>(item.status === 'ANALYSIS_FAILED' ? '통화 원문' : '통화 요약');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /**
   * 「서버 AI로 다시 분석」의 단계. `idle` → `confirm` → `running`.
   *
   * 🔴 **한 번 누르면 바로 도는 버튼이 아니다.** 이 버튼은 되돌릴 수 없이 기존 분석을
   * 덮어쓰고 분석 요금을 한 번 더 쓴다. 그래서 확인을 한 단계 받는다.
   * 🔴 `confirm()` 같은 브라우저 대화상자는 쓰지 않는다 — 이 앱은 WebView 안에서 돌고,
   * 그 안에서 모달이 뜨면 화면이 그대로 멈춘다. 확인은 **화면 안의 줄**로 받는다.
   */
  const [again, setAgain] = useState<'idle' | 'confirm' | 'running'>('idle');
  const [againError, setAgainError] = useState('');
  // 끝난 기록은 시각이 멈춰 있어 한 번만 읽으면 된다. 렌더 중에 시계를 읽지 않는다.
  const [now] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    void callApi.get(item.call_id)
      .then((found) => { if (live && found) setFetched(found); })
      .catch(() => { if (live) setError('통화 내용을 불러오지 못했습니다. 닫은 후 다시 시도해 주세요.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [item.call_id]);
  /**
   * 화면에 그릴 한 건. **상세 응답 위에 목록이 들고 있는 값을 얹는다.**
   *
   * 🔴 시트는 스스로 폴링하지 않는다. 진행 중인 통화를 묻는 일은 목록이 이미 5초마다 하고
   * 있어서(§`app/calls.tsx` 의 `POLL_MS`), 시트가 같은 통화를 따로 또 물으면 요청이 두 배가
   * 된다. 목록이 받은 답은 `item` 으로 내려오므로 그것을 **나중 값**으로 얹으면 된다.
   *
   * ⚠️ 순서가 중요하다. 목록 값이 위에 와야 진행 상태가 최신이 되고, 아래에 상세 응답이
   * 깔려 있어야 원문·분석이 남는다 — 목록 응답에는 그 둘이 실리지 않기 때문이다
   * (§`internal/calls/model.go` 의 `listRecord`). 뒤집으면 열어 둔 원문 탭이 빈 화면이 되거나,
   * 처음 열었을 때의 단계가 영영 굳는다.
   */
  const record = useMemo(() => fetched ? { ...fetched, ...item } : item, [fetched, item]);
  const analysis = record.analysis;
  const tabs = useMemo(() => tabsFor(analysis), [analysis]);
  const failure = isFailed(record.status) ? callFailureText(record) : '';
  /**
   * **다시 분석할 수 있는 통화인가.**
   *
   * 조건은 「서버에 다시 분석할 원문이 있다」 하나뿐이다 — 상태는 보지 않는다. 폰에서
   * 받아쓰기·요약까지 끝내고 결과만 올린 옛 통화는 `COMPLETED` 로 남아 있지만, 그 요약을
   * 만든 것은 폰의 작은 모델이라 서버 모델로 다시 돌릴 값어치가 있다.
   *
   * 🔴 원문이 없으면 세우지 않는다. 서버가 409(`CALL_NO_TRANSCRIPT`)로 거절할 버튼이다.
   * 🔴 이미 도는 통화에도 세우지 않는다. 서버가 409(`CALL_NOT_ANALYZABLE`)로 거절하고,
   * 무엇보다 **지금 돌고 있는 분석을 사용자가 처음부터 다시 돌리게 된다.**
   * ⚠️ 상세를 아직 못 받은 동안(`loading`)에도 세우지 않는다. 그때는 원문이 있는지 모른다 —
   * 목록 응답에는 원문이 실리지 않기 때문이다.
   */
  const rerunnable = !loading && !isActive(record.status) && !!record.transcript?.text.trim();
  /**
   * 서버에 다시 분석을 맡긴다.
   *
   * 🔴 받은 답을 **목록으로 올려 보낸다**(`onUpdated`). 이 시트가 따로 들고 있지 않는
   * 이유가 둘이다: ①5초 폴링은 목록이 들고 있는 통화의 상태를 보고 돌지 말지를 정하므로
   * (§`app/calls.tsx` 의 `pending`), 목록에 닿지 않으면 아무도 진행을 따라가지 않는다.
   * ②여기서도 따로 들고 있으면 나중에 폴링이 가져온 최신 상태를 이 값이 덮어 가린다 —
   * 분석이 끝났는데 화면은 「내용 정리하는 중」에 멈춘다. 값은 한 곳에서만 들고 있는다.
   */
  async function rerun() {
    if (again === 'running') return;
    setAgain('running');
    setAgainError('');
    try {
      onUpdated(await callApi.reanalyze(record.call_id));
      setAgain('idle');
    } catch {
      setAgainError('다시 분석을 시작하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
      setAgain('idle');
    }
  }
  return <BottomSheet title={`${record.contact.name} 통화분석`} visible onClose={onClose}>
    <Text style={s.meta}>{formatPhone(record.contact.phone)} · {new Date(record.call.recorded_at).toLocaleString('ko-KR')}{record.call.duration !== null ? ` · ${time(record.call.duration)}` : ''}</Text>
    {/* 아직 도는 통화와 멈춘 통화만 단계를 편다. 끝난 통화에 네 칸을 세울 이유가 없다. */}
    {isActive(record.status) || isFailed(record.status) ? <CallStages item={record} now={now} /> : null}
    {failure ? <Notice error message={failure} /> : null}
    {/* 어떤 AI 가 만들었는지는 결과를 의심할 때 첫 단서다. 서버가 알려 줄 때만 적는다. */}
    {record.ai?.provider || record.ai?.model ? <Text style={s.meta}>분석: {[record.ai.provider, record.ai.model].filter(Boolean).join(' · ')}</Text> : null}
    {/*
      이 한 건에 실제로 든 돈. 어떤 AI 를 썼는지 바로 아래에 두는 이유는 **둘을 같이 봐야
      판단이 되기 때문**이다 — 「alibaba 로 이만큼」이 곧 공급자를 바꿀지 말지의 근거다.

      🔴 서버가 금액을 안 보내면 **칸을 통째로 걷는다.** 0원으로 그리면 공짜로 읽히는데,
      실제로는 「모른다」는 뜻이다(단가 미설정이거나 사용량이 없는 옛 통화다).
    */}
    {record.cost ? <Text style={s.meta}>{costLine(record.cost)}</Text> : null}
    {/*
      **「분석 다시 시도」와 다른 일이다.**

      그쪽은 실패한 통화를 원래 있어야 할 자리로 되돌리는 복구다(→ `app/calls.tsx`).
      이쪽은 **이미 결과가 있는 통화를 더 나은 모델로 다시 돌리는** 일이라, 멀쩡한 분석을
      지우고 요금을 새로 쓴다. 말이 같으면 사용자는 둘을 같은 버튼으로 읽는다.

      자리를 모델·비용 줄 바로 아래에 둔 이유도 같다 — 「어떤 모델이 얼마로 만든 결과인가」를
      읽은 자리에서 다시 돌릴지 판단하게 된다.
    */}
    {rerunnable ? <View style={s.row}>
      {again === 'idle' ? <SmsButton secondary label="서버 AI로 다시 분석" accessibilityLabel={`${record.contact.name} 통화를 서버 AI로 다시 분석`} onPress={() => setAgain('confirm')} /> : null}
      {again === 'confirm' ? <>
        <Text style={s.meta}>지금 있는 분석을 덮어씁니다. 되돌릴 수 없고 분석 비용이 한 번 더 듭니다.</Text>
        <SmsButton label="덮어쓰고 다시 분석" onPress={() => void rerun()} />
        <SmsButton secondary label="취소" onPress={() => setAgain('idle')} />
      </> : null}
      {/*
        🔴 보낸 뒤에는 **버튼 자체를 치운다.** 비활성 버튼으로 두면 연타한 두 번째 누름이
        첫 응답보다 먼저 닿을 수 있고, 그러면 서버가 방금 시작한 분석을 처음부터 다시 돌린다
        (= 요금이 두 배다). 응답이 오면 상태가 `ANALYZING` 이 되어 위 `rerunnable` 이
        이 줄을 통째로 걷고, 그 자리는 단계 카드가 이어받는다.
      */}
      {again === 'running' ? <><Loading /><Text accessibilityLiveRegion="polite" style={s.meta}>다시 분석을 맡기는 중입니다.</Text></> : null}
    </View> : null}
    {againError ? <Notice error message={againError} /> : null}
    <View style={s.row}>{tabs.map((label) => <Pressable key={label} accessibilityRole="tab" aria-selected={label === tab} accessibilityState={{ selected: label === tab }} onPress={() => setTab(label)} style={[s.choice, label === tab && s.secondary]}><Text style={label === tab ? s.link : s.body}>{label}</Text></Pressable>)}</View>
    {loading ? <Loading /> : null}{error ? <Notice error message={error} /> : null}
    {/* 옛 기록의 결정사항·중요 포인트는 탭을 따로 두지 않고 요약 아래에 붙인다. */}
    {analysis && tab === '통화 요약' ? <><Text selectable style={s.body}>{analysis.summary}</Text>{analysis.decisions.length ? <Items title="결정사항" items={analysis.decisions} /> : null}</> : null}
    {analysis && tab === '상세 내용' ? analysis.details.map((detail, i) => <View key={i} style={s.card}><Text style={s.subtitle}>{detail.title}</Text><Text selectable style={s.body}>{detail.content}</Text></View>) : null}
    {analysis && tab === '할 일' ? analysis.todos.map((todo, i) => <View key={i} style={s.card}><Text selectable style={s.body}>☐ {todo.content}</Text><Text style={s.meta}>담당: {todo.owner || '확인되지 않음'} · 기한: {todo.due_date || '확인되지 않음'}</Text><Text selectable style={s.meta}>근거: {todo.source}</Text></View>) : null}
    {analysis && tab === '상담 분석' ? Object.entries(sections).map(([key, label]) => <Items key={key} title={label} items={analysis.consulting[key as keyof typeof sections]} />) : null}
    {/* 요약이 없는 통화의 요약 탭이 빈 화면이 되지 않게 왜 비었는지를 말해 준다. */}
    {!analysis && !loading && tab !== '통화 원문' ? <Notice message={missingAnalysisNotice(record, now, failure, callRetryable(record))} /> : null}
    {tab === '통화 원문' ? record.transcript ? record.transcript.segments.length ? record.transcript.segments.map((segment, i) => <View key={i} style={s.card}><Text style={s.meta}>{time(segment.start)}{segment.speaker ? ` · ${segment.speaker}` : ''}</Text><Text selectable style={s.body}>{segment.text}</Text></View>) : <Text selectable style={s.body}>{record.transcript.text}</Text> : <Notice message="저장된 통화 원문이 없습니다." /> : null}
  </BottomSheet>;
}
function Items({ title, items }: { title: string; items: string[] }) {
  return <View style={s.card}><Text style={s.subtitle}>{title}</Text>{items.length ? items.map((item, i) => <Text selectable key={i} style={s.body}>• {item}</Text>) : <Text style={s.meta}>통화에서 확인된 내용이 없습니다.</Text>}</View>;
}
