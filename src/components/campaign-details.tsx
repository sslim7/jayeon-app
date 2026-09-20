import { formatPhone } from '@/lib/phone';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
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
import { colors, radii } from '@/constants/theme';
import { smsApi } from '@/lib/sms-api';
import {
  composerConfirm,
  dispatchReady,
  dispatchSubscriptionId,
  lineSelectable,
} from '@/lib/sms-capability';
import { getCapabilities, requestPermissions, type SmsCapabilities } from '@/lib/sms-device';
import { smsDispatch } from '@/lib/sms-dispatch';
import type { SendChoice, SendPrompt } from '@/lib/sms-runner';
import type { Campaign, CampaignRecipient } from '@/types/sms';
function uncertain(r: CampaignRecipient) {
  return (
    r.status === 'UNKNOWN' ||
    r.status === 'SENDING' ||
    (r.status === 'FAILED' && ['OUTCOME_UNKNOWN', 'PARTIAL_SENT'].includes(r.errorCode ?? ''))
  );
}
export function CampaignDetails({ id }: { id: string }) {
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
  const settle = useCallback((choice: SendChoice) => {
    const pending = answer.current;
    if (!pending) return;
    answer.current = null;
    setPrompt(null);
    pending(choice);
  }, []);
  // 화면을 떠나면 남은 한 건은 「중단」으로 닫는다. 결과 없이 매달린 대상을 남기지 않는다.
  useEffect(() => () => settle('stop'), [settle]);
  const dispatch = useSyncExternalStore(
    smsDispatch.subscribe,
    smsDispatch.getSnapshot,
    smsDispatch.getSnapshot,
  );
  const running = dispatch.running;
  const mine = dispatch.campaignId === id;
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
  async function run(retry = false) {
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
            answer.current = resolve;
            setPrompt(target);
          }) }
          : {}),
        ...(retry ? { retryRecipientIds: retryIds } : {}),
      });
      await load();
    } catch (e) {
      setError(smsError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  // 발송 중단만 한다. 캠페인 취소(CANCELLED) 경로는 이 화면에서 뺐다 — 발송이 이미 끝났으면 멈출 것이 없다.
  async function stop() {
    if (!(running && mine)) return;
    try {
      // 확인창이 떠 있으면 루프가 답을 기다리는 중이다. 먼저 닫아야 중단이 실제로 진행된다.
      settle('stop');
      await smsDispatch.stop();
      await load();
    } catch (e) {
      setError(smsError(e));
    }
  }
  const sent = rows.filter((r) => r.status === 'SENT').length;
  const failed = rows.filter((r) => r.status === 'FAILED').length;
  const ready = rows.filter((r) => r.status === 'READY').length;
  const unknown = rows.filter(uncertain).length;
  const current = rows.find((r) => r.id === dispatch.currentRecipientId);
  const attachmentSupported = !campaign?.attachments?.length || !!capability?.mmsSupported;
  const available = dispatchReady(capability, sim, attachmentSupported);
  // 한 건마다 시스템 화면을 거치는 단말인가(iPhone). 회선 선택 UI 유무도 여기서 갈린다.
  const perMessage = composerConfirm(capability);
  const chooseLine = lineSelectable(capability);
  // 데스크톱 브라우저처럼 발송 자체가 불가능한 곳. null(확인 중)과 구별한다 — 확인 중에는 버튼을 비활성으로 둔다.
  const browserOnly = capability?.supported === false;
  const sending = rows.some((r) => r.status === 'SENDING');
  // 발송 중 지금 보내는 1건(SENDING)은 곧 확정되니 제외한다. 그 밖의 미확정은 자동 동기화로 안 풀릴 수 있어 직접 다시 확인할 길을 둔다.
  const unresolved = rows.some((r) => uncertain(r) && !(running && r.status === 'SENDING'));
  // 수신자 목록을 없애며 개별 선택도 없앴다. 확실히 실패한 행은 전부 다시 보낸다 — 결과 미확정 행은 중복 발송 위험이 있어 빼는 규칙은 그대로다.
  const retryIds = rows.filter((r) => r.status === 'FAILED' && !uncertain(r)).map((r) => r.id);
  const retryable = retryIds.length > 0;
  // 수신자별 카드가 없으니 오류 사유는 대표 1건만 요약한다. 같은 사유가 반복되는 경우가 대부분이다.
  const errorMessages = [...new Set(rows.filter((r) => r.status === 'FAILED' || uncertain(r)).map((r) => r.errorMessage).filter((m): m is string => !!m))];
  // 발송이 끝나면 SIM·권한 설정이 더는 할 일이 아니다. 남아 있으면 「끝났는데 또 뭘 골라야 하나」로 읽혀 헷갈렸다.
  const needsLine = running || ready > 0 || retryable;
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
            <Text selectable style={s.body}>
              {campaign.message}
            </Text>
            {campaign.attachments?.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} />)}
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
            <Text selectable style={s.body}>
              성공 {sent} · 실패 {failed} · 대기 {ready}
            </Text>
            {errorMessages.length ? (
              <Notice
                error
                message={errorMessages.length > 1 ? `${errorMessages[0]} 외 사유 ${errorMessages.length - 1}가지` : errorMessages[0]}
              />
            ) : null}
            {unknown ? (
              <Notice
                message={`결과 확인 필요 ${unknown}건 · 실제 발송 여부를 확정할 수 없어 자동 재발송하지 않습니다.`}
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
              </>
            ) : (
              <Notice message="다른 문자를 발송 중입니다. 완료 또는 중단 후 발송할 수 있어요." />
            )
          ) : (
            <>
              {/* 브라우저에서는 보낼 수 없으니 비활성 버튼 대신 위의 「Android 앱에서 사용할 수 있습니다」 안내 하나만 남긴다. */}
              {ready > 0 && !browserOnly ? (
                <SmsButton
                  label={
                    campaign.status === 'READY'
                      ? `${ready}명에게 발송하기`
                      : `미발송 ${ready}건 계속 보내기`
                  }
                  disabled={!available || busy || sending}
                  onPress={() => void run()}
                />
              ) : null}
              {retryable && !browserOnly ? (
                <SmsButton
                  label={`실패 ${retryIds.length}건 다시 보내기`}
                  disabled={!available || busy || sending}
                  onPress={() => void run(true)}
                />
              ) : null}
            </>
          )}
        </>
      ) : null}
    </View>
  );
}
