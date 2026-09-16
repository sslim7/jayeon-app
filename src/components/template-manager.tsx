import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { TextField } from '@/components/form-fields';
import { AttachmentEditor, AttachmentPreview } from '@/components/message-attachments';
import { Loading, Notice, SmsButton, SmsPage, s, smsError } from '@/components/sms-ui';
import { colors, fonts, inputFontSize, radii, spacing, text } from '@/constants/theme';
import { templateApi } from '@/lib/sms-api';
import type { Attachment, MessageTemplate } from '@/types/sms';
export function TemplateManager({ onClose }: { onClose?: () => void }) {
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null | undefined>();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await templateApi.list()); setError(''); }
    catch (e) { setError(smsError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  async function save() {
    if (lock.current || uploading) return;
    if (!name.trim() || (!message.trim() && !attachments.length) || Array.from(message).length > 2000) { setError('템플릿 이름과 메시지(2,000자 이하) 또는 첨부를 확인해 주세요.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const input = { name: name.trim(), message, attachmentIds: attachments.map((item) => item.id) };
      if (editing) await templateApi.update(editing, input); else await templateApi.create(input);
      setEditing(undefined); await load();
    } catch (e) { setError(smsError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function remove(id: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await templateApi.remove(id); setDeleting(null); await load(); }
    catch (e) { setError(smsError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const add = <SmsButton label="추가" secondary disabled={busy || uploading || editing !== undefined} onPress={() => { setEditing(null); setName(''); setMessage(''); setAttachments([]); setError(''); setDeleting(null); }} />;
  const content = <View style={{ gap: spacing.lg }}>
    <Notice message="자주 쓰는 문구와 이미지를 저장해 문자 작성할 때 가져오세요." />
    {editing !== undefined ? <View style={s.card}>
      <Text style={s.subtitle}>{editing ? '템플릿 수정' : '새 템플릿'}</Text>
      <TextField label="템플릿 이름" value={name} onChangeText={setName} maxLength={100} editable={!busy} />
      <Text style={s.subtitle}>메시지</Text>
      <TextInput accessibilityLabel="템플릿 메시지" multiline value={message} onChangeText={setMessage} editable={!busy} textAlignVertical="top" style={{ minHeight: 160, borderWidth: 1, borderColor: colors.borderPill, borderRadius: radii.button, padding: spacing.lg, color: colors.ink, backgroundColor: colors.card, ...fonts.body, fontSize: inputFontSize(text.lg) }} />
      <Text style={s.meta}>{Array.from(message).length} / 2,000자</Text>
      <AttachmentEditor value={attachments} onChange={setAttachments} disabled={busy} onBusy={setUploading} />
      <SmsButton label={busy ? '템플릿 저장 중…' : '템플릿 저장'} disabled={busy || uploading} onPress={() => void save()} />
      <SmsButton label="템플릿 편집 취소" secondary disabled={busy || uploading} onPress={() => setEditing(undefined)} />
    </View> : null}
    {error ? <Notice error message={error} /> : null}
    {editing !== undefined ? null : loading ? <Loading /> : !items.length ? <Notice message="등록된 템플릿이 없습니다." /> : items.map((item) => <View key={item.id} style={s.card}>
      <Text style={s.subtitle}>{item.name}</Text><Text selectable style={s.body}>{item.message || '이미지 메시지'}</Text>
      {item.attachments.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} />)}
      <View style={s.row}>
        <SmsButton label="수정" accessibilityLabel={`${item.name} 수정`} secondary disabled={busy || uploading} onPress={() => { setEditing(item.id); setName(item.name); setMessage(item.message); setAttachments(item.attachments); setError(''); }} />
        <SmsButton label="삭제" accessibilityLabel={`${item.name} 삭제`} secondary danger disabled={busy || uploading} onPress={() => setDeleting(item.id)} />
      </View>
      {deleting === item.id ? <><Notice message="템플릿을 삭제할까요? 이미 생성된 캠페인은 유지됩니다." /><SmsButton label="템플릿 삭제 확인" danger secondary disabled={busy} onPress={() => void remove(item.id)} /><SmsButton label="템플릿 삭제 취소" secondary disabled={busy} onPress={() => setDeleting(null)} /></> : null}
    </View>)}
  </View>;
  return onClose ? <BottomSheet title="템플릿" visible headerActions={add} onClose={() => { if (!busy && !uploading) onClose(); }}>{content}</BottomSheet> : <SmsPage title="문자 템플릿" actions={add}>{content}</SmsPage>;
}

