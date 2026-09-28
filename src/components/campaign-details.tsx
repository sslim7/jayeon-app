import { formatPhone } from '@/lib/phone';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ButtonRow,
  Choice,
  Loading,
  Notice,
  SmsButton,
  s,
  smsError,
  statusLabel,
} from '@/components/sms-ui';
import { AttachmentPreview } from '@/components/message-attachments';
import { colors, radii, spacing } from '@/constants/theme';
import { smsApi } from '@/lib/sms-api';
import {
  composerConfirm,
  dispatchReady,
  dispatchSubscriptionId,
  lineSelectable,
} from '@/lib/sms-capability';
import { getCapabilities, requestPermissions, type SmsCapabilities } from '@/lib/sms-device';
import { smsDispatch } from '@/lib/sms-dispatch';
import { blockedByOther, personalizeMessage, type SendChoice, type SendPrompt } from '@/lib/sms-runner';
import {
  countOutcomes,
  hasClosedUnsent,
  narrowTargets,
  recipientOutcome,
  retryTargets,
  unsentTargets,
} from '@/lib/sms-outcome';
import type { Campaign, CampaignRecipient } from '@/types/sms';
/** 나갔는지 확인되지 않은 사람. 「실패」와도 「미발송」과도 다른 세 번째 칸이다. */
const uncertain = (r: CampaignRecipient) => recipientOutcome(r) === 'REVIEW';
export function CampaignDetails({ id, onOpenCampaign, onlyRecipientIds }: {
  id: string;
  /**
   * 다른 캠페인이 발송을 잡고 있을 때 그 화면으로 가는 길. 🔴 **라우트 화면만 준다** —
   * 발송 이력 시트(`campaign-history-sheet.tsx`) 안에서는 모달 뒤로 이동해 버려서 아무 일도
   * 일어나지 않은 것처럼 보인다. 그쪽에서는 「중단」이 빠져나갈 길이다.
   */
  onOpenCampaign?: (campaignId: string) => void;
  /**
   * **이 사람들에게만 보낸다** — 캠페인 수신자 id 목록이다.
   *
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 예약 화면은 체크박스로 사람을 고르게 해 놓고, 보내기는 **예약한 건 전체**로 나갔다.  │
   * │ 「체크해야 발송 버튼이 켜지는데 왜 다 나가느냐」 — 그 자리를 메우는 통로가 이 prop 이다. │
   * └────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ 주지 않으면(`undefined`) 예전 그대로 **전원**이다. 발송 이력·문자 보내기에서 들어오는
   * 평소 경로는 아무것도 달라지지 않는다.
   * 🔴 **좁히기만 한다.** 받은 id 를 그대로 러너에 넘기지 않고 `narrowTargets` 로 교집합을
   * 낸다 — 이미 보낸 사람·결과 불명인 사람에게 다시 나가면 안 된다.
   */
  onlyRecipientIds?: string[] | null;
}) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [rows, setRows] = useState<CampaignRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [queryError, setQueryError] = useState('');
  const [capability, setCapability] = useState<SmsCapabilities | null>(null);
  const [sim, setSim] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  /*
    iPhone 한 건 확인창.

    🔴 **iPhone 은 앱이 문자를 직접 보내지 못한다.** 시스템 메시지 화면을 띄우고 사람이
    「보내기」를 눌러야 나가므로, 다음 사람으로 넘어가기 전에 이 창에서 발송/통과/중단을
    고르게 한다. 안드로이드는 이 창을 쓰지 않는다 — 운영 중인 흐름을 그대로 둔다
    (갈림은 `Platform.OS` 가 아니라 단말이 알려 준 `composerConfirm` 으로 판단한다).
  */
  const [prompt, setPrompt] = useState<SendPrompt | null>(null);
  // 창을 띄운 쪽이 기다리는 promise 의 마침표. 창이 사라지면 반드시 한 번 불러야 한다 —
  // 안 부르면 발송 루프가 claim 한 사람을 쥔 채로 영원히 멈춘다.
  const answer = useRef<((choice: SendChoice) => void) | null>(null);
  /*
    이 화면이 아직 살아 있는가.

    🔴 떠난 화면은 확인창을 띄울 수 없다. 그런데 루프는 다음 사람에서 또 `confirm` 을 부르고,
    그 약속은 아무도 풀어 주지 않아 **발송이 통째로 매달린다** — 화면을 떠난 뒤 돌아왔더니
    모든 캠페인이 「다른 문자 발송 중」으로 막혀 있던 길이 이것이다. 떠난 뒤의 물음에는 곧장
    「중단」으로 답한다.
  */
  const live = useRef(true);
  const settle = useCallback((choice: SendChoice) => {
    const pending = answer.current;
    if (!pending) return;
    answer.current = null;
    setPrompt(null);
    pending(choice);
  }, []);
  // 화면을 떠나면 남은 한 건은 「중단」으로 닫는다. 결과 없이 매달린 대상을 남기지 않는다.
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; settle('stop'); };
  }, [settle]);
  const dispatch = useSyncExternalStore(
    smsDispatch.subscribe,
    smsDispatch.getSnapshot,
    smsDispatch.getSnapshot,
  );
  const running = dispatch.running;
  const mine = dispatch.campaignId === id;
  /** 다른 캠페인이 잡고 있는가. 잡고 있다면 여기서 빠져나갈 길(중단·열기)을 함께 받는다. */
  const blocked = blockedByOther(dispatch, id);
  const blockedId = blocked?.campaignId ?? null;
  /** 무엇을 멈추는지 밝히기 위한 이름. ⚠️ 남의 발송을 이름도 모른 채 멈추게 하지 않는다. */
  const [otherCampaign, setOtherCampaign] = useState<{ id: string; title: string } | null>(null);
  // 읽어 둔 이름이 지금 막고 있는 캠페인의 것일 때만 쓴다 — 다른 캠페인 이름을 걸어 두면 엉뚱한 발송을 멈추게 된다.
  const otherTitle = otherCampaign?.id === blockedId ? otherCampaign.title : '';
  /**
   * 중단을 되묻는 중인 캠페인. 손가락이 스친 것으로 25명짜리 발송이 멈추면 안 된다.
   * 🔴 boolean 이 아니라 **누구에 대한 물음인지**를 담는다 — 발송이 끝나거나 다른 캠페인으로
   * 바뀌면 물음이 저절로 무효가 된다.
   */
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);
  /**
   * 펼쳐 둔 수신자 줄(`CampaignRecipient.id`). 🔴 **한 번에 하나만 편다** — 발송 이력과 같은
   * 방식이다(→ `app/sms/history.tsx`). 여러 줄이 동시에 펼쳐지면 접어 둔 이유가 사라지고,
   * 더 나쁘게는 펼친 줄마다 첨부를 받으므로 **50명이면 수십 MB 를 한꺼번에 받게 된다.**
   */
  const [openRow, setOpenRow] = useState<string | null>(null);
  const confirmStop = !!blockedId && confirmStopId === blockedId;
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, recipients] = await Promise.all([smsApi.get(id), smsApi.recipients(id)]);
      setCampaign(c);
      setRows(recipients);
      setQueryError('');
    } catch (e) {
      setQueryError(smsError(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void smsDispatch
      .sync(id)
      .catch((e) => setError(smsError(e)))
      .finally(load);
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load, id]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [dispatch.currentRecipientId, dispatch.running, load]);
  // 발송이 끝났으면 남아 있던 확인창을 거둔다. 끝난 뒤의 물음은 답할 곳이 없다.
  useEffect(() => {
    if (!running) settle('stop');
  }, [running, settle]);
  useEffect(() => {
    if (!blockedId) return;
    let active = true;
    // 제목을 못 읽어도 막힌 사실과 중단 버튼은 그대로 보여 준다 — 이름은 거들 뿐이다.
    smsApi.get(blockedId).then((c) => { if (active) setOtherCampaign({ id: blockedId, title: c.title }); }).catch(() => {});
    return () => { active = false; };
  }, [blockedId]);
  const applyCapability = useCallback((c: SmsCapabilities) => {
    setCapability(c);
    setSim((prev) =>
      c.subscriptions.some((s) => s.id === prev)
        ? prev
        : c.subscriptions.length === 1
          ? c.subscriptions[0].id
          : null,
    );
  }, []);
  useEffect(() => {
    getCapabilities()
      .then(applyCapability)
      .catch((e) => setError(smsError(e)));
  }, [applyCapability]);
  async function permission() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      applyCapability(await requestPermissions());
      setError('');
    } catch (e) {
      setError(smsError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  /*
    보낼 사람을 고르는 두 가지 길.

    `resume` 은 아직 안 보낸 사람 전부다 — 대기 중인 사람과 내가 통과·중단으로 닫은 사람을
    **한 번에** 보낸다. 닫힌 사람은 서버에서 FAILED 라 되돌려야 보낼 수 있어 목록으로 넘기고,
    닫힌 사람이 하나도 없으면(안드로이드의 보통 경우) 목록 없이 예전 그대로 돈다.
  */
  async function run(mode: 'resume' | 'retry' = 'resume') {
    if (lock.current || running || !available) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await smsDispatch.run(id, {
        subscriptionId: dispatchSubscriptionId(capability, sim),
        subject: campaign?.title,
        ...(perMessage
          ? { confirm: (target: SendPrompt) => new Promise<SendChoice>((resolve) => {
            if (!live.current) { resolve('stop'); return; }
            answer.current = resolve;
            setPrompt(target);
          }) }
          : {}),
        /*
          🔴 **고른 사람이 있으면 목록을 반드시 넘긴다.** 예약(전원 READY)에는 되돌릴 사람이
          없어 `hasClosedUnsent` 가 거짓이고, 예전에는 그때 목록 없이 돌아 **예약된 전원**이
          나갔다. 러너는 `retryRecipientIds` 가 있으면 대기자를 그 집합으로 거르고, READY 인
          줄은 되돌리기를 건너뛰므로 목록을 줘도 탈이 없다(→ `lib/sms-runner.ts`).
        */
        ...(mode === 'retry'
          ? { retryRecipientIds: retryIds }
          : picking || hasClosedUnsent(rows) ? { retryRecipientIds: resumeIds } : {}),
      });
      await load();
    } catch (e) {
      setError(smsError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  /*
    발송 중단만 한다. 캠페인 취소(CANCELLED) 경로는 이 화면에서 뺐다 — 발송이 이미 끝났으면
    멈출 것이 없다.

    🔴 **내 캠페인이 아니어도 멈출 수 있다.** 러너는 싱글턴이라 어느 화면에서 불러도 같은
    흐름이 멈춘다. 예전에는 자기 캠페인일 때만 이 버튼을 세워서, 다른 캠페인이 잡고 있으면
    앱을 껐다 켜는 것 말고는 빠져나갈 길이 없었다.
  */
  async function stop() {
    if (!running) return;
    setConfirmStopId(null);
    try {
      // 확인창이 떠 있으면 루프가 답을 기다리는 중이다. 먼저 닫아야 중단이 실제로 진행된다.
      // 다른 화면의 확인창은 러너의 `stop()` 이 끊는다 — 여기서는 닿을 수 없다.
      settle('stop');
      smsDispatch.stop();
      await load();
    } catch (e) {
      setError(smsError(e));
    }
  }
  /*
    🔴 **「실패」와 「미발송」을 갈라 센다.** 서버 status 는 `SENT|FAILED` 둘뿐이라 통과·중단·시트
    취소까지 전부 FAILED 로 들어오는데, 그것을 실패로 세면 「보내려다 안 간 것」과 「아예 안 보낸
    것」이 한 칸에 섞인다. 가르는 근거는 사유 코드다(→ `lib/sms-outcome.ts`).
  */
  const counts = countOutcomes(rows);
  const sent = counts.sent;
  const failed = counts.failed;
  const unknown = counts.review;
  /*
    🔴 **「발송중」과 「결과 확인 필요」는 다른 말이다.** `unknown`(REVIEW)은 결과를 받았는데
    나갔는지 확정되지 않은 사람이고, 이 값은 **결과를 아예 받지 못한** 사람이다. 한 낱말로
    묶어 부르던 동안 사용자는 무엇을 확인해야 하는지 알 수 없었다. ⚠️ 발송 이력의 묶음 머리도
    같은 낱말을 쓴다(→ `lib/sms-history-groups.ts`) — 두 화면이 같은 발송을 다르게 부르면 안 된다.
  */
  const inFlight = counts.sending;
  const current = rows.find((r) => r.id === dispatch.currentRecipientId);
  const attachmentSupported = !campaign?.attachments?.length || !!capability?.mmsSupported;
  const available = dispatchReady(capability, sim, attachmentSupported);
  // 한 건마다 시스템 화면을 거치는 단말인가(iPhone). 회선 선택 UI 유무도 여기서 갈린다.
  const perMessage = composerConfirm(capability);
  const chooseLine = lineSelectable(capability);
  // 데스크톱 브라우저처럼 발송 자체가 불가능한 곳. null(확인 중)과 구별한다 — 확인 중에는 버튼을 비활성으로 둔다.
  const browserOnly = capability?.supported === false;
  const sending = rows.some((r) => r.status === 'SENDING');
  /*
    발송 중 지금 보내는 1건(SENDING)은 곧 확정되니 제외한다. 그 밖의 미확정은 자동 동기화로
    안 풀릴 수 있어 직접 다시 확인할 길을 둔다.

    🔴 **`SENDING` 을 빠뜨리지 마라.** `uncertain` 이 REVIEW 만 보게 된 뒤로, 결과를 못 받아
    발송중으로 남은 줄은 `uncertain` 에 들지 않는다. 여기서 따로 들여보내지 않으면 「결과 다시
    확인」 버튼이 사라지고, 그 캠페인은 `SENDING` 이 하나 남았다는 이유로 영영 다시 보낼 수
    없게 된다(→ `lib/sms-runner.ts` 의 `run` 이 그때 발송을 거절한다).
  */
  const unresolved = rows.some((r) => (uncertain(r) || r.status === 'SENDING') && !(running && r.status === 'SENDING'));
  /*
    수신자 목록을 없애며 개별 선택도 없앴다. 확실히 실패한 행은 전부 다시 보내고, 결과 미확정
    행은 중복 발송 위험이 있어 빼는 규칙은 그대로다.

    🔴 **두 목록은 한 사람도 겹치지 않는다.** 예전에는 중단·통과로 닫힌 사람이 「실패 다시
    보내기」에 들어가 「미발송 계속 보내기」와 나란히 서서, 어느 쪽을 눌러야 하는지 알 수 없었다.
  */
  /*
    🔴 **두 벌을 따로 둔다.** `allUnsentIds` 는 이 캠페인에 남은 미발송 **전체**이고,
    `resumeIds` 는 그중 **이번에 실제로 보낼 사람**이다. 요약 줄(「미발송 N」)이 좁혀진 수를
    적으면 사용자는 나머지가 이미 나간 줄 알고, 버튼이 전체 수를 적으면 고르지 않은 사람까지
    보내는 줄 안다 — 둘 다 화면이 없던 일을 말하는 것이다.
  */
  const allUnsentIds = unsentTargets(rows);
  const resumeIds = narrowTargets(allUnsentIds, onlyRecipientIds);
  const retryIds = narrowTargets(retryTargets(rows), onlyRecipientIds);
  const retryable = retryIds.length > 0;
  /** 고른 사람만 보내는 중인가. 빈 배열도 「골랐다」다(아무도 고르지 않았다는 뜻). */
  const picking = !!onlyRecipientIds;
  const pickedCount = resumeIds.length + retryIds.length;
  // 수신자별 카드가 없으니 사유는 대표 1건만 요약한다. 같은 사유가 반복되는 경우가 대부분이다.
  const reasons = (pick: (r: CampaignRecipient) => boolean) =>
    [...new Set(rows.filter(pick).map((r) => r.errorMessage).filter((m): m is string => !!m))];
  const errorMessages = reasons((r) => recipientOutcome(r) === 'FAILED' || uncertain(r));
  // ⚠️ 미발송 사유는 빨간 글씨로 적지 않는다 — 고장이 아니라 사람이 그렇게 정한 결과다.
  // 그 안에서 「누가 통과이고 누가 중단인지」는 이 줄이 알려 준다.
  const unsentMessages = reasons((r) => recipientOutcome(r) === 'UNSENT');
  // 발송이 끝나면 SIM·권한 설정이 더는 할 일이 아니다. 남아 있으면 「끝났는데 또 뭘 골라야 하나」로 읽혀 헷갈렸다.
  const needsLine = running || resumeIds.length > 0 || retryable;
  // 평소에는 진입 시 자동 sync와 3초 load로 충분하다. 결과가 확정되지 않은 행이 남았을 때만 폰 journal을 다시 서버에 맞춘다.
  function recheck() {
    if (running || busy) return;
    void smsDispatch
      .sync(id)
      .then(load)
      .catch((e) => setError(smsError(e)));
  }
  return (
    <View style={{ gap: 16 }}>
      <Text accessibilityRole="header" style={s.subtitle}>{campaign?.title ?? '발송 상세'}</Text>
      {loading ? <Loading /> : null}
      {queryError ? <Notice error message={queryError} /> : null}
      {error ? <Notice error message={error} /> : null}
      {mine && dispatch.error ? <Notice error message={dispatch.error} /> : null}
      {campaign ? (
        <>
          <View style={s.card}>
            <Text style={s.meta}>
              {statusLabel[campaign.status]} ·{' '}
              {new Date(campaign.createdAt).toLocaleString('ko-KR')}
            </Text>
            {/*
              🔴 **캠페인의 본문·첨부를 여기 크게 세우지 마라.** 두 가지 이유가 겹친다.

              1) **발송은 캠페인의 내용을 보내지 않는다.** 나가는 글과 이미지는 수신자 줄이
                 각자 들고 있는 것이다(`CampaignRecipient.message` / `.attachments`) — 러너가
                 발송 직전에 꺼내 쓰는 것도 그쪽이다(→ `lib/sms-runner.ts`). 캠페인 본문은
                 **여러 명에게 공통일 때만** 맞는 이야기이고, 그것을 대표로 세우면 「한 발송 =
                 한 내용」이라는 없는 규칙이 생긴다. 실제로 그 오해 위에 예약 합치기의
                 「내용이 같아야 합친다」 제약이 얹혔다가 걷혔다.
              2) **이미 두 번 확정한 내용을 세 번째로 보여 주는 자리였다.** 문자 보내기 흐름은
                 템플릿을 고를 때 한 번, 작성 화면에서 한 번 같은 글을 보여 준다. 마지막 화면이
                 할 일은 **「누구에게 나가는가」**를 보여 주고 보내는 것이다.

              ⚠️ 「발송 전에 내용을 확인해야 하지 않나」로 되살리려면 먼저 아래 수신자 목록을
              보라. 줄을 펼치면 **그 사람 이름으로 치환된 실제 본문과 첨부**가 나온다 — 앞의 두
              화면이 못 보여 주던 것(`@name` 이 실제로 어떻게 나가는지)이 거기 있다.
            */}
            <Text style={s.title} accessibilityLiveRegion="polite">
              {sent + failed} / {rows.length}
            </Text>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: rows.length, now: sent + failed }}
              style={{ height: 8, borderRadius: radii.hair, backgroundColor: colors.inkFill }}
            >
              <View
                style={{
                  height: 8,
                  width: `${rows.length ? ((sent + failed) / rows.length) * 100 : 0}%`,
                  backgroundColor: colors.green,
                  borderRadius: radii.hair,
                }}
              />
            </View>
            {/*
              🔴 「실패」는 보냈는데 안 간 사람, 「미발송」은 아직 안 보낸 사람이다. 섞으면 무엇을
              해야 하는지 알 수 없다.
              ⚠️ **「발송중」은 0일 때 적지 않는다.** 보통은 없는 것이 정상이라, 늘 서 있으면
              읽는 데 방해만 된다(발송 이력의 요약도 같은 태도다 — `outcomeSummary`).
            */}
            <Text selectable style={s.body}>
              성공 {sent} · 실패 {failed} · 미발송 {allUnsentIds.length}{inFlight ? ` · 발송중 ${inFlight}` : ''}
            </Text>
            {/*
              🔴 **고른 사람만 보낸다는 사실을 여기서 밝힌다.** 예약 화면에서 3명을 체크하고
              넘어온 사람이 이 화면에서 「전체가 나가는 줄」 알면, 버튼을 누르기 전에는 그 오해를
              풀 자리가 없다. 아래 발송 버튼의 인원수만으로는 「전체 중 몇 명인지」가 보이지 않는다.
              ⚠️ 좁혔는데 보낼 사람이 0이면 버튼 자체가 서지 않으므로, 그 경우도 말로 남긴다 —
              말이 없으면 「버튼이 왜 없지」로 끝난다.
            */}
            {picking ? (
              <Notice
                message={pickedCount > 0
                  ? `전체 ${rows.length}명 중 고른 ${pickedCount}명에게만 보냅니다.`
                  : `전체 ${rows.length}명 중 고른 사람은 이미 보냈거나 지금 보낼 수 있는 상태가 아니에요. 보낼 사람이 없습니다.`}
              />
            ) : null}
            {errorMessages.length ? (
              <Notice
                error
                message={errorMessages.length > 1 ? `${errorMessages[0]} 외 사유 ${errorMessages.length - 1}가지` : errorMessages[0]}
              />
            ) : null}
            {unsentMessages.length ? (
              <Notice
                message={unsentMessages.length > 1 ? `${unsentMessages[0]} 외 사유 ${unsentMessages.length - 1}가지` : unsentMessages[0]}
              />
            ) : null}
            {unknown ? (
              <Notice
                message={`결과 확인 필요 ${unknown}건 · 실제 발송 여부를 확정할 수 없어 자동 재발송하지 않습니다.`}
              />
            ) : null}
            {/*
              🔴 **발송중으로 남은 줄이 있으면 이 캠페인은 한 명도 더 보낼 수 없다**
              (→ `lib/sms-runner.ts` 의 `run`). 그 사실을 여기 적지 않으면 사용자는 버튼을
              눌러 보고 나서야 「결과가 확인되지 않은 발송이 있어요」를 만난다.
              ⚠️ 발송 중일 때는 지금 보내는 1건이 여기 세어지므로 적지 않는다 — 곧 확정된다.
            */}
            {inFlight && !running ? (
              <Notice
                message={`발송중 ${inFlight}건 · 결과를 받지 못해 이 발송은 더 보낼 수 없어요. 「결과 다시 확인」을 눌러 주세요. 폰 메시지함에도 없으면 발송 이력에서 「안 나간 것으로 표시」할 수 있어요.`}
              />
            ) : null}
            {unresolved ? (
              <SmsButton label="결과 다시 확인" secondary disabled={running || busy} onPress={recheck} />
            ) : null}
            {running && mine && current ? (
              <Text style={s.body}>
                현재 발송: {current.name} · {formatPhone(current.phone)}
              </Text>
            ) : null}
          </View>
          <Notice
            message={perMessage
              ? '성공은 iPhone 메시지 앱에 넘겼다는 뜻이며 상대방의 수신·읽음 확인이 아닙니다.'
              : '성공은 Android 발송 요청 성공이며 상대방의 수신·읽음 확인이 아닙니다.'}
          />
          {!needsLine ? null : capability === null ? (
            <Notice message="문자 발송 기능을 확인하고 있어요." />
          ) : !chooseLine ? (
            /*
              🔴 iPhone 에는 회선을 고르는 API 가 없다. 그래서 SIM 선택 UI 자체를 감춘다 —
              고를 수 없는 것을 보여 주면 「왜 안 골라지나」를 묻게 된다. 대신 iPhone 에서만
              달라지는 세 가지(탭 두 번 · iMessage · 회선 고정)를 여기서 한 번 알린다.

              브라우저(`supported: false` + 회선 정보 없음)보다 먼저 본다. 문자를 못 보내는
              iPhone 에게 「Android 앱에서 쓰세요」라고 하면 고장으로 읽힌다.
            */
            <View style={s.card}>
              <Text style={s.subtitle}>iPhone 에서 보내기</Text>
              {!capability.supported ? (
                <>
                  <Notice error message="이 기기에서는 문자를 보낼 수 없어요. 회선(SIM)과 메시지 설정을 확인해 주세요." />
                  <SmsButton
                    label="문자 기능 다시 확인"
                    secondary
                    disabled={busy || running}
                    onPress={() => void permission()}
                  />
                </>
              ) : null}
              <Notice message="한 건마다 iPhone 메시지 화면이 열립니다. 앱의 「발송」과 메시지 화면의 「보내기」로 탭이 두 번이에요 — 25명이면 50번입니다." />
              <Notice message="상대가 아이폰이면 iMessage로 나갈 수 있어요. 그때는 문자 요금이 아니라 데이터로 나갑니다." />
              <Notice message="iPhone은 발신 회선을 고를 수 없습니다. 기기에 설정된 기본 회선의 번호로 나갑니다." />
            </View>
          ) : !capability.supported ? (
            <Notice message="이 기능은 Android·iPhone 앱에서 사용할 수 있습니다. 수신자 관리와 이력 조회는 여기서도 가능합니다." />
          ) : (
            <View style={s.card}>
              <Text style={s.subtitle}>발신 SIM 회선</Text>
              <Notice message="선택한 SIM에 연결된 실제 전화번호로 발송합니다. 발신번호를 임의로 바꿀 수 없습니다." />
              {!capability.permissionGranted ? (
                <SmsButton
                  label="SMS 발송 권한 허용"
                  disabled={busy || running}
                  onPress={() => void permission()}
                />
              ) : null}
              {capability.subscriptions.map((line) => (
                <Choice
                  key={line.id}
                  label={line.label}
                  selected={sim === line.id}
                  disabled={busy || running}
                  onPress={() => setSim(line.id)}
                />
              ))}
              {capability.permissionGranted && !capability.subscriptions.length ? (
                <Notice message="사용 가능한 SIM이 없습니다. 단말의 SIM 설정을 확인해 주세요." />
              ) : null}
              {capability.subscriptions.length > 1 && sim === null ? (
                <Notice message="발송할 SIM을 직접 선택해 주세요." />
              ) : null}
              <SmsButton
                label="SIM·권한 다시 확인"
                secondary
                disabled={busy || running}
                onPress={() => void permission()}
              />
            </View>
          )}
          {/* 브라우저에서 보는 것만으로 「최신 앱을 설치하라」는 오류가 뜨면 고장으로 읽힌다. 실제 Android 앱에서 MMS 미지원일 때만 알린다. */}
          {needsLine && capability?.supported && !attachmentSupported ? (
            <Notice
              error
              message={perMessage
                ? '이 iPhone에서는 이미지 첨부를 보낼 수 없어요. 설정 › 메시지의 MMS 메시지를 확인해 주세요.'
                : '첨부 발송을 지원하는 최신 Android 앱을 설치해 주세요.'}
            />
          ) : null}
          {running ? (
            mine ? (
              <>
                {/* iPhone 한 건 확인창. 안드로이드에서는 prompt 가 없어 예전 그대로 중단 버튼만 남는다. */}
                {prompt ? (
                  <View style={s.card}>
                    <Text style={s.meta} accessibilityLiveRegion="polite">
                      {prompt.index} / {prompt.total} · {prompt.name} · {formatPhone(prompt.phone)}
                    </Text>
                    <Text selectable style={s.body}>{prompt.message}</Text>
                    <ButtonRow>
                      <SmsButton fill label="발송" onPress={() => settle('send')} />
                      <SmsButton fill secondary label="통과" onPress={() => settle('skip')} />
                      <SmsButton fill secondary danger label="중단" onPress={() => settle('stop')} />
                    </ButtonRow>
                    <Notice message="「발송」을 누르면 iPhone 메시지 화면이 열려요. 거기서 「보내기」를 한 번 더 눌러야 나갑니다." />
                    <Notice message="「통과」는 이 사람을 건너뛰고 다음으로 갑니다. 「중단」은 여기까지 저장하고 멈춥니다." />
                  </View>
                ) : null}
                <SmsButton
                  label={dispatch.stopping ? '현재 1건 저장 후 중단 중…' : '발송 중단'}
                  secondary
                  danger
                  disabled={dispatch.stopping}
                  onPress={() => void stop()}
                />
                <Notice
                  message={perMessage
                    ? '메시지 화면에서 이미 보낸 문자는 취소할 수 없습니다. 현재 결과 저장 후 멈춥니다.'
                    : '이미 Android에 전달한 문자는 취소할 수 없습니다. 현재 결과 저장 후 멈춥니다.'}
                />
                {/*
                  🔴 **중단이 무엇을 남기는지 숫자로 말한다.** 예전에는 중단이 캠페인을 취소해
                  남은 사람이 예약에서 사라졌고, 지금은 그대로 남는다(→ `lib/sms-runner.ts`).
                  바뀐 사실을 화면이 말하지 않으면 사용자는 여전히 「멈추면 다 날아간다」로 알고
                  중단 버튼을 못 누른다 — 그래서 끝까지 보내거나 앱을 끄는 수밖에 없었다.
                */}
                <Notice
                  message={`지금 멈춰도 여기까지 보낸 ${sent}건은 그대로 남고, 남은 ${allUnsentIds.length}명은 미발송으로 예약에 머물러요. 다시 보낼지 지울지는 직접 정하면 됩니다.`}
                />
              </>
            ) : (
              /*
                🔴 **막아 놓고 나갈 길을 주지 않던 자리.** 예전에는 「다른 문자를 발송 중입니다」
                한 줄뿐이라, 그 발송을 멈출 수도 찾아갈 수도 없어 앱을 껐다 켜는 것이 유일한
                탈출구였다 — 사용자가 알 길이 없는 탈출구는 없는 것과 같다.

                ⚠️ 그렇다고 남의 발송을 손가락 한 번에 멈추게 하지도 않는다. **무엇을 멈추는지
                이름으로 밝히고** 한 번 더 묻는다.
              */
              <View style={s.card}>
                <Text style={s.subtitle}>다른 문자를 발송 중이에요</Text>
                <Notice message={`${otherTitle ? `「${otherTitle}」` : '다른 문자'} 발송이 끝나거나 중단돼야 이 문자를 보낼 수 있어요.`} />
                {blocked?.canOpen && blockedId && onOpenCampaign ? (
                  <SmsButton
                    label="발송 중인 문자 열기"
                    secondary
                    onPress={() => onOpenCampaign(blockedId)}
                  />
                ) : null}
                {confirmStop ? (
                  <>
                    {/*
                      ⚠️ 이 문구는 **이제야 사실이 되었다.** 예전에는 중단이 캠페인을 `CANCELLED` 로
                      바꿔 버려 「나중에 이어 보낼 수 있어요」가 거짓이었다 — 취소된 캠페인은 예약
                      목록에서 빠져 이어 보낼 자리가 없었다. 중단이 상태를 건드리지 않게 되면서
                      (→ `lib/sms-runner.ts` 의 `run`) 남은 사람이 실제로 예약에 머문다.
                      🔴 러너가 다시 취소를 부르게 되면 이 문장부터 거짓말이 된다.
                    */}
                    <Notice error message={`${otherTitle ? `「${otherTitle}」` : '다른 문자'} 발송을 지금 멈출까요? 이미 보낸 문자는 취소되지 않고, 남은 사람은 미발송으로 남아 나중에 이어 보낼 수 있어요.`} />
                    <ButtonRow>
                      <SmsButton fill secondary danger label="중단합니다" onPress={() => void stop()} />
                      <SmsButton fill secondary label="그대로 두기" onPress={() => setConfirmStopId(null)} />
                    </ButtonRow>
                  </>
                ) : (
                  <SmsButton
                    label={dispatch.stopping ? '중단하는 중…' : '그 발송 중단하기'}
                    secondary
                    danger
                    disabled={dispatch.stopping}
                    onPress={() => setConfirmStopId(blockedId)}
                  />
                )}
              </View>
            )
          ) : (
            <>
              {/* 브라우저에서는 보낼 수 없으니 비활성 버튼 대신 위의 「Android 앱에서 사용할 수 있습니다」 안내 하나만 남긴다. */}
              {resumeIds.length > 0 && !browserOnly ? (
                <SmsButton
                  label={
                    campaign.status === 'READY'
                      ? `${resumeIds.length}명에게 발송하기`
                      : `미발송 ${resumeIds.length}건 보내기`
                  }
                  disabled={!available || busy || sending}
                  onPress={() => void run('resume')}
                />
              ) : null}
              {retryable && !browserOnly ? (
                <SmsButton
                  label={`실패 ${retryIds.length}건 다시 보내기`}
                  disabled={!available || busy || sending}
                  onPress={() => void run('retry')}
                />
              ) : null}
            </>
          )}
          {/*
            발송 대상 목록 — **이 화면의 본론**이다.

            🔴 **버튼보다 아래에 둔다.** 한 발송은 50명까지라 목록이 위에 서면 발송 버튼과
            iPhone 한 건 확인창이 50줄 밑으로 밀려난다. 확인창은 한 건마다 답해야 하는 것이라
            매번 스크롤을 내리게 되면 25명이 50번의 탭이 아니라 50번의 탭 + 50번의 스크롤이 된다.

            🔴 **줄을 펼쳐야 내용을 읽는다.** 접힌 줄은 이름·번호·상태만 그리고 본문도 첨부도
            **불러오지 않는다**(→ `AttachmentPreview` 의 `auto`). 목록 전체의 첨부를 미리 받으면
            한 장 700KB × 50명이 그대로 요청이 된다.
          */}
          <View style={{ gap: spacing.xs }}>
            <Text accessibilityRole="header" style={s.subtitle}>발송 대상 {rows.length}명</Text>
            {/*
              ⚠️ 아직 아무도 없을 수 있다(막 만든 캠페인을 3초 주기가 따라잡기 전). 빈 자리를
              말없이 두면 「수신자가 사라졌나」로 읽힌다.
            */}
            {rows.length ? (
              <View style={styles.list}>
                {rows.map((item, index) => {
                  const open = openRow === item.id;
                  const outcome = recipientOutcome(item);
                  /*
                    🔴 **러너와 같은 함수로 치환한다**(`personalizeMessage`). 손으로 `@name` 을
                    바꾸면 화면에 보이는 글자와 실제 나가는 글자가 갈라질 수 있고, 그것은
                    **보내고 나서야** 드러난다. 같은 함수를 부르는 한 둘은 어긋날 수 없다
                    (→ `lib/sms-runner.ts` 의 `personalizeMessage(recipient.message, recipient.name)`).
                  */
                  const body = personalizeMessage(item.message, item.name);
                  return (
                    <View key={item.id} style={[styles.row, { backgroundColor: index % 2 ? colors.bg : colors.card }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        // aria-* 로도 적는다. react-native-web 은 RN 의 `expanded` 상태를 옮기지 않는다.
                        aria-expanded={open}
                        accessibilityLabel={`${item.name} ${formatPhone(item.phone)} ${statusLabel[item.status]} 보낼 내용 ${open ? '접기' : '펼치기'}`}
                        onPress={() => setOpenRow(open ? null : item.id)}
                        style={styles.head}
                      >
                        <View style={styles.line}>
                          <Text style={[s.body, styles.name]} numberOfLines={1}>{item.name}</Text>
                          <Text style={[s.meta, styles.fixed]}>{formatPhone(item.phone)}</Text>
                          <Text style={[s.meta, styles.fixed]}>{statusLabel[item.status]}</Text>
                          <Text aria-hidden={true} style={s.meta}>{open ? '▲' : '▼'}</Text>
                        </View>
                      </Pressable>
                      {open ? (
                        <View style={styles.detail}>
                          {/* 본문이 비어 있는 발송(이미지만)도 있다. 빈 자리를 두지 않는다. */}
                          <Text selectable style={s.body}>{body || '이미지 메시지'}</Text>
                          {/* 🔴 `auto` 는 **펼친 줄에서만**이다. 접힌 줄에 달면 목록 전체를 미리 받는다. */}
                          {item.attachments?.map((attachment) => (
                            <AttachmentPreview key={attachment.id} attachment={attachment} auto />
                          ))}
                          {/*
                            ⚠️ 미발송 사유는 빨간 글씨로 적지 않는다 — 고장이 아니라 사람이
                            통과·중단으로 그렇게 정한 결과다(→ `lib/sms-outcome.ts`).
                          */}
                          {item.errorMessage ? <Notice error={outcome === 'FAILED'} message={item.errorMessage} /> : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : loading ? null : (
              <Notice message="이 발송에 담긴 수신자가 없어요." />
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * 수신자 목록. 🔴 **줄 사이에 선을 긋지 않는다.** 줄은 홀짝 바탕색으로 가른다 — 발송 이력과
   * 수신자 표가 이미 같은 두 색으로 줄무늬를 그리고 있어(→ `app/sms/history.tsx` 의 `stripe`),
   * 여기만 선을 쓰면 같은 앱에서 목록마다 모양이 달라진다.
   */
  list: { borderWidth: 1, borderColor: colors.borderCard, borderRadius: radii.card, overflow: 'hidden' },
  row: { paddingHorizontal: spacing.md },
  /**
   * 🔴 **44 아래로 내리지 마라.** 눌러서 펼치는 줄이라 손가락이 닿는 최소 크기다(발송 이력의
   * 수신자 줄과 같은 값이다).
   */
  head: { minHeight: 44, justifyContent: 'center', paddingVertical: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  /** 폭이 모자라면 **이름만** 줄어든다. 번호와 상태가 잘리면 누구인지·어떻게 됐는지가 사라진다. */
  name: { flexShrink: 1 },
  fixed: { flexShrink: 0 },
  detail: { paddingBottom: spacing.md, gap: spacing.sm },
});
