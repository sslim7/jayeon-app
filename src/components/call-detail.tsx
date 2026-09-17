import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Loading, Notice, s } from '@/components/sms-ui';
import { callApi } from '@/lib/call-api';
import { callDevice } from '@/lib/call-device';
import { CallStages } from '@/components/call-stages';
import { diagnosticsLabel, missingAnalysisNotice, skippedNotice, totalDurationLabel, unavailableSectionNotice } from '@/lib/call-progress';
import { formatPhone } from '@/lib/phone';
import type { CallRecord } from '@/types/calls';

const tabs = ['통화 요약', '상세 내용', '할 일', '상담 분석', '통화 원문'] as const;
const sections = { customer_needs: '고객 요구사항', questions: '질문', concerns: '우려사항', objections: '반대 / 거절 요소', important_points: '중요 발언', followups: '후속 조치' } as const;
const time = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export function CallDetail({ item, onClose }: { item: CallRecord; onClose: () => void }) {
  const [tab, setTab] = useState<typeof tabs[number]>((item.transcript || item.status === 'ANALYSIS_FAILED') && !item.analysis && item.status !== 'COMPLETED' ? '통화 원문' : '통화 요약');
  const [record, setRecord] = useState(item);
  const [loading, setLoading] = useState(!item.analysis);
  const [error, setError] = useState('');
  // 끝난 기록은 시각이 멈춰 있어 한 번만 읽으면 된다. 렌더 중에 시계를 읽지 않는다.
  const [now] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const local = await callDevice.get(item.call_id);
        const result = (local?.analysis || local?.transcript) ? local : await callApi.get(item.call_id);
        if (live) setRecord(result);
      } catch { if (live) setError('통화 내용을 불러오지 못했습니다. 닫은 후 다시 시도해 주세요.'); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [item.call_id]);
  const analysis = record.analysis;
  // 이 버전의 기기 분석은 상세 내용과 상담 분석을 만들지 않는다(→ `lib/call-analysis.ts`).
  // 예전 버전이 만들어 둔 기록에는 남아 있으므로, **있으면 보여 주고 없으면 이유를 말한다.**
  const consulting = analysis ? Object.values(analysis.consulting).some((list) => list.length) : false;
  // 분석 시간은 기기에만 남는다. 서버에서 받은 기록에는 없으므로 목록이 넘겨준 값도 함께 본다.
  const timing = record.timing ?? item.timing;
  const total = totalDurationLabel(timing);
  // 서버 사본에는 기기에서 잰 값이 없다. 목록이 넘겨준 기록으로 채운다.
  const state = { status: record.status, error: record.error ?? item.error, timing };
  return <BottomSheet title={`${record.contact.name} 통화분석`} visible onClose={onClose}>
    <Text style={s.meta}>{formatPhone(record.contact.phone)} · {new Date(record.call.recorded_at).toLocaleString('ko-KR')}{record.call.duration !== null ? ` · ${time(record.call.duration)}` : ''}</Text>
    {total ? <Text style={s.meta}>분석 {total}</Text> : null}
    {timing?.stages ? <CallStages item={{ ...record, timing }} now={now} /> : null}
    {skippedNotice(timing) ? <Notice message={skippedNotice(timing)} /> : null}
    {/* 실패를 다음에 짚을 수 있는 숫자들. 통화 내용은 들어가지 않는다. */}
    {diagnosticsLabel(timing) ? <Text style={s.meta}>{diagnosticsLabel(timing)}</Text> : null}
    {record.error ? <Notice error message={record.error} /> : null}
    <View style={s.row}>{tabs.map((label) => <Pressable key={label} accessibilityRole="tab" aria-selected={label === tab} accessibilityState={{ selected: label === tab }} onPress={() => setTab(label)} style={[s.choice, label === tab && s.secondary]}><Text style={label === tab ? s.link : s.body}>{label}</Text></Pressable>)}</View>
    {loading ? <Loading /> : null}{error ? <Notice error message={error} /> : null}
    {/* 결정사항은 요약 다음으로 중요한 결과다. 상담 분석 탭이 비는 버전에서는 여기 둔다. */}
    {analysis && tab === '통화 요약' ? <><Text selectable style={s.body}>{analysis.summary}</Text><Items title="결정사항" items={analysis.decisions} />{analysis.consulting.important_points.length ? <Items title="중요 포인트" items={analysis.consulting.important_points} /> : null}</> : null}
    {analysis && tab === '상세 내용' ? analysis.details.length ? analysis.details.map((detail, i) => <View key={i} style={s.card}><Text style={s.subtitle}>{detail.title}</Text><Text selectable style={s.body}>{detail.content}</Text></View>) : <Notice message={unavailableSectionNotice('상세 내용')} /> : null}
    {analysis && tab === '할 일' ? analysis.todos.length ? analysis.todos.map((todo, i) => <View key={i} style={s.card}><Text selectable style={s.body}>☐ {todo.content}</Text><Text style={s.meta}>담당: {todo.owner || '확인되지 않음'} · 기한: {todo.due_date || '확인되지 않음'}</Text><Text selectable style={s.meta}>근거: {todo.source}</Text></View>) : <Notice message="통화에서 확인된 할 일이 없습니다." /> : null}
    {analysis && tab === '상담 분석' ? consulting ? <>{Object.entries(sections).map(([key, label]) => <Items key={key} title={label} items={analysis.consulting[key as keyof typeof sections]} />)}</> : <Notice message={unavailableSectionNotice('상담 분석')} /> : null}
    {/* 분석이 없는 통화에서 다른 탭을 누르면 빈 화면이 된다. 왜 비었는지를 말해 준다. */}
    {!analysis && !loading && tab !== '통화 원문' ? <Notice message={missingAnalysisNotice(state, now)} /> : null}
    {tab === '통화 원문' ? record.transcript ? record.transcript.segments.length ? record.transcript.segments.map((segment, i) => <View key={i} style={s.card}><Text style={s.meta}>{time(segment.start)}{segment.speaker ? ` · ${segment.speaker}` : ''}</Text><Text selectable style={s.body}>{segment.text}</Text></View>) : <Text selectable style={s.body}>{record.transcript.text}</Text> : <Notice message="저장된 통화 원문이 없습니다." /> : null}
  </BottomSheet>;
}
function Items({ title, items }: { title: string; items: string[] }) {
  return <View style={s.card}><Text style={s.subtitle}>{title}</Text>{items.length ? items.map((item, i) => <Text selectable key={i} style={s.body}>• {item}</Text>) : <Text style={s.meta}>통화에서 확인된 내용이 없습니다.</Text>}</View>;
}
