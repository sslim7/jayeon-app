import { formatPhone } from '@/lib/phone';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { FilePicker } from '@/components/file-picker';
import { Loading, Notice, SmsButton, s, smsError } from '@/components/sms-ui';
import { recipientApi } from '@/lib/sms-api';
import type { RecipientImport } from '@/types/sms';
export function RecipientImportPanel({ onSaved }: { onSaved: () => void }) {
  const [preview, setPreview] = useState<RecipientImport | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function confirm() {
    if (!preview || lock.current) return;
    lock.current = true; setBusy(true); setConfirmPending(true); setError('');
    try { setPreview(await recipientApi.importConfirm(preview.id)); setConfirmed(true); setConfirmPending(false); onSaved(); }
    catch (e) { setError(`${smsError(e)} 같은 가져오기 요청으로 다시 확인할 수 있어요.`); }
    finally { lock.current = false; setBusy(false); }
  }
  return <View style={s.card}>
    <Text style={s.subtitle}>엑셀 수신자 등록</Text>
    <Notice message=".xlsx 첫 행에 이름과 전화번호(또는 연락처)가 필요합니다. 그룹은 선택 항목이며, 다른 열도 그대로 저장합니다. 번호는 텍스트 형식으로 입력해 주세요. 최대 200행, 2 MB입니다." />
    <FilePicker label="수신자 엑셀 파일 선택" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" maxBytes={2 * 1024 * 1024} disabled={busy || confirmPending} onError={setError} onPick={(file) => {
      if (lock.current) return;
      if (!file.fileName.toLowerCase().endsWith('.xlsx')) { setError('.xlsx 파일을 선택해 주세요.'); return; }
      lock.current = true; setBusy(true); setError(''); setPreview(null); setConfirmed(false);
      void recipientApi.importPreview({ name: file.fileName, mimeType: file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dataBase64: file.dataBase64 }).then(setPreview).catch((e) => setError(smsError(e))).finally(() => { lock.current = false; setBusy(false); });
    }} />
    {busy ? <Loading /> : null}{error ? <Notice error message={error} /> : null}
    {preview ? <>
      <Text accessibilityLiveRegion="polite" style={s.subtitle}>{confirmed ? '저장 완료' : '등록 미리보기'} · 추가 {preview.addedCount}명 / 제외 {preview.excludedCount}명</Text>
      {preview.excludedCount ? <Notice message={`제외: ${preview.items.filter((item) => item.status === 'EXCLUDED').map((item) => item.name || `${item.row}행`).join(', ')}`} /> : null}
      {preview.items.map((item) => <View key={item.row} style={{ gap: 4 }}><Text style={s.body}>{item.row}행 · {item.name || '이름 없음'} · {formatPhone(item.phone)} · {item.status === 'ADD' ? '추가' : '제외'}</Text>{item.customFields?.map((field) => <Text key={field.name} style={s.body}>{field.name}: {field.value || '—'}</Text>)}{item.reason ? <Notice message={item.reason} /> : null}</View>)}
      {!confirmed ? <SmsButton label={busy ? '엑셀 저장 확인 중…' : confirmPending ? '같은 엑셀 저장 요청 다시 확인' : `추가 ${preview.addedCount}명 확정 저장`} disabled={busy || !preview.addedCount} onPress={() => void confirm()} /> : null}
    </> : null}
  </View>;
}
