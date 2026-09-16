import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { CampaignDetails } from '@/components/campaign-details';
import { BottomSheet } from '@/components/bottom-sheet';
import { TextField } from '@/components/form-fields';
import { AttachmentPreview } from '@/components/message-attachments';
import { Loading, Notice, SmsButton, s, smsError, statusLabel } from '@/components/sms-ui';
import { formatPhone } from '@/lib/phone';
import { smsApi } from '@/lib/sms-api';
import type { Campaign, RecipientHistory } from '@/types/sms';

export function CampaignHistorySheet({ onClose }: { onClose: () => void }) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pending, setPending] = useState<Campaign[] | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<RecipientHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (detailId) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      smsApi.history(query.trim()).then((items) => { if (active) setRows(items); }).catch((e) => { if (active) setError(smsError(e)); }).finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, detailId]);
  async function loadPending() {
    setPendingLoading(true); setPendingError('');
    try { setPending((await smsApi.list()).filter((item) => item.status !== 'COMPLETED').sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }
    catch (e) { setPendingError(smsError(e)); }
    finally { setPendingLoading(false); }
  }
  if (detailId) return <BottomSheet title="발송 상세" visible onClose={() => setDetailId(null)}><SmsButton label="발송 이력으로 돌아가기" secondary onPress={() => setDetailId(null)} /><CampaignDetails id={detailId} /></BottomSheet>;
  return <BottomSheet title="발송 이력" visible onClose={onClose}>
    <SmsButton label="미완료 발송 확인" secondary disabled={pendingLoading} onPress={() => void loadPending()} />
    {pendingLoading ? <Loading /> : null}
    {pendingError ? <Notice error message={pendingError} /> : null}
    {pending ? <View style={s.card}><Text style={s.subtitle}>미완료 발송</Text>{pending.length ? pending.map((item) => <SmsButton key={item.id} label={`${item.title} 발송 상세`} secondary onPress={() => setDetailId(item.id)} />) : <Notice message="미완료 발송이 없습니다." />}</View> : null}
    <TextField label="발송 이력 이름" maxLength={100} value={query} onChangeText={(value) => { setQuery(value); setLoading(true); }} />
    <Notice message="최근 발송 순으로 표시합니다. 성공은 발송 요청의 성공이며 수신·읽음 확인은 아닙니다." />
    {loading ? <Loading /> : error ? <Notice error message={error} /> : <>
      <Text style={s.meta}>전체 {rows.length}건</Text>
      {!rows.length ? <Notice message="조건에 맞는 발송 이력이 없습니다." /> : rows.map((item) => <View key={`${item.id}:${item.attemptId ?? ''}`} style={s.card}>
        <Text style={s.subtitle}>{item.name} · {formatPhone(item.phone)}</Text>
        <Text style={s.meta}>{item.campaignTitle} · {statusLabel[item.status]} · {new Date(item.sentAt || item.failedAt || item.updatedAt).toLocaleString('ko-KR')}</Text>
        <Text selectable style={s.body}>{item.source === 'EXTERNAL' ? '외부에서 발송한 기록입니다.' : item.message || '이미지 메시지'}</Text>
        {item.attachments?.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} />)}
        {item.campaignId ? <SmsButton label={`${item.campaignTitle} 발송 상세`} secondary onPress={() => setDetailId(item.campaignId!)} /> : null}
        {item.errorMessage ? <Notice error message={item.errorMessage} /> : null}
      </View>)}
    </>}
  </BottomSheet>;
}
