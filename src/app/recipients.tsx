import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { TextField } from '@/components/form-fields';
import { Loading, Notice, SmsButton, SmsPage, s, smsError } from '@/components/sms-ui';
import { RecipientImportPanel } from '@/components/recipient-import';
import { RecipientHistorySheet } from '@/components/recipient-history';
import { RecipientTable } from '@/components/recipient-table';
import { formatPhone, normalizePhone } from '@/lib/phone';
import { recipientApi } from '@/lib/sms-api';
import type { Recipient, RecipientInput } from '@/types/sms';

const empty: RecipientInput = { name: '', phone: '', groupId: '', customFields: [] };
export default function RecipientsScreen() {
  const { register } = useLocalSearchParams<{ register?: string }>();
  const [history, setHistory] = useState<Recipient | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [items, setItems] = useState<Recipient[]>([]);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [form, setForm] = useState<RecipientInput>(empty);
  const [editing, setEditing] = useState<string | null | undefined>(register === '1' ? null : undefined);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await recipientApi.list();
      setItems(rows);
      setSelected((ids) => ids.filter((id) => rows.some((r) => r.id === id)));
      setError('');
    } catch (e) { setError(smsError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  async function save() {
    if (lock.current) return;
    setError('');
    let input: RecipientInput;
    try {
      if (!form.name.trim() || !form.groupId.trim()) throw new Error('이름과 그룹을 입력해 주세요.');
      input = { name: form.name.trim(), phone: normalizePhone(form.phone), groupId: form.groupId.trim(), customFields: form.customFields ?? [] };
    } catch (e) { setError(smsError(e)); return; }
    lock.current = true; setBusy(true);
    try {
      if (editing) await recipientApi.update(editing, input); else await recipientApi.create(input);
      setEditing(undefined); setForm(empty); await load();
    } catch (e) { setError(smsError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function remove(id: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await recipientApi.remove(id); setDeleting(null); await load(); }
    catch (e) { setError(smsError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const groups = [...new Set(items.map((r) => r.groupId).filter(Boolean))];
  const visible = items.filter((r) => (!group || r.groupId === group) && r.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <SmsPage wide title="수신자 관리">
      <TextField label="수신자 이름" value={query} onChangeText={setQuery} />
      <Text style={s.subtitle}>그룹 선택</Text>
      <View style={s.row}>
        <SmsButton label="모든 그룹" secondary={!!group} onPress={() => setGroup('')} />
        {groups.map((g) => <SmsButton key={g} label={g} secondary={group !== g} onPress={() => setGroup(g)} />)}
      </View>
      <Notice message="전체 수신자를 조회합니다. 한 번에 50명까지 선택해 보낼 수 있어요." />
      <View style={s.row}>
        <SmsButton label="수신자 등록" secondary disabled={busy} onPress={() => { setEditing(null); setForm(empty); setError(''); }} />
        <SmsButton label="엑셀 등록" secondary disabled={busy} onPress={() => setImportOpen(!importOpen)} />
      </View>
      {importOpen ? <RecipientImportPanel onSaved={() => void load()} /> : null}
      {history ? <RecipientHistorySheet key={history.id} recipient={history} onClose={() => setHistory(null)} /> : null}
      {editing !== undefined ? <View style={s.card}>
        <Text style={s.subtitle}>{editing ? '수신자 수정' : '새 수신자'}</Text>
        <TextField label="이름" value={form.name} maxLength={100} editable={!busy} onChangeText={(name) => setForm({ ...form, name })} />
        <TextField label="전화번호" keyboardType="phone-pad" value={form.phone} editable={!busy} onChangeText={(phone) => setForm({ ...form, phone })} />
        <TextField label="그룹" value={form.groupId} maxLength={100} editable={!busy} onChangeText={(groupId) => setForm({ ...form, groupId })} />
        {form.customFields?.map((field, index) => <TextField key={field.name} label={field.name} value={field.value} maxLength={1000} editable={!busy} onChangeText={(value) => setForm({ ...form, customFields: form.customFields?.map((item, position) => position === index ? { ...item, value } : item) })} />)}
        <SmsButton label={busy ? '저장 중…' : '저장'} disabled={busy} onPress={() => void save()} />
        <SmsButton label="편집 취소" secondary disabled={busy} onPress={() => setEditing(undefined)} />
      </View> : null}
      {error ? <Notice error message={error} /> : null}
      <Text style={s.subtitle}>발송 최대 50명</Text>
      {selected.length > 50 ? <Notice error message="한 번에 50명까지 보낼 수 있어요. 선택 수를 줄여 주세요." /> : null}
      {selected.length ? <View style={s.row}>
        <SmsButton label={`${selected.length}명에게 문자 작성`} disabled={selected.length > 50} onPress={() => router.push({ pathname: '/sms/new', params: { ids: selected.join(',') } })} />
        <SmsButton label="선택 해제" secondary onPress={() => setSelected([])} />
      </View> : null}
      {deleting ? <View style={s.card}>
        <Notice message={`${items.find((item) => item.id === deleting)?.name ?? '이 수신자'}을(를) 삭제할까요? 과거 발송 이력은 유지됩니다.`} />
        <SmsButton label="삭제 확인" secondary danger disabled={busy} onPress={() => void remove(deleting)} />
        <SmsButton label="삭제 취소" secondary disabled={busy} onPress={() => setDeleting(null)} />
      </View> : null}
      {loading ? <Loading /> : null}
      <RecipientTable items={visible} selectedIds={selected} onSelectionChange={setSelected} onHistory={setHistory} disabled={busy || loading} onEdit={(item) => { setEditing(item.id); setForm({ name: item.name, phone: formatPhone(item.phone), groupId: item.groupId, customFields: item.customFields ?? [] }); }} onRemove={(item) => setDeleting(item.id)} />
      <SmsButton label="목록 새로고침" secondary disabled={loading || busy} onPress={() => void load()} />
    </SmsPage>
  );
}
