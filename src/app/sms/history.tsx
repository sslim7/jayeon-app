import { useEffect, useState, useSyncExternalStore } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { CampaignDetails } from '@/components/campaign-details';
import { TextField } from '@/components/form-fields';
import { AttachmentPreview } from '@/components/message-attachments';
import { COMPACT_MAX_WIDTH } from '@/components/recipient-table-columns';
import { Loading, Notice, SmsButton, SmsPage, s, smsError, statusLabel } from '@/components/sms-ui';
import { colors, fonts, spacing, text } from '@/constants/theme';
import { formatPhone } from '@/lib/phone';
import { dispatchReady, dispatchSubscriptionId, lineSelectable } from '@/lib/sms-capability';
import { getCapabilities, type SmsCapabilities } from '@/lib/sms-device';
import { smsDispatch } from '@/lib/sms-dispatch';
import { groupSmsHistory, historyCampaignRecipientId, historyTime, needsAttention, outcomeSummary, withinPeriod, type HistoryPeriod } from '@/lib/sms-history-groups';
import { recipientOutcome, type RecipientOutcome } from '@/lib/sms-outcome';
import { smsApi } from '@/lib/sms-api';
import type { Campaign, RecipientHistory } from '@/types/sms';

/** 한 줄이 서로 다른 발송을 가리키도록 시도 번호까지 붙인다(같은 사람에게 두 번 보냈을 수 있다). */
const rowKey = (item: RecipientHistory) => `${item.id}:${item.attemptId ?? ''}`;
/** 목록 한 줄에는 짧은 형식을 쓴다. 초까지 적으면 수신자 이름이 설 자리가 없다. */
const timeLabel = (raw: string) => new Date(raw).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
/**
 * 수신자 줄에 적는 **시각**. 날짜는 적지 않는다.
 *
 * 🔴 **날짜와 템플릿 이름을 뺀 것은 실수가 아니다.** 묶음이 `(일자 · 템플릿)` 단위라 그 안의
 * 모든 줄이 같은 날·같은 템플릿이고, 묶음 머리가 이미 둘 다 말하고 있다. 줄마다 다시 적으면
 * 같은 말을 N번 반복하면서 정작 줄마다 다른 것(누가·몇 시에·어떻게 됐나)을 밀어낸다.
 * 되돌리기 전에 묶음 머리를 먼저 보라.
 *
 * 🔴 **시각 고르기는 `historyTime` 에 맡긴다.** 여기서 `sentAt || failedAt || updatedAt` 을 다시
 * 적으면 묶기·기간 거르기와 우선순위가 갈릴 수 있고, 그러면 줄에 적힌 시각과 그 줄이 들어간
 * 묶음의 일자가 어긋난다(→ `lib/sms-history-groups.ts`).
 *
 * ⚠️ 못 읽는 값에 `Invalid Date` 를 적지 않는다 — 고장으로 읽힌다.
 */
const clockLabel = (item: RecipientHistory) => {
  const at = new Date(historyTime(item) ?? '');
  return Number.isNaN(at.getTime()) ? '시각 미상' : at.toLocaleTimeString('ko-KR', { timeStyle: 'short' });
};
/**
 * 조회 기간. 기본값은 아래 `DEFAULT_PERIOD`(최근 1개월)다.
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
 * 처음 보여 줄 기간. 🔴 **숫자를 화면 글자에 다시 적지 않는다.** 머리글(`최근 1개월 · N묶음
 * · 수신자 N건`)과 빈 결과 문구는 아래 `period.label` 하나에서 나온다 — 두 군데에 적어 두면
 * 한쪽만 바뀌어 **머리글이 거짓말을 한다.**
 */
const DEFAULT_PERIOD: HistoryPeriod = 1;

/**
 * 이 줄에 세울 발송 버튼의 글자. `null` 이면 버튼을 세우지 않는다.
 *
 * 🔴 **`REVIEW`(나갔는지 모름)에는 세우지 않는다.** 이미 나간 문자를 한 번 더 보내게 된다 —
 * `lib/sms-outcome.ts` 의 `retryTargets` 가 같은 이유로 그 줄을 뺀다. `SENT` 도 다시 보낼
 * 일이 아니다.
 */
