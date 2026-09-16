import { formatPhone } from '@/lib/phone';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import {
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
import { getCapabilities, requestPermissions, type SmsCapabilities } from '@/lib/sms-device';
import { smsDispatch } from '@/lib/sms-dispatch';
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
  const [retryIds, setRetryIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
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
      setRetryIds((ids) =>
        ids.filter((rid) =>
          recipients.some((r) => r.id === rid && r.status === 'FAILED' && !uncertain(r)),
        ),
      );
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
    if (lock.current || running || sim === null) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await smsDispatch.run(id, {
        subscriptionId: sim,
        ...(retry ? { retryRecipientIds: [...retryIds] } : {}),
      });
      await load();
    } catch (e) {
      setError(smsError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function stop() {
    try {
      if (running && mine) await smsDispatch.stop();
      else await smsApi.setStatus(id, 'CANCELLED');
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
  const available = !!capability?.supported && capability.permissionGranted && sim !== null && attachmentSupported;
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
            {unknown ? (
              <Notice
                message={`결과 확인 필요 ${unknown}건 · 실제 발송 여부를 확정할 수 없어 자동 재발송하지 않습니다.`}
              />
            ) : null}
            {running && mine && current ? (
              <Text style={s.body}>
                현재 발송: {current.name} · {formatPhone(current.phone)}
              </Text>
            ) : null}
          </View>
          <Notice message="성공은 Android 발송 요청 성공이며 상대방의 수신·읽음 확인이 아닙니다." />
          {capability === null ? (
            <Notice message="Android SMS 기능을 확인하고 있어요." />
          ) : !capability.supported ? (
            <Notice message="이 기능은 Android 앱에서 사용할 수 있습니다. 수신자 관리와 이력 조회는 여기서도 가능합니다." />
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
          {!attachmentSupported ? <Notice error message="첨부 발송을 지원하는 최신 Android 앱을 설치해 주세요." /> : null}
          {running ? (
            mine ? (
              <>
                <SmsButton
                  label={dispatch.stopping ? '현재 1건 저장 후 중지 중…' : '발송 중지'}
                  secondary
                  danger
                  disabled={dispatch.stopping}
                  onPress={() => void stop()}
                />
                <Notice message="이미 Android에 전달한 문자는 취소할 수 없습니다. 현재 결과 저장 후 멈춥니다." />
              </>
            ) : (
              <Notice message="다른 캠페인을 발송 중입니다. 완료 또는 중지 후 발송할 수 있어요." />
            )
          ) : (
            <>
              {ready > 0 ? (
                <SmsButton
                  label={
                    campaign.status === 'READY'
                      ? `${ready}명에게 전송`
                      : `미발송 ${ready}건 계속 보내기`
                  }
                  disabled={!available || busy || rows.some((r) => r.status === 'SENDING')}
                  onPress={() => void run()}
                />
              ) : null}
              {retryIds.length > 0 ? (
                <SmsButton
                  label={`선택한 실패 ${retryIds.length}건 다시 보내기`}
                  disabled={!available || busy || rows.some((r) => r.status === 'SENDING')}
                  onPress={() => void run(true)}
                />
              ) : null}
              {ready > 0 && campaign.status !== 'CANCELLED' ? (
                <SmsButton
                  label="캠페인 중단"
                  secondary
                  danger
                  disabled={busy}
                  onPress={() => void stop()}
                />
              ) : null}
            </>
          )}
          <Text style={s.subtitle}>발송 당시 수신자</Text>
          {rows.map((r) => (
            <View key={r.id} style={s.card}>
              <Text selectable style={s.subtitle}>
                {r.name}
              </Text>
              <Text selectable style={s.body}>
                {formatPhone(r.phone)}
              </Text>
              <Text style={s.meta}>{uncertain(r) ? '결과 확인 필요' : statusLabel[r.status]}{r.transport ? ` · ${r.transport}` : ''}</Text>
              {r.sentAt || r.failedAt ? (
                <Text style={s.meta}>
                  {new Date((r.sentAt || r.failedAt)!).toLocaleString('ko-KR')}
                </Text>
              ) : null}
              {r.errorMessage ? <Notice error message={r.errorMessage} /> : null}
              {r.status === 'FAILED' && !uncertain(r) ? (
                <Choice
                  label={`${r.name} 실패 재발송 선택`}
                  selected={retryIds.includes(r.id)}
                  disabled={busy || running}
                  onPress={() =>
                    setRetryIds((ids) =>
                      ids.includes(r.id) ? ids.filter((v) => v !== r.id) : [...ids, r.id],
                    )
                  }
                />
              ) : null}
            </View>
          ))}
        </>
      ) : null}
      <SmsButton
        label="결과 동기화"
        secondary
        disabled={running || busy}
        onPress={() => {
          void smsDispatch
            .sync(id)
            .then(load)
            .catch((e) => setError(smsError(e)));
        }}
      />
      <SmsButton label="진행 상태 새로고침" secondary onPress={() => void load()} />
    </View>
  );
}
