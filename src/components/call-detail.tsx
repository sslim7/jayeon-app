import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Loading, Notice, s } from '@/components/sms-ui';
import { callApi } from '@/lib/call-api';
import { callDevice } from '@/lib/call-device';
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
  return <BottomSheet title={`${record.contact.name} 통화분석`} visible onClose={onClose}>
    <Text style={s.meta}>{formatPhone(record.contact.phone)} · {new Date(record.call.recorded_at).toLocaleString('ko-KR')}{record.call.duration !== null ? ` · ${time(record.call.duration)}` : ''}</Text>
    <View style={s.row}>{tabs.map((label) => <Pressable key={label} accessibilityRole="tab" aria-selected={label === tab} accessibilityState={{ selected: label === tab }} onPress={() => setTab(label)} style={[s.choice, label === tab && s.secondary]}><Text style={label === tab ? s.link : s.body}>{label}</Text></Pressable>)}</View>
    {loading ? <Loading /> : null}{error ? <Notice error message={error} /> : null}
    {analysis && tab === '통화 요약' ? <><Text selectable style={s.body}>{analysis.summary}</Text><Items title="중요 포인트" items={analysis.consulting.important_points} /></> : null}
    {analysis && tab === '상세 내용' ? analysis.details.length ? analysis.details.map((detail, i) => <View key={i} style={s.card}><Text style={s.subtitle}>{detail.title}</Text><Text selectable style={s.body}>{detail.content}</Text></View>) : <Notice message="기록된 상세 내용이 없습니다." /> : null}
    {analysis && tab === '할 일' ? analysis.todos.length ? analysis.todos.map((todo, i) => <View key={i} style={s.card}><Text selectable style={s.body}>☐ {todo.content}</Text><Text style={s.meta}>담당: {todo.owner || '확인되지 않음'} · 기한: {todo.due_date || '확인되지 않음'}</Text><Text selectable style={s.meta}>근거: {todo.source}</Text></View>) : <Notice message="통화에서 확인된 할 일이 없습니다." /> : null}
    {analysis && tab === '상담 분석' ? <>{Object.entries(sections).map(([key, label]) => <Items key={key} title={label} items={analysis.consulting[key as keyof typeof sections]} />)}<Items title="결정사항" items={analysis.decisions} /></> : null}
    {tab === '통화 원문' ? record.transcript ? record.transcript.segments.length ? record.transcript.segments.map((segment, i) => <View key={i} style={s.card}><Text style={s.meta}>{time(segment.start)}{segment.speaker ? ` · ${segment.speaker}` : ''}</Text><Text selectable style={s.body}>{segment.text}</Text></View>) : <Text selectable style={s.body}>{record.transcript.text}</Text> : <Notice message="저장된 통화 원문이 없습니다." /> : null}
  </BottomSheet>;
}
function Items({ title, items }: { title: string; items: string[] }) {
  return <View style={s.card}><Text style={s.subtitle}>{title}</Text>{items.length ? items.map((item, i) => <Text selectable key={i} style={s.body}>• {item}</Text>) : <Text style={s.meta}>통화에서 확인된 내용이 없습니다.</Text>}</View>;
}