const SEND_LABELS: Partial<Record<RecipientOutcome, string>> = {
  PENDING: '발송하기',
  UNSENT: '발송하기',
  FAILED: '다시 보내기',
};
/** 「아직 안 받은 사람」. 대기 중인 사람과 내가 안 보내기로 한 사람을 한 칸에 본다(→ `sms-outcome.ts`). */
const UNSENT_OUTCOMES: readonly RecipientOutcome[] = ['PENDING', 'UNSENT'];
/**
 * 목록 한 줄의 바탕색. 홀짝으로 번갈아 칠해 **선 없이** 줄을 가른다.
 *
 * 🔴 **색 토큰을 새로 고르지 않는다.** 수신자 표가 이미 이 두 색으로 줄무늬를 그린다
 * (→ `components/recipient-table.web.tsx` 의 `index % 2 ? colors.bg : colors.card`). 여기서
 * 다른 색을 쓰면 같은 앱 안에서 표마다 줄무늬가 달라져 「이 목록은 다른 것인가」로 읽힌다.
 *
 * 🔴 **`index` 는 그 묶음 안에서의 순번이다.** 전체 목록 기준으로 세면 묶음마다 시작 색이
 * 달라져 규칙이 없는 얼룩으로 보인다. 묶음이 바뀌면 다시 0부터다.
 *
 * ⚠️ **색만으로 가르지 않는다.** 대비가 낮은 화면이나 색각 이상에서는 두 종이색의 차이가
 * 사라진다. 그래서 줄마다 위아래 여백(`styles.head`)을 넉넉히 두고, 묶음 머리는 줄무늬에
 * 섞지 않고 진한 글자로 따로 세운다(→ `styles.groupDate`).
 */
const stripe = (index: number) => (index % 2 ? colors.bg : colors.card);
/**
 * 이 줄을 지금 보낼 수 있는가, 보낸다면 무슨 글자인가.
 *
 * ⚠️ 캠페인 수신자 id 를 뽑을 수 없는 줄(외부 발송 기록 등)에는 세우지 않는다 — 누구에게
 * 보내는지 확신할 수 없는 버튼은 **엉뚱한 사람에게 문자를 보낸다**(→ `historyCampaignRecipientId`).
 */
