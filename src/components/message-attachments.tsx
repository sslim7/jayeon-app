import { useEffect, useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { FilePicker } from '@/components/file-picker';
import { Loading, Notice, SmsButton, s, smsError } from '@/components/sms-ui';
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
    <Text style={s.subtitle}>첨부 이미지 {value.length} / 3</Text>
    <Notice message="JPG·PNG, 파일당 300 KB · 합계 600 KB까지. 이미지를 첨부하면 MMS로 발송합니다." />
    {value.map((item) => <View key={item.id} style={{ gap: 8 }}>
      <AttachmentPreview attachment={item} />
      <SmsButton label={`${item.name} 첨부 삭제`} secondary danger disabled={disabled || busy} onPress={() => onChange(value.filter((file) => file.id !== item.id))} />
    </View>)}
    <FilePicker label="첨부 이미지 추가" accept="image/jpeg,image/png,.jpg,.jpeg,.png" maxBytes={300 * 1024} disabled={disabled || busy || value.length >= 3} onError={setError} onPick={(file) => {
      if (lock.current) return;
      if (!['image/jpeg', 'image/png'].includes(file.mimeType)) { setError('JPG 또는 PNG 이미지를 선택해 주세요.'); return; }
      if (value.length >= 3 || value.reduce((sum, item) => sum + item.size, file.size) > 600 * 1024) { setError('첨부는 최대 3개, 합계 600 KB까지 가능해요.'); return; }
      lock.current = true; setBusy(true); onBusy?.(true); setError('');
      void attachmentApi.upload({ name: file.fileName, mimeType: file.mimeType, dataBase64: file.dataBase64 }).then((item) => onChange([...value, item])).catch((e) => setError(smsError(e))).finally(() => { lock.current = false; setBusy(false); onBusy?.(false); });
    }} />
    {busy ? <Loading /> : null}{error ? <Notice error message={error} /> : null}
  </View>;
}
