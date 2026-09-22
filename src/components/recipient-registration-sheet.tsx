import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ExternalSendRegistration } from '@/components/external-send-registration';
import { BottomSheet } from '@/components/bottom-sheet';
import { TextField } from '@/components/form-fields';
import { RecipientImportPanel } from '@/components/recipient-import';
import { Notice, SmsButton, s, smsError } from '@/components/sms-ui';
import { formatPhone, normalizePhone } from '@/lib/phone';
import { recipientApi } from '@/lib/sms-api';
import type { Recipient, RecipientInput } from '@/types/sms';

export function RecipientRegistrationSheet({ recipient, onClose, onSaved }: { recipient?: Recipient; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<RecipientInput>(() => recipient ? { name: recipient.name, phone: formatPhone(recipient.phone), groupId: recipient.groupId, customFields: recipient.customFields ?? [] } : { name: '', phone: '', groupId: '', customFields: [] });
  const [details, setDetails] = useState(recipient);
  const [externalOpen, setExternalOpen] = useState(false);
  const [externalBusy, setExternalBusy] = useState(false);
  const [externalKey, setExternalKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const lock = useRef(false);
  async function save() {
    if (lock.current || externalBusy) return;
    setError(''); setSaved(false);
    try {
      if (!form.name.trim() || !form.groupId.trim()) throw new Error('이름과 그룹을 입력해 주세요.');
      const input = { ...form, name: form.name.trim(), groupId: form.groupId.trim(), phone: normalizePhone(form.phone) };
      lock.current = true; setBusy(true);
      if (recipient) await recipientApi.update(recipient.id, input); else await recipientApi.create(input);
      onSaved();
      if (recipient) onClose(); else { setForm({ name: '', phone: '', groupId: '', customFields: [] }); setSaved(true); }
    } catch (e) { setError(smsError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <BottomSheet title={recipient ? '수신자 수정' : '수신자 등록'} visible onClose={() => { if (!busy && !externalBusy) onClose(); }} headerActions={recipient
    ? <SmsButton label="발송등록" secondary disabled={busy || externalBusy} onPress={() => { setExternalOpen(true); setExternalKey((value) => value + 1); }} />
    // 엑셀 가져오기는 「수신자 한 명 적기」와 나란한 선택지가 아니라 **그 화면 전체를 갈아 끼우는**
    // 전환이다. 본문에 폭 전체로 두면 이름 칸 바로 위에 앉아 입력 흐름을 끊는다. 「발송등록」이
    // 수정 화면에서 쓰는 자리와 같은 곳(닫기 왼쪽)으로 올린다.
    : <SmsButton label="엑셀 가져오기" secondary disabled={busy || externalBusy} onPress={() => setImportOpen(!importOpen)} />}>
    {details ? <View style={s.card}><Text style={s.body}>발송건수: {details.sentCount ?? 0}건</Text><Text style={s.body}>최종발송일시: {details.latestSentAt ? new Date(details.latestSentAt).toLocaleString('ko-KR') : '없음'}</Text></View> : null}
    {recipient && externalOpen ? <><Notice message={`기록 대상: ${recipient.name} · ${formatPhone(recipient.phone)}. 수정 중인 이름·번호는 저장한 뒤 적용됩니다.`} /><ExternalSendRegistration key={externalKey} recipientId={recipient.id} onBusy={setExternalBusy} onSaved={(updated) => { setDetails(updated); onSaved(); }} /></> : null}
    {importOpen ? <RecipientImportPanel onSaved={onSaved} /> : <>
      <TextField label="이름" value={form.name} maxLength={100} editable={!busy && !externalBusy} onChangeText={(name) => setForm({ ...form, name })} />
      <TextField label="전화번호" value={form.phone} keyboardType="phone-pad" editable={!busy && !externalBusy} onChangeText={(phone) => setForm({ ...form, phone })} />
      <TextField label="그룹" value={form.groupId} maxLength={100} editable={!busy && !externalBusy} onChangeText={(groupId) => setForm({ ...form, groupId })} />
      {form.customFields?.map((field, index) => <TextField key={field.name} label={field.name} value={field.value} editable={!busy && !externalBusy} onChangeText={(value) => setForm({ ...form, customFields: form.customFields?.map((item, position) => position === index ? { ...item, value } : item) })} />)}
      <SmsButton label={busy ? '저장 중…' : '저장'} disabled={busy || externalBusy} onPress={() => void save()} />
      {saved ? <Notice message="수신자를 등록했습니다." /> : null}
      {error ? <Notice error message={error} /> : null}
    </>}
  </BottomSheet>;
}
