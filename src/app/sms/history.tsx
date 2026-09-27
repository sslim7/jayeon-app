import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { CampaignDetails } from '@/components/campaign-details';
import { TextField } from '@/components/form-fields';
import { AttachmentPreview } from '@/components/message-attachments';
import { COMPACT_MAX_WIDTH } from '@/components/recipient-table-columns';
import { Loading, Notice, SmsButton, SmsPage, s, smsError, statusLabel } from '@/components/sms-ui';
import { colors, spacing } from '@/constants/theme';
import { formatPhone } from '@/lib/phone';
import { groupSmsHistory, historyTime, needsAttention, outcomeSummary, withinPeriod, type HistoryPeriod } from '@/lib/sms-history-groups';
import { smsApi } from '@/lib/sms-api';
import type { Campaign, RecipientHistory } from '@/types/sms';

/** 한 줄이 서로 다른 발송을 가리키도록 시도 번호까지 붙인다(같은 사람에게 두 번 보냈을 수 있다). */
const rowKey = (item: RecipientHistory) => `${item.id}:${item.attemptId ?? ''}`;
/** 목록 한 줄에는 짧은 형식을 쓴다. 초까지 적으면 수신자 이름이 설 자리가 없다. */
const timeLabel = (raw: string) => new Date(raw).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
/**
 * 수신자 줄에 적는 일시.
 *
 * 🔴 **시각 고르기는 `historyTime` 에 맡긴다.** 여기서 `sentAt || failedAt || updatedAt` 을 다시
 * 적으면 묶기·기간 거르기와 우선순위가 갈릴 수 있고, 그러면 줄에 적힌 일시와 그 줄이 들어간
 * 묶음의 일자가 어긋난다(→ `lib/sms-history-groups.ts`).
 */
const sentAtLabel = (item: RecipientHistory) => timeLabel(historyTime(item));
/**
 * 조회 기간. 기본값은 **최근 3개월**이다.
 *
 * ⚠️ **불러오는 양을 줄이는 장치가 아니다.** 서버에 기간 조건이 없어 이력은 전 기간을 받아
 * 온다(→ `lib/sms-api.ts` 의 `history`). 이 선택은 받아 온 뒤 화면에서 거르는 것이고, 요점은
 * 「지금 보고 있는 것이 언제부터 언제까지인가」를 사용자가 알 수 있게 하는 것이다.
 */
