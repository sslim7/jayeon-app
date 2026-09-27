import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { CampaignDetails } from '@/components/campaign-details';
import { TextField } from '@/components/form-fields';
import { AttachmentPreview } from '@/components/message-attachments';
import { COMPACT_MAX_WIDTH } from '@/components/recipient-table-columns';
import { Loading, Notice, SmsButton, SmsPage, s, smsError, statusLabel } from '@/components/sms-ui';
import { colors, spacing } from '@/constants/theme';
import { formatPhone } from '@/lib/phone';
import { groupSmsHistory } from '@/lib/sms-history-groups';
import { smsApi } from '@/lib/sms-api';
import type { Campaign, RecipientHistory } from '@/types/sms';

/** 한 줄이 서로 다른 발송을 가리키도록 시도 번호까지 붙인다(같은 사람에게 두 번 보냈을 수 있다). */
const rowKey = (item: RecipientHistory) => `${item.id}:${item.attemptId ?? ''}`;
/** 목록 한 줄에는 짧은 형식을 쓴다. 초까지 적으면 수신자 이름이 설 자리가 없다. */
const sentAtLabel = (item: RecipientHistory) =>
  new Date(item.sentAt || item.failedAt || item.updatedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
/**
 * 묶음 머리의 일자.
 *
 * 🔴 **`new Date('2026-09-27')` 를 거치지 않는다.** 날짜만 있는 ISO 문자열은 UTC 자정으로
 * 해석되어, 한국보다 서쪽 시간대에서 하루 앞 날짜로 표시된다. 묶음 키는 이미 로컬 날짜로
 * 만들어 둔 글자이므로(→ `lib/sms-history-groups.ts`) 쪼개서 쓰기만 한다.
 */
const dateLabel = (date: string) => {
  const [year, month, day] = date.split('-');
  return day ? `${year}. ${Number(month)}. ${Number(day)}.` : date;
};

export default function CampaignHistoryScreen() {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pending, setPending] = useState<Campaign[] | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<RecipientHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /**
   * 펼쳐 둔 묶음과, 그 안에서 펼쳐 둔 수신자 줄. 🔴 **양쪽 모두 한 번에 하나만 편다.**
   * 여러 개가 펼쳐지면 50줄을 접어 둔 이유가 사라져 목록이 다시 스크롤 덩어리가 된다.
   */
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  /** 데스크탑에서는 묶음 머리가 한 줄에 다 서고, 폰 폭에서는 두 줄로 접힌다. */
  const compact = useWindowDimensions().width < COMPACT_MAX_WIDTH;
  useEffect(() => {
    // 상세를 보는 동안은 다시 불러오지 않는다. 돌아오면 그때 최신으로 갱신된다.
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
  const groups = groupSmsHistory(rows);
  /*
   * 발송 상세는 **같은 화면 안에서** 연다. 이력이 시트였던 동안에는 상세가 시트를 갈아 끼웠는데,
   * 페이지가 된 뒤에는 그럴 필요가 없다 — 돌아가는 길만 머리에 두면 된다.
   */
  if (detailId) return <SmsPage hideTitle wide title="발송 상세">
    <SmsButton label="발송 이력으로 돌아가기" secondary onPress={() => setDetailId(null)} />
    <CampaignDetails id={detailId} />
  </SmsPage>;
  return <SmsPage hideTitle wide title="발송 이력">
    <SmsButton label="미완료 발송 확인" secondary disabled={pendingLoading} onPress={() => void loadPending()} />
    {pendingLoading ? <Loading /> : null}
    {pendingError ? <Notice error message={pendingError} /> : null}
    {pending ? <View style={s.card}><Text style={s.subtitle}>미완료 발송</Text>{pending.length ? pending.map((item) => <SmsButton key={item.id} label={`${item.title} 발송 상세`} secondary onPress={() => setDetailId(item.id)} />) : <Notice message="미완료 발송이 없습니다." />}</View> : null}
    {/* 검색칸은 placeholder 가 같은 말을 하므로 라벨 글자를 걷는다(낭독기에는 그대로 읽힌다). */}
    <TextField hideLabel label="이름,전화번호 뒷자리 4자" placeholder="이름,전화번호 뒷자리 4자" maxLength={100} value={query} onChangeText={(value) => { setQuery(value); setLoading(true); }} />
    <Notice message="최근 발송 순으로 표시합니다. 성공은 발송 요청의 성공이며 수신·읽음 확인은 아닙니다." />
    {loading ? <Loading /> : error ? <Notice error message={error} /> : <>
      <Text style={s.meta}>전체 {rows.length}건</Text>
      {/*
        **집계가 먼저다.** 50명에게 한 번 보내면 수신자 줄이 50개라, 이력을 그대로 펴 두면
        「언제 무엇을 보냈나」를 훑을 수가 없고 스크롤만 남는다. 그래서 「일자 · 템플릿 ·
        발송건수」로 접어 두고(→ `lib/sms-history-groups.ts`), 누른 묶음만 수신자 줄을 펼친다.
        수신자 줄은 거기서 **한 번 더** 펼쳐져 본문·첨부·오류를 보여 준다 — 2단 펼침이다.
      */}
      {!groups.length ? <Notice message="조건에 맞는 발송 이력이 없습니다." /> : groups.map((group) => {
        const groupOpen = openGroup === group.key;
        return <View key={group.key} style={styles.group}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: groupOpen }}
            // aria-* 로도 적는다. react-native-web 은 RN 의 `expanded` 상태를 옮기지 않는다(§sms-ui `Choice`).
            aria-expanded={groupOpen}
            accessibilityLabel={`${dateLabel(group.date)} ${group.title} ${group.count}건 ${groupOpen ? '접기' : '펼치기'}`}
            onPress={() => { setOpenGroup(groupOpen ? null : group.key); setOpenRow(null); }}
            style={styles.groupHead}
          >
            {/* 폰 폭에서 네 칸은 한 줄에 들어가지 않는다. 가로 스크롤 대신 두 줄로 접는다. */}
            <View style={styles.line}>
              <Text style={s.body}>{dateLabel(group.date)}</Text>
              {compact ? null : <Text style={[s.body, styles.groupTitle]} numberOfLines={1}>{group.title}</Text>}
              <Text style={s.meta}>{group.count}건</Text>
              <Text aria-hidden={true} style={s.meta}>{groupOpen ? '▲' : '▼'}</Text>
            </View>
            {compact ? <View style={styles.line}><Text style={[s.meta, styles.groupTitle]} numberOfLines={1}>{group.title}</Text></View> : null}
          </Pressable>
          {groupOpen ? <View style={styles.rows}>{group.items.map((item) => {
            const key = rowKey(item);
            const open = openRow === key;
            return <View key={key} style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                aria-expanded={open}
                accessibilityLabel={`${item.name} ${item.campaignTitle} 발송 이력 ${open ? '접기' : '펼치기'}`}
                onPress={() => setOpenRow(open ? null : key)}
                style={styles.head}
              >
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
          })}</View> : null}
        </View>;
      })}
    </>}
  </SmsPage>;
}

