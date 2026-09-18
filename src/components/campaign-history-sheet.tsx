import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CampaignDetails } from '@/components/campaign-details';
import { BottomSheet } from '@/components/bottom-sheet';
import { TextField } from '@/components/form-fields';
import { AttachmentPreview } from '@/components/message-attachments';
import { Loading, Notice, SmsButton, s, smsError, statusLabel } from '@/components/sms-ui';
import { colors, spacing } from '@/constants/theme';
import { formatPhone } from '@/lib/phone';
import { smsApi } from '@/lib/sms-api';
import type { Campaign, RecipientHistory } from '@/types/sms';

/** 한 줄이 서로 다른 발송을 가리키도록 시도 번호까지 붙인다(같은 사람에게 두 번 보냈을 수 있다). */
const rowKey = (item: RecipientHistory) => `${item.id}:${item.attemptId ?? ''}`;
/** 목록 한 줄에는 짧은 형식을 쓴다. 초까지 적으면 템플릿 이름이 설 자리가 없다. */
const sentAtLabel = (item: RecipientHistory) =>
  new Date(item.sentAt || item.failedAt || item.updatedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

export function CampaignHistorySheet({ onClose }: { onClose: () => void }) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pending, setPending] = useState<Campaign[] | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<RecipientHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** 펼쳐 둔 줄. 한 번에 하나만 편다 — 여러 줄이 펼쳐지면 목록을 먼저 보여 준 이유가 사라진다. */
  const [openRow, setOpenRow] = useState<string | null>(null);
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
    {/* 검색칸은 placeholder 가 같은 말을 하므로 라벨 글자를 걷는다(낭독기에는 그대로 읽힌다). */}
    <TextField hideLabel label="이름 또는 폰번호 뒷4자리" placeholder="이름 또는 폰번호 뒷4자리" maxLength={100} value={query} onChangeText={(value) => { setQuery(value); setLoading(true); }} />
    <Notice message="최근 발송 순으로 표시합니다. 성공은 발송 요청의 성공이며 수신·읽음 확인은 아닙니다." />
    {loading ? <Loading /> : error ? <Notice error message={error} /> : <>
      <Text style={s.meta}>전체 {rows.length}건</Text>
      {/*
        **목록이 먼저다.** 이력을 카드로 전부 펴 두면 한 화면에 두세 건밖에 서지 못해 「언제
        누구에게 무엇을 보냈나」를 훑을 수가 없다. 한 줄에 발송일시·수신자·템플릿·상태만 세우고,
        본문·첨부·오류처럼 한 건을 들여다볼 때만 필요한 것은 누른 자리에서 펼친다.
      */}
      {!rows.length ? <Notice message="조건에 맞는 발송 이력이 없습니다." /> : rows.map((item) => {
        const key = rowKey(item);
        const open = openRow === key;
        return <View key={key} style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            // aria-* 로도 적는다. react-native-web 은 RN 의 `expanded` 상태를 옮기지 않는다(§sms-ui `Choice`).
            aria-expanded={open}
            accessibilityLabel={`${item.name} ${item.campaignTitle} 발송 이력 ${open ? '접기' : '펼치기'}`}
            onPress={() => setOpenRow(open ? null : key)}
            style={styles.head}
          >
            {/* 폰 폭에서 네 열은 한 줄에 들어가지 않는다. 가로 스크롤 대신 두 줄로 접는다. */}
            <View style={styles.line}><Text style={s.body} numberOfLines={1}>{item.name}</Text><Text style={s.meta}>{statusLabel[item.status]}</Text></View>
            <View style={styles.line}><Text style={s.meta}>{sentAtLabel(item)}</Text><Text style={[s.meta, styles.title]} numberOfLines={1}>{item.campaignTitle}</Text></View>
          </Pressable>
          {open ? <View style={styles.detail}>
            <Text selectable style={s.meta}>{formatPhone(item.phone)}{item.transport ? ` · ${item.transport}` : ''}</Text>
            <Text selectable style={s.body}>{item.source === 'EXTERNAL' ? '외부에서 발송한 기록입니다.' : item.message || '이미지 메시지'}</Text>
            {item.attachments?.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} />)}
            {item.errorMessage ? <Notice error message={item.errorMessage} /> : null}
            {item.campaignId ? <SmsButton label={`${item.campaignTitle} 발송 상세`} secondary onPress={() => setDetailId(item.campaignId!)} /> : null}
          </View> : null}
        </View>;
      })}
    </>}
  </BottomSheet>;
}

const styles = StyleSheet.create({
  row: { borderBottomWidth: 1, borderBottomColor: colors.borderCard },
  head: { paddingVertical: spacing.md, gap: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  /** 템플릿 이름만 줄어든다 — 일시는 줄면 무슨 날인지 알 수 없다. */
  title: { flexShrink: 1, textAlign: 'right' },
  detail: { paddingBottom: spacing.md, gap: spacing.sm },
});
