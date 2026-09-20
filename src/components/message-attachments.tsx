import { useEffect, useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { FilePicker } from '@/components/file-picker';
import { Loading, Notice, SmsButton, s, smsError } from '@/components/sms-ui';
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_HINT, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT,
  ATTACHMENT_QUOTA_MESSAGE, ATTACHMENT_TYPE_MESSAGE, isAllowedImage, quotaExceeded,
} from '@/lib/attachment-file';
import { attachmentApi } from '@/lib/sms-api';
import type { Attachment } from '@/types/sms';

export function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function show() {
    setLoading(true);
    try {
      const content = await attachmentApi.content(attachment.id);
      setUri(`data:${content.mimeType};base64,${content.dataBase64}`);
      setError('');
    } catch (e) { setError(smsError(e)); }
    finally { setLoading(false); }
  }
  return <View style={{ gap: 8 }}>
    <Text style={s.body}>{attachment.name} · {Math.ceil(attachment.size / 1024)} KB</Text>
    {uri ? <Image accessibilityLabel={attachment.name} source={{ uri }} resizeMode="contain" style={{ width: '100%', height: 200 }} /> : <SmsButton label={`${attachment.name} 미리보기`} secondary disabled={loading} onPress={() => void show()} />}
    {error ? <Notice error message={error} /> : null}
  </View>;
}
export function AttachmentEditor({ value, onChange, disabled, onBusy }: { value: Attachment[]; onChange: (items: Attachment[]) => void; disabled?: boolean; onBusy?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => () => onBusy?.(false), [onBusy]);
  return <View style={s.card}>
    <Text style={s.subtitle}>첨부 이미지 {value.length} / {ATTACHMENT_MAX_COUNT}</Text>
    {/* 한도와 문구는 웹·네이티브 선택기가 쓰는 것과 같은 곳에서 온다(→ `lib/attachment-file.ts`). */}
    <Notice message={ATTACHMENT_HINT} />
    {value.map((item) => <View key={item.id} style={{ gap: 8 }}>
      <AttachmentPreview attachment={item} />
      <SmsButton label={`${item.name} 첨부 삭제`} secondary danger disabled={disabled || busy} onPress={() => onChange(value.filter((file) => file.id !== item.id))} />
    </View>)}
    <FilePicker label="첨부 이미지 추가" accept={ATTACHMENT_ACCEPT} maxBytes={ATTACHMENT_MAX_BYTES} disabled={disabled || busy || value.length >= ATTACHMENT_MAX_COUNT} onError={setError} onPick={(file) => {
      if (lock.current) return;
      if (!isAllowedImage(file.mimeType)) { setError(ATTACHMENT_TYPE_MESSAGE); return; }
      if (quotaExceeded(value, file.size)) { setError(ATTACHMENT_QUOTA_MESSAGE); return; }
      lock.current = true; setBusy(true); onBusy?.(true); setError('');
      void attachmentApi.upload({ name: file.fileName, mimeType: file.mimeType, dataBase64: file.dataBase64 }).then((item) => onChange([...value, item])).catch((e) => setError(smsError(e))).finally(() => { lock.current = false; setBusy(false); onBusy?.(false); });
    }} />
    {busy ? <Loading /> : null}{error ? <Notice error message={error} /> : null}
  </View>;
}