const PERIODS: readonly { label: string; months: HistoryPeriod }[] = [
  { label: '최근 1개월', months: 1 },
  { label: '최근 3개월', months: 3 },
  { label: '최근 6개월', months: 6 },
  { label: '전체', months: null },
];
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
  /** 손볼 것이 남은 발송(→ `needsAttention`). 없으면 빈 배열이고, 그때는 아무것도 그리지 않는다. */
  const [pending, setPending] = useState<Campaign[]>([]);
  /** 🔴 기본은 **접힌 상태**. 이력을 보러 온 사람의 목록을 밀어내지 않는 것이 요점이다. */
  const [pendingOpen, setPendingOpen] = useState(false);
  const [months, setMonths] = useState<HistoryPeriod>(3);
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
  /*
   * 손볼 것이 남은 발송은 **누르지 않아도 확인한다.**
   *
   * 「미완료 발송 확인」 버튼이 목록 맨 위에 서 있던 자리다. 그 버튼은 놓을 데가 없어 여기
   * 세워 둔 것이었고, **눌러 보기 전에는 있는지 없는지도 알 수 없었다** — 확인할 것이 있는데
   * 모르고 지나가는 것이 이 화면의 진짜 결함이었다. 지금은 들어올 때 함께 조회해서 **있을 때만**
   * 목록 위에 한 줄로 알린다. 검색어와 무관하므로 `query` 가 아니라 `detailId` 만 본다 —
   * 상세를 보고 돌아오면 그 발송의 상태가 바뀌었을 수 있어 그때는 다시 확인해야 한다.
   */
  useEffect(() => {
    if (detailId) return;
    let alive = true;
    void (async () => {
      // 🔴 실패하면 조용히 없는 셈 친다. 이력을 보러 온 사람의 화면이 곁다리 조회 때문에 깨지면
      // 안 된다(→ `hooks/use-asr-summary.ts` 가 같은 이유로 그렇게 한다). 늦게 온 응답은 버린다.
      const items = await smsApi.list().catch(() => [] as Campaign[]);
      if (alive) setPending(items.filter(needsAttention).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    })();
    return () => { alive = false; };
  }, [detailId]);
  const period = PERIODS.find((item) => item.months === months) ?? PERIODS[1];
  /* 거르기는 순수 모듈이 한다 — 화면에서 날짜를 계산하면 묶기와 기준이 갈린다(→ `withinPeriod`). */
  const visible = withinPeriod(rows, months);
  const groups = groupSmsHistory(visible);
  /*
   * 발송 상세는 **같은 화면 안에서** 연다. 이력이 시트였던 동안에는 상세가 시트를 갈아 끼웠는데,
   * 페이지가 된 뒤에는 그럴 필요가 없다 — 돌아가는 길만 머리에 두면 된다.
   */
  if (detailId) return <SmsPage hideTitle wide title="발송 상세">
    <SmsButton label="발송 이력으로 돌아가기" secondary onPress={() => setDetailId(null)} />
    <CampaignDetails id={detailId} />
  </SmsPage>;
  return <SmsPage hideTitle wide title="발송 이력">
    {/*
      확인이 필요한 발송이 **있을 때만** 선다. 0건이면 「없습니다」도 그리지 않는다 — 없는 것이
      정상이고, 그 줄은 화면만 차지한다. 색은 경고(빨강)를 쓰지 않는다: 겁을 줄 일은 아니고,
      대신 왼쪽 굵은 선과 굵은 글자로 목록 머리에서 눈에 걸리게 한다.
    */}
    {pending.length ? <View style={[s.card, styles.attention]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: pendingOpen }}
        // aria-* 로도 적는다. react-native-web 은 RN 의 `expanded` 상태를 옮기지 않는다(§sms-ui `Choice`).
        aria-expanded={pendingOpen}
        accessibilityLabel={`확인이 필요한 발송 ${pending.length}건 ${pendingOpen ? '접기' : '펼치기'}`}
        onPress={() => setPendingOpen(!pendingOpen)}
        style={styles.attentionHead}
      >
        <Text style={s.subtitle}>확인이 필요한 발송 {pending.length}건</Text>
        <Text aria-hidden={true} style={s.meta}>{pendingOpen ? '▲' : '▼'}</Text>
      </Pressable>
      {/* 🔴 일자·제목·상태·수신자 수를 적는다. 제목만 여덟 줄 서 있으면 무엇을 누를지 알 수 없다. */}
      {pendingOpen ? pending.map((item) => <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={`${timeLabel(item.createdAt)} ${item.title} ${statusLabel[item.status] ?? item.status} 수신자 ${item.recipientCount}명 발송 상세 열기`}
        onPress={() => setDetailId(item.id)}
        style={styles.pendingRow}
      >
        <View style={styles.line}><Text style={[s.body, styles.pendingTitle]} numberOfLines={1}>{item.title}</Text><Text style={s.meta}>{statusLabel[item.status] ?? item.status}</Text></View>
        <View style={styles.line}><Text style={s.meta}>{timeLabel(item.createdAt)}</Text><Text style={s.meta}>수신자 {item.recipientCount}명</Text></View>
      </Pressable>) : null}
    </View> : null}
    {/* 검색칸은 placeholder 가 같은 말을 하므로 라벨 글자를 걷는다(낭독기에는 그대로 읽힌다). */}
    <TextField hideLabel label="이름,전화번호 뒷자리 4자" placeholder="이름,전화번호 뒷자리 4자" maxLength={100} value={query} onChangeText={(value) => { setQuery(value); setLoading(true); }} />
    {/* 기간 선택은 수신자 화면의 그룹 선택 줄과 같은 모양이다(→ `app/recipients.tsx`). 고른 것만 진하다. */}
    <View style={s.row}>
      {PERIODS.map((item) => <SmsButton key={item.label} label={item.label} secondary={months !== item.months} onPress={() => setMonths(item.months)} />)}
    </View>
    {loading ? <Loading /> : error ? <Notice error message={error} /> : <>
      {/*
        🔴 **지금 보고 있는 범위를 적는다.** 예전에는 「전체 145건」 한 줄이었는데, 그 145 는
        수신자 줄 수이고 화면이 보여 주는 것은 묶음이라 두 숫자가 서로 다른 것을 세고 있다는
        사실이 드러나지 않았다. 셋을 나란히 적어 무엇이 무엇인지 보이게 한다.

        ⚠️ **「성공」은 발송 요청이 성공한 것이지 수신·읽음 확인이 아니다.** 그 문장이 이 자리
        아래에 적혀 있었는데 사용자 요청으로 뺐다 — 사실은 그대로이므로, 이 구분을 모른 채
        「성공 = 읽음」으로 읽는 기능을 여기에 붙이지 마라.
      */}
      <View style={styles.summary}>
        <Text style={s.meta}>{period.label} · {groups.length}묶음 · 수신자 {visible.length}건</Text>
        {/* 정렬 기준만 짧게. 줄어들지 않는다 — 「최근 발송…」으로 잘리면 무슨 순서인지가 사라진다. */}
        <Text style={[s.meta, styles.sortNote]}>최근 발송순</Text>
      </View>
      {/*
        **집계가 먼저다.** 50명에게 한 번 보내면 수신자 줄이 50개라, 이력을 그대로 펴 두면
        「언제 무엇을 보냈나」를 훑을 수가 없고 스크롤만 남는다. 그래서 「일자 · 템플릿 ·
        발송건수」로 접어 두고(→ `lib/sms-history-groups.ts`), 누른 묶음만 수신자 줄을 펼친다.
        수신자 줄은 거기서 **한 번 더** 펼쳐져 본문·첨부·오류를 보여 준다 — 2단 펼침이다.
      */}
      {/* 거른 결과가 비었을 때는 **기간 때문일 수 있다**는 사실을 알려 준다 — 받아 온 줄은 있는데 화면이 비면 사용자는 이력이 사라진 줄로 안다. */}
      {!groups.length ? <Notice message={rows.length ? `${period.label} 안에는 조건에 맞는 발송 이력이 없습니다.` : '조건에 맞는 발송 이력이 없습니다.'} /> : groups.map((group) => {
        const groupOpen = openGroup === group.key;
        return <View key={group.key} style={styles.group}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: groupOpen }}
            // aria-* 로도 적는다. react-native-web 은 RN 의 `expanded` 상태를 옮기지 않는다(§sms-ui `Choice`).
            aria-expanded={groupOpen}
            accessibilityLabel={`${dateLabel(group.date)} ${group.title} ${outcomeSummary(group.counts)} ${groupOpen ? '접기' : '펼치기'}`}
            onPress={() => { setOpenGroup(groupOpen ? null : group.key); setOpenRow(null); }}
            style={styles.groupHead}
          >
            {/* 폰 폭에서 네 칸은 한 줄에 들어가지 않는다. 가로 스크롤 대신 두 줄로 접는다. */}
            <View style={styles.line}>
              <Text style={s.body}>{dateLabel(group.date)}</Text>
              {compact ? null : <Text style={[s.body, styles.groupTitle]} numberOfLines={1}>{group.title}</Text>}
              {/*
                🔴 **`{group.count}건` 이 아니다.** 「24건」은 보낸 결과를 말해 주지 않는다.
                세는 규칙은 발송 상세와 **같은 모듈**을 쓴다(→ `lib/sms-outcome.ts`) — 서버
                `status` 는 `SENT|FAILED` 둘뿐이라 직접 세면 「일부러 안 보낸 것」이 실패로
                섞이고, 같은 발송이 두 화면에서 다른 숫자로 보인다.
              */}
              <Text style={[s.meta, styles.groupCounts]}>{outcomeSummary(group.counts)}</Text>
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
  /**
   * 확인이 필요한 발송 카드. 왼쪽에 굵은 초록 선을 세워 평범한 카드와 구분한다.
   * ⚠️ 빨강(`colors.red`)을 쓰지 않는다 — 고장이 아니라 **아직 안 끝난 일**이고, 이력 화면을
   * 열 때마다 경고가 뜨면 사용자는 며칠 만에 그 색을 무시하기 시작한다.
   */
  attention: { borderLeftWidth: 3, borderLeftColor: colors.green },
  /** 누를 자리는 손가락 크기(48)를 확보한다 — 화살표만 작게 찍혀 있으면 빗맞는다. */
  attentionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 48 },
  pendingRow: { borderTopWidth: 1, borderTopColor: colors.borderCard, paddingVertical: spacing.md, gap: spacing.xs },
  /** 제목만 줄어든다 — 상태 글자가 밀려 나가면 무엇을 확인해야 하는지가 사라진다. */
  pendingTitle: { flexShrink: 1 },
  /** 범위·개수(왼쪽)와 정렬 기준(오른쪽). 좁으면 줄바꿈하되 오른쪽 글자는 잘리지 않는다. */
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sortNote: { marginLeft: 'auto', flexShrink: 0 },
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
  /** 결과 요약은 줄어들지 않는다. 「성공 21 · 실…」로 잘리면 숫자를 읽을 수 없고, 폭은 템플릿 이름이 내놓는다. */
  groupCounts: { flexShrink: 0 },
  detail: { paddingBottom: spacing.md, gap: spacing.sm },
});
