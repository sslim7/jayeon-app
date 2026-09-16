import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { TextField } from '@/components/form-fields';
import { Loading, Notice, SmsButton, s, smsError } from '@/components/sms-ui';
import { ApiError } from '@/lib/api';
import { getSessionVersion } from '@/lib/auth-tokens';
import { externalSendLocalTime, parseExternalSendTime } from '@/lib/external-send-date';
import { newSmsRequestId } from '@/lib/sms-dispatch';
import { recipientApi } from '@/lib/sms-api';
import { useUserStore } from '@/store/user-store';
import type { Recipient } from '@/types/sms';

type PendingSend = { requestId: string; sentAt: string };
// Nature 전환에서도 미확정 요청·발송 결과와 로그인 복구를 위해 저장 식별자는 유지한다.
const storageKey = (userId: string, recipientId: string) => `jayeon.external.${[userId, recipientId].map((value) => Array.from(value).map((char) => char.codePointAt(0)!.toString(16)).join('_')).join('.')}`;
async function readPending(key: string): Promise<PendingSend | null> {
  const raw = Platform.OS === 'web' ? localStorage.getItem(key) : await SecureStore.getItemAsync(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as PendingSend;
  if (!parsed || typeof parsed.requestId !== 'string' || typeof parsed.sentAt !== 'string' || !Number.isFinite(Date.parse(parsed.sentAt))) throw new Error('저장 중인 발송 기록을 확인할 수 없어요.');
  return parsed;
}
async function persistPending(key: string, value: PendingSend | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key);
  } else if (value) await SecureStore.setItemAsync(key, JSON.stringify(value));
  else await SecureStore.deleteItemAsync(key);
}

/** 실제 문자를 보내지 않고 이미 외부에서 보낸 한 건의 일시만 등록한다. */
export function ExternalSendRegistration({ recipientId, onSaved, onBusy }: { recipientId: string; onSaved: (recipient: Recipient) => void; onBusy: (busy: boolean) => void }) {
  const userId = useUserStore((state) => state.profile?.userId);
  const [sentAt, setSentAt] = useState(() => externalSendLocalTime());
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void readPending(storageKey(userId, recipientId)).then((value) => {
      if (!active) return;
      setPending(value);
      if (value) setSentAt(externalSendLocalTime(new Date(value.sentAt)));
      setLoaded(true);
    }).catch((cause) => { if (active) setError(smsError(cause)); });
    return () => { active = false; };
  }, [userId, recipientId]);
  async function submit() {
    if (lock.current || !loaded || !userId) return;
    let input: PendingSend;
    try { input = pending ?? { requestId: newSmsRequestId(), sentAt: parseExternalSendTime(sentAt) }; }
    catch (cause) { setError(smsError(cause)); return; }
    const key = storageKey(userId, recipientId);
    const version = getSessionVersion();
    let accepted = false;
    lock.current = true; setBusy(true); onBusy(true); setError(''); setSaved(false); setPending(input);
    try {
      await persistPending(key, input);
      if (version !== getSessionVersion()) throw new Error('계정이 변경되어 발송 기록 저장을 멈췄어요.');
      await recipientApi.registerExternal(recipientId, input);
      accepted = true;
      if (version !== getSessionVersion()) throw new Error('계정이 변경되어 발송 기록 저장을 멈췄어요.');
      // 멱등 응답은 최초 등록 당시 값일 수 있으므로 현재 누적 건수와 마지막 일시를 다시 읽는다.
      const recipient = (await recipientApi.list({ includeSent: true })).find((item) => item.id === recipientId);
      if (version !== getSessionVersion()) throw new Error('계정이 변경되어 발송 기록 저장을 멈췄어요.');
      if (!recipient) throw new Error('등록한 기록의 최신 수신자 정보를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.');
      await persistPending(key, null);
      setPending(null); setSaved(true); onSaved(recipient);
    } catch (cause) {
      if (!accepted && cause instanceof ApiError && [400, 404].includes(cause.status)) {
        try { await persistPending(key, null); setPending(null); }
        catch { setError('요청 정리를 완료하지 못했어요. 같은 요청으로 다시 확인해 주세요.'); return; }
      }
      setError(smsError(cause));
    } finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  return <View style={s.card}>
    <Text style={s.subtitle}>외부 발송 기록 등록</Text>
    <Notice message="외부에서 이미 보낸 문자 1건을 기록합니다. 실제 문자는 발송하지 않아요." />
    <TextField label="발송일시" value={sentAt} onChangeText={setSentAt} placeholder="YYYY-MM-DD HH:mm" editable={loaded && !busy && !pending} />
    <Notice message="현재 기기의 현지 시간으로 입력해 주세요. 미래 일시는 등록할 수 없습니다." />
    {!loaded ? <Loading /> : null}
    <SmsButton label={busy ? '발송 기록 저장 중…' : pending ? '같은 발송 기록 요청 다시 확인' : '발송 기록 저장'} disabled={!loaded || busy || saved} onPress={() => void submit()} />
    {pending ? <Notice message="결과가 확인될 때까지 날짜를 고정합니다. 다시 확인해도 같은 기록이 중복 등록되지 않습니다." /> : null}
    {saved ? <Notice message="외부 발송 기록 1건을 등록했습니다." /> : null}
    {error ? <Notice error message={error} /> : null}
  </View>;
}