const styles = StyleSheet.create({
  /** 묶음 사이의 선은 수신자 줄의 선보다 진하다 — 두 단계가 같은 굵기면 어느 쪽이 묶음인지 읽히지 않는다. */
  group: { borderBottomWidth: 1, borderBottomColor: colors.borderPill },
  groupHead: { paddingVertical: spacing.md, gap: spacing.xs },
  /** 펼친 수신자 목록은 한 칸 들여쓴다. 묶음 머리와 같은 선에 서면 어디까지가 그 묶음인지 알 수 없다. */
  rows: { paddingLeft: spacing.md, paddingBottom: spacing.sm },
  row: { borderBottomWidth: 1, borderBottomColor: colors.borderCard },
  head: { paddingVertical: spacing.md, gap: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  /** 템플릿 이름만 줄어든다 — 일시는 줄면 무슨 날인지 알 수 없다. */
  title: { flexShrink: 1, textAlign: 'right' },
  /**
   * 묶음 머리의 템플릿 이름은 **남는 폭을 다 먹는다.** 데스크탑에서는 일자와 건수 사이를 이
   * 칸이 채워야 「일자 · 템플릿 · N건 · ▼」이 한 줄로 정렬되고, 폭이 좁아 이름이 잘릴 때도
   * 건수와 화살표가 제자리를 지킨다.
   */
  groupTitle: { flex: 1 },
  detail: { paddingBottom: spacing.md, gap: spacing.sm },
});
