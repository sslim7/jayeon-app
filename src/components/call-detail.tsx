import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Loading, Notice, s } from '@/components/sms-ui';
import { callApi } from '@/lib/call-api';
import { CallStages } from '@/components/call-stages';
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
export function CallDetail({ item, onClose }: { item: CallRecord; onClose: () => void }) {
  const [record, setRecord] = useState(item);
  const [tab, setTab] = useState<string>(item.status === 'ANALYSIS_FAILED' ? '통화 원문' : '통화 요약');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 끝난 기록은 시각이 멈춰 있어 한 번만 읽으면 된다. 렌더 중에 시계를 읽지 않는다.
  const [now] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    void callApi.get(item.call_id)
      .then((found) => { if (live && found) setRecord(found); })
      .catch(() => { if (live) setError('통화 내용을 불러오지 못했습니다. 닫은 후 다시 시도해 주세요.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [item.call_id]);
  const analysis = record.analysis;
  const tabs = useMemo(() => tabsFor(analysis), [analysis]);
  const failure = isFailed(record.status) ? callFailureText(record) : '';
  return <BottomSheet title={`${record.contact.name} 통화분석`} visible onClose={onClose}>
    <Text style={s.meta}>{formatPhone(record.contact.phone)} · {new Date(record.call.recorded_at).toLocaleString('ko-KR')}{record.call.duration !== null ? ` · ${time(record.call.duration)}` : ''}</Text>
    {/* 아직 도는 통화와 멈춘 통화만 단계를 편다. 끝난 통화에 네 칸을 세울 이유가 없다. */}
    {isActive(record.status) || isFailed(record.status) ? <CallStages item={record} now={now} /> : null}
    {failure ? <Notice error message={failure} /> : null}
    {/* 어떤 AI 가 만들었는지는 결과를 의심할 때 첫 단서다. 서버가 알려 줄 때만 적는다. */}
    {record.ai?.provider || record.ai?.model ? <Text style={s.meta}>분석: {[record.ai.provider, record.ai.model].filter(Boolean).join(' · ')}</Text> : null}
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
