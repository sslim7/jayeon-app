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
  /*
   * 🔴 **추가될 사람은 한 명도 그리지 않는다.** 수백 명이 그대로 들어가는 것이 정상이고, 그
   * 목록을 훑어서 사용자가 할 일은 없다 — 개수만 맞으면 된다. 반대로 **제외된 사람은 전부**
   * 이름과 사유를 보여 준다. 그 사람들만이 사용자가 엑셀을 고쳐서 다시 올려야 할 대상이다.
   *
   * ⚠️ 예전에는 전 행을 `<Text>` 로 그렸다. 행마다 부가 열까지 한 줄씩 붙으므로 264행 × 21열
   * 이면 노드가 5천 개를 넘고, 서버가 행 수를 막지 않게 된 지금은 그 수가 파일 크기만큼 늘어난다.
   */
  const excluded = (preview?.items ?? []).filter((item) => item.status === 'EXCLUDED');
  return <View style={s.card}>
    <Text style={s.subtitle}>엑셀 수신자 등록</Text>
    <Notice message=".xlsx 첫 행에 이름과 전화번호(또는 연락처)가 필요합니다. 그룹은 선택 항목이며, 다른 열도 그대로 저장합니다. 번호는 텍스트 형식으로 입력해 주세요. 파일은 2 MB까지 올릴 수 있습니다." />
    <FilePicker label="수신자 엑셀 파일 선택" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" maxBytes={2 * 1024 * 1024} disabled={busy || confirmPending} onError={setError} onPick={(file) => {
      if (lock.current) return;
      if (!file.fileName.toLowerCase().endsWith('.xlsx')) { setError('.xlsx 파일을 선택해 주세요.'); return; }
      lock.current = true; setBusy(true); setError(''); setPreview(null); setConfirmed(false);
      void recipientApi.importPreview({ name: file.fileName, mimeType: file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dataBase64: file.dataBase64 }).then(setPreview).catch((e) => setError(smsError(e))).finally(() => { lock.current = false; setBusy(false); });
    }} />
    {busy ? <Loading /> : null}{error ? <Notice error message={error} /> : null}
    {preview ? <>
      <Text accessibilityLiveRegion="polite" style={s.subtitle}>{confirmed ? '저장 완료' : '등록 미리보기'} · 추가 {preview.addedCount}명 / 제외 {preview.excludedCount}명</Text>
      {excluded.length ? <>
        <Text style={s.subtitle}>제외 인원</Text>
        {/* 이름이 비어 있으면 엑셀에서 그 줄을 찾을 수 있게 행 번호로 대신한다. */}
        {excluded.map((item) => <Text key={item.row} style={s.body}>{item.name || `${item.row}행`}: {item.reason || '사유 없음'}</Text>)}
      </> : null}
      {!confirmed ? <SmsButton label={busy ? '엑셀 저장 확인 중…' : confirmPending ? '같은 엑셀 저장 요청 다시 확인' : `추가 ${preview.addedCount}명 확정 저장`} disabled={busy || !preview.addedCount} onPress={() => void confirm()} /> : null}
    </> : null}
  </View>;
}