const sendLabel = (item: RecipientHistory): string | null =>
  historyCampaignRecipientId(item) ? SEND_LABELS[recipientOutcome(item)] ?? null : null;
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
  const [months, setMonths] = useState<HistoryPeriod>(DEFAULT_PERIOD);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<RecipientHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** 이 기기가 무엇을 할 수 있는가. `null` 은 **아직 확인 중**이다 — 「못 한다」와 구별한다. */
  const [capability, setCapability] = useState<SmsCapabilities | null>(null);
  const [sim, setSim] = useState<number | null>(null);
  /** 지금 보내는 중인 줄(`rowKey`). 버튼 글자를 바꾸고 나머지 버튼을 잠그는 데 쓴다. */
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [sendError, setSendError] = useState('');
  /** 한 명 보내고 나면 그 줄의 상태가 바뀐다. 이 값을 올려 이력을 다시 읽는다. */
  const [reloadKey, setReloadKey] = useState(0);
  /** 러너는 싱글턴이다 — 다른 화면이 발송 중이면 여기서도 보낼 수 없다(→ `lib/sms-dispatch.ts`). */
  const dispatch = useSyncExternalStore(smsDispatch.subscribe, smsDispatch.getSnapshot, smsDispatch.getSnapshot);
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
  }, [query, detailId, reloadKey]);
  /*
   * 이 기기가 문자를 보낼 수 있는지 확인한다.
   *
   * 🔴 **실패해도 화면을 세우지 않는다.** 이력을 보러 온 사람에게 단말 확인 실패를 들이밀 이유가
   * 없다(→ 위 「확인이 필요한 발송」이 같은 태도다). 못 읽으면 `capability` 가 `null` 로 남고,
   * 그때는 발송 버튼 대신 「확인하고 있어요」 한 줄이 선다 — 버튼이 그냥 사라지지는 않는다.
   */
  useEffect(() => {
    let alive = true;
    getCapabilities().then((found) => {
      if (!alive) return;
      setCapability(found);
      // ⚠️ 회선이 하나일 때만 정한다. 여럿이면 여기에 고를 화면이 없으므로 발송 상세로 보낸다 —
      // 임의로 첫 회선을 고르면 사용자가 모르는 번호로 문자가 나간다.
      setSim(found.subscriptions.length === 1 ? found.subscriptions[0].id : null);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  /*
   * 이 줄 **한 명만** 보낸다.
   *
   * 🔴 새 흐름이 아니다 — 발송 상세의 「미발송 보내기」·「실패 다시 보내기」와 **같은 배선**이다
   * (→ `components/campaign-details.tsx` 의 `run`). `retryRecipientIds` 에 한 명만 담으면
   * 러너가 그 사람만 골라 보낸다. 실패였던 사람은 러너가 먼저 되돌린 뒤 보낸다.
   *
   * ⚠️ **넘기는 값은 캠페인 수신자 id 다.** 이력 줄의 `id`(`{campaignId}_{...}#pending`)를 그대로
   * 넘기면 러너가 그 사람을 못 찾고, `recipientId`(수신자 마스터 id)를 넘기면 **다른 사람**을
   * 가리킬 수 있다(→ `historyCampaignRecipientId`).
   *
   * ⚠️ iPhone 한 건 확인창(`confirm`)은 붙이지 않는다. 그 창은 여러 명을 줄줄이 보내는 동안
   * 한 명씩 묻기 위한 것이고, 여기는 사용자가 이미 그 한 명을 지목해 누른 자리다.
   */
  async function sendOne(item: RecipientHistory) {
    const campaignId = item.campaignId;
    const campaignRecipientId = historyCampaignRecipientId(item);
    /*
      ⚠️ **두 번 눌림을 막는 자물쇠를 여기 따로 두지 않는다.** 러너가 싱글턴이고 `run()` 이
      첫 await 전에 동기로 `running` 을 세우므로, 연타의 두 번째 호출은 거기서 거절된다
      (→ `lib/sms-runner.ts`). 여기 ref 를 두면 렌더 중에 읽히는 자리가 되어 오히려 위험하다.
    */
    if (!campaignId || !campaignRecipientId || sendingKey || dispatch.running) return;
    setSendingKey(rowKey(item));
    setSendError('');
    try {
      await smsDispatch.run(campaignId, {
        subscriptionId: dispatchSubscriptionId(capability, sim),
        subject: item.campaignTitle,
        retryRecipientIds: [campaignRecipientId],
      });
      setReloadKey((value) => value + 1);
    } catch (e) {
      setSendError(smsError(e));
    } finally {
      setSendingKey(null);
    }
  }
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
  // ⚠️ 못 찾는 값이 들어와도 **기본값 줄**로 떨어진다 — 고정 첨자를 적으면 기본값을 바꿀 때 어긋난다.
  const period = PERIODS.find((item) => item.months === months) ?? PERIODS.find((item) => item.months === DEFAULT_PERIOD)!;
  /*
   * 지금 이 기기에서 보낼 수 없는 이유. 보낼 수 있으면 `null`.
   *
   * 🔴 **버튼을 그냥 감추지 않는다.** 데스크탑 브라우저에는 SIM 이 없어 발송이 불가능한데,
   * 버튼이 아무 말 없이 사라져 있으면 사용자는 「고장인가?」 하고 한참을 찾는다 — 실제로
   * 일어난 일이다. 판정은 발송 상세와 같은 자리를 본다(→ `campaign-details.tsx` 의 `browserOnly`).
   */
  const browserOnly = capability?.supported === false;
  const sendBlocked = browserOnly ? '문자는 Android 앱에서 보낼 수 있어요.'
    : capability === null ? '문자 발송 기능을 확인하고 있어요.'
      : !dispatchReady(capability, sim, true)
        ? lineSelectable(capability) && capability.permissionGranted && sim === null
          ? '발신 SIM 회선을 고른 뒤 보낼 수 있어요. 발송 상세에서 골라 주세요.'
          : '문자 발송 권한과 SIM 준비를 확인해 주세요. 발송 상세에서 설정할 수 있어요.'
        : null;
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
      {pendingOpen ? pending.map((item, index) => <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={`${timeLabel(item.createdAt)} ${item.title} ${statusLabel[item.status] ?? item.status} 수신자 ${item.recipientCount}명 발송 상세 열기`}
        onPress={() => setDetailId(item.id)}
        style={[styles.pendingRow, { backgroundColor: stripe(index) }]}
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
        {/*
          ⚠️ **기간과 묶음 수는 적지 않는다.** 기간은 바로 위 버튼이 선택 상태로 이미 말하고
          있어 같은 말이 두 번 서 있었고, 묶음 수는 화면을 훑으면 그대로 보인다.

          🔴 **천 단위 쉼표를 넣는다.** 네 자리가 넘어가면(`2345건`) 자릿수를 눈으로 셀 수 없다.
        */}
        <Text style={s.meta}>총 {visible.length.toLocaleString('ko-KR')}건</Text>
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
              <Text style={styles.groupDate}>{dateLabel(group.date)}</Text>
              {compact ? null : <Text style={[styles.groupDate, styles.groupTitle]} numberOfLines={1}>{group.title}</Text>}
              {/*
                🔴 **`{group.count}건` 이 아니다.** 「24건」은 보낸 결과를 말해 주지 않는다.
                세는 규칙은 발송 상세와 **같은 모듈**을 쓴다(→ `lib/sms-outcome.ts`) — 서버
                `status` 는 `SENT|FAILED` 둘뿐이라 직접 세면 「일부러 안 보낸 것」이 실패로
                섞이고, 같은 발송이 두 화면에서 다른 숫자로 보인다.
              */}
              <Text style={[s.meta, styles.groupCounts]}>{outcomeSummary(group.counts)}</Text>
              <Text aria-hidden={true} style={s.meta}>{groupOpen ? '▲' : '▼'}</Text>
            </View>
            {compact ? <View style={styles.line}><Text style={[styles.groupDate, styles.groupTitle]} numberOfLines={1}>{group.title}</Text></View> : null}
          </Pressable>
          {groupOpen ? (() => {
            /*
              🔴 **여기서 세는 것은 사람이지 줄이 아니다.** 실패했다가 재시도로 대기가 된 사람은
              「지난 실패」와 「지금 대기」 두 줄로 내려온다. 목록은 두 줄 다 그리되(이력이니까),
              「누구에게 보내야 하나」는 접은 목록으로 본다(→ `lib/sms-history-groups.ts` 의 `current`).
            */
            const sendable = group.items.filter((item) => sendLabel(item));
            /*
              🔴 **왜 「새 문자」라는 길이 따로 필요한가.** 위의 「발송하기」·「다시 보내기」는 그
              사람이 들고 있던 **본문과 첨부를 그대로** 보낸다 — 서버가 claim 할 때 캠페인에 저장된
              내용과 대조해서(→ `lib/sms-runner.ts`) 다른 글을 끼워 넣을 수 없다. 그래서 내용을
              바꿔 보내려면 **새 발송**이어야 하고, 그래야 원래 발송의 기록이 덮이지 않는다.

              ⚠️ 여기 넘기는 것은 **수신자 마스터 id(`recipientId`)** 다. 캠페인 수신자 id 를
              넘기면 문자 보내기 화면이 아무도 못 찾아 아무도 선택되지 않은 채 열린다
              (→ `app/recipients.tsx` 의 「N명에게 문자 작성」이 같은 값을 넘긴다).
            */
            const unsentPeople = [...new Set(group.current
              .filter((item) => UNSENT_OUTCOMES.includes(recipientOutcome(item)))
              .map((item) => item.recipientId)
              .filter((id): id is string => !!id))];
            return <View style={styles.rows}>
              {/* 🔴 보낼 것이 있는데 이 기기가 못 보낼 때만 선다. 보낼 것이 없으면 이 줄도 그리지 않는다. */}
              {sendable.length && sendBlocked ? <Notice message={sendBlocked} /> : null}
              {group.items.map((item, index) => {
                const key = rowKey(item);
                const open = openRow === key;
                const label = sendLabel(item);
                // 🔴 홀짝은 **이 묶음 안의 순번**으로 센다(→ `stripe`). 선 대신 바탕으로 줄을 가른다.
                return <View key={key} style={[styles.row, { backgroundColor: stripe(index) }]}>
                  {/*
                    넓은 화면에서는 **이름 · 시각 · 상태**가 한 줄이고, 버튼이 그 오른쪽에 붙는다.
                    두 줄로 접는 것은 폰 폭에서 네 열이 안 들어가서 하던 일이라, 데스크탑에서까지
                    접혀 있으면 빈 폭만 남는다(묶음 머리가 이미 같은 기준을 쓴다 — `compact`).
                  */}
                  <View style={compact ? undefined : styles.rowWide}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      aria-expanded={open}
                      accessibilityLabel={`${item.name} ${clockLabel(item)} ${statusLabel[item.status] ?? item.status} 발송 이력 ${open ? '접기' : '펼치기'}`}
                      onPress={() => setOpenRow(open ? null : key)}
                      style={[styles.head, compact ? null : styles.headWide]}
                    >
                      {compact ? <>
                        <View style={styles.line}><Text style={s.body} numberOfLines={1}>{item.name}</Text><Text style={s.meta}>{statusLabel[item.status]}</Text></View>
                        <View style={styles.line}><Text style={s.meta}>{clockLabel(item)}</Text></View>
                      </> : <View style={styles.line}>
                        {/* 양 끝 정렬이라 이름은 왼쪽, 상태는 늘 오른쪽 끝이다. 폭이 모자라면 이름만 줄어든다. */}
                        <Text style={[s.body, styles.name]} numberOfLines={1}>{item.name}</Text>
                        <Text style={[s.meta, styles.clock]}>{clockLabel(item)}</Text>
                        <Text style={s.meta}>{statusLabel[item.status]}</Text>
                      </View>}
                    </Pressable>
                    {/*
                      🔴 **펼치지 않아도 보인다.** 「미발송인 사람 옆에 발송 버튼」이 사용자가 말한
                      자리이고, 한 번 더 펼쳐야 나오면 미발송 2명을 찾는 일이 그대로 남는다.
                      보낼 수 없는 기기에서는 세우지 않는다 — 대신 위의 한 줄이 이유를 말한다.
                    */}
                    {label && !sendBlocked ? <View style={compact ? styles.send : undefined}>
                      <SmsButton
                        label={sendingKey === key ? '보내는 중…' : label}
                        accessibilityLabel={`${item.name} ${label}`}
                        disabled={!!sendingKey || dispatch.running}
                        onPress={() => void sendOne(item)}
                      />
                    </View> : null}
                  </View>
                  {open ? <View style={styles.detail}>
                    <Text selectable style={s.meta}>{formatPhone(item.phone)}{item.transport ? ` · ${item.transport}` : ''}</Text>
                    <Text selectable style={s.body}>{item.source === 'EXTERNAL' ? '외부에서 발송한 기록입니다.' : item.message || '이미지 메시지'}</Text>
                    {item.attachments?.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} />)}
                    {item.errorMessage ? <Notice error message={item.errorMessage} /> : null}
                    {item.campaignId ? <SmsButton label={`${item.campaignTitle} 발송 상세`} secondary onPress={() => setDetailId(item.campaignId!)} /> : null}
                  </View> : null}
                </View>;
              })}
              {/* 발송이 실패하면 사유를 여기 한 줄로 남긴다. 버튼 바로 옆이라야 무엇이 실패했는지 읽힌다. */}
              {sendError ? <Notice error message={sendError} /> : null}
              {unsentPeople.length ? <SmsButton
                secondary
                label={`미발송 ${unsentPeople.length}명에게 새 문자 보내기`}
                onPress={() => router.push({ pathname: '/sms/new', params: { ids: unsentPeople.join(',') } })}
              /> : null}
            </View>;
          })() : null}
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
  /**
   * 확인이 필요한 발송 한 줄. 🔴 **선 대신 바탕으로 가른다**(색은 `stripe` 가 정한다).
   * ⚠️ 위아래 여백을 줄이지 마라 — 색만으로는 대비가 낮은 화면에서 줄이 붙어 보인다.
   */
  pendingRow: { paddingVertical: spacing.md, paddingHorizontal: spacing.md, gap: spacing.xs },
  /** 제목만 줄어든다 — 상태 글자가 밀려 나가면 무엇을 확인해야 하는지가 사라진다. */
  pendingTitle: { flexShrink: 1 },
  /** 범위·개수(왼쪽)와 정렬 기준(오른쪽). 좁으면 줄바꿈하되 오른쪽 글자는 잘리지 않는다. */
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sortNote: { marginLeft: 'auto', flexShrink: 0 },
  /**
   * 묶음 사이.
   *
   * 🔴 **선을 쓰지 않는다.** 예전에는 묶음에도 아래 선, 수신자 줄에도 아래 선이 있어서 묶음을
   * 펼치면 **마지막 줄에서 두 선이 붙어** 두 겹으로 보였다. 지금은 양쪽 다 걷고 줄마다 바탕을
   * 번갈아 칠한다(→ `stripe`). 묶음끼리는 아래 여백으로만 떨어진다.
   */
  group: { marginBottom: spacing.sm },
  /**
   * 묶음 머리. 🔴 **줄무늬에 섞이지 않아야 한다** — 머리가 수신자 줄처럼 보이면 어디서부터가
   * 그 묶음 안인지 알 수 없다. 그래서 종이색 대신 옅은 잉크 바탕을 깔고, 글자도 진하게 쓴다
   * (→ `groupDate`). 색만으로 가르지 않으려는 것이기도 하다.
   */
  groupHead: { backgroundColor: colors.inkFillSoft, paddingVertical: spacing.md, paddingHorizontal: spacing.md, gap: spacing.xs },
  /** 묶음 머리의 일자·템플릿. 본문(`s.body`)보다 진하고 굵다 — 색을 못 읽는 화면에서도 머리로 읽힌다. */
  groupDate: { ...fonts.bodySemi, color: colors.ink, fontSize: text.lg },
  /** 펼친 수신자 목록은 한 칸 들여쓴다. 묶음 머리와 같은 선에 서면 어디까지가 그 묶음인지 알 수 없다. */
  rows: { paddingLeft: spacing.md, paddingBottom: spacing.sm },
  /** 수신자 한 줄. 바탕색은 `stripe` 가 홀짝으로 정한다. 테두리는 없다. */
  row: { paddingHorizontal: spacing.md },
  /**
   * 수신자 한 줄의 높이.
   *
   * 🔴 **여백으로 줄을 가르려 하지 마라.** 가르는 일은 줄무늬(→ `stripe`)가 이미 한다. 여백을
   * 더 벌리면 50명짜리 발송을 펼쳤을 때 스크롤만 길어져, **한 화면에 많이 훑으려고** 묶음으로
   * 접어 둔 이유가 사라진다.
   *
   * 🔴 **그렇다고 44 아래로 내리지도 마라.** 눌러서 펼치는 줄이고 발송 버튼까지 붙는 자리라,
   * 손가락이 닿는 최소 크기다. 수신자 표의 칸(`recipient-table.web.tsx`: 48 / 좁으면 44)과
   * 같은 정도로 맞춘 값이다 — 그보다 키우지 않는다.
   */
  head: { minHeight: 44, justifyContent: 'center', paddingVertical: spacing.sm, gap: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  /**
   * 묶음 머리의 템플릿 이름은 **남는 폭을 다 먹는다.** 데스크탑에서는 일자와 건수 사이를 이
   * 칸이 채워야 「일자 · 템플릿 · N건 · ▼」이 한 줄로 정렬되고, 폭이 좁아 이름이 잘릴 때도
   * 건수와 화살표가 제자리를 지킨다.
   */
  groupTitle: { flex: 1 },
  /** 결과 요약은 줄어들지 않는다. 「성공 21 · 실…」로 잘리면 숫자를 읽을 수 없고, 폭은 템플릿 이름이 내놓는다. */
  groupCounts: { flexShrink: 0 },
  /** 넓은 화면의 수신자 줄: 머리와 버튼이 한 줄에 선다. 버튼은 제 폭만 갖고 나머지는 머리가 먹는다. */
  rowWide: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headWide: { flex: 1 },
  /**
   * 넓은 화면의 한 줄은 **양 끝 정렬**이다(`styles.line`) — 이름 왼쪽, 시각 가운데, 상태 오른쪽.
   * 🔴 **줄어드는 칸은 이름 하나뿐이다.** 폭이 768 언저리로 좁아지거나 오른쪽에 발송 버튼이
   * 붙어도 시각과 상태는 제 글자를 지키고 이름만 말줄임된다(`numberOfLines={1}` 와 한 쌍).
   */
  name: { flexShrink: 1 },
  /** 「오전 12…」는 시각이 아니다. 줄어들지 않는다 — 내놓을 폭은 이름이 갖고 있다. */
  clock: { flexShrink: 0 },
  /** 폰 폭에서만 쓰는 자리. 줄 머리 아래에 버튼이 선다. 여백은 최소한만 — 줄이 길어지면 훑을 수 없다. */
  send: { paddingBottom: spacing.sm },
  detail: { paddingBottom: spacing.md, gap: spacing.sm },
});
