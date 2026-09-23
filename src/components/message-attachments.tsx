import { useEffect, useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { FilePicker } from '@/components/file-picker';
import { Loading, Notice, SmsButton, s, smsError } from '@/components/sms-ui';
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_HINT, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT,
  ATTACHMENT_PICK_MAX_BYTES, ATTACHMENT_QUOTA_MESSAGE, ATTACHMENT_SHRINKING_MESSAGE,
  ATTACHMENT_TOTAL_MAX_BYTES, ATTACHMENT_TYPE_MESSAGE, attachmentReason, isAllowedImage, quotaExceeded,
} from '@/lib/attachment-file';
import { shrinkImage } from '@/lib/image-shrink';
import { needsShrink, shrinkTargetBytes } from '@/lib/image-shrink-plan';
import { attachmentApi } from '@/lib/sms-api';
import type { PickedFile } from '@/components/file-picker-types';
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
/**
 * 첨부 편집기.
 *
 * # 왜 선택기에 실제 한도를 걸지 않는가
 *
 * `FilePicker` 에 `ATTACHMENT_MAX_BYTES` 를 걸어 두면 폰으로 찍은 2~5MB 사진이 **파일을
 * 넘겨받기도 전에** 거절된다. 사용자에게 남는 길은 직접 줄여 오는 것뿐인데, 그 방법을 아는
 * 사람은 많지 않다. 그래서 선택기는 `ATTACHMENT_PICK_MAX_BYTES`(20MB) 로 일단 받고,
 * 진짜 한도는 **줄인 뒤에** 본다(→ `lib/image-shrink-plan.ts`).
 */
export function AttachmentEditor({ value, onChange, disabled, onBusy }: { value: Attachment[]; onChange: (items: Attachment[]) => void; disabled?: boolean; onBusy?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  /**
   * 🔴 줄이는 동안 화면이 멈춘 것처럼 보이면 안 된다. 5MB 사진 한 장에 1초 이상 걸리고,
   * 그동안 아무 변화가 없으면 사용자는 버튼을 다시 누르거나 화면을 떠난다.
   */
  const [shrinking, setShrinking] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => () => onBusy?.(false), [onBusy]);

  async function add(file: PickedFile) {
    const target = shrinkTargetBytes({
      perFile: ATTACHMENT_MAX_BYTES,
      totalLimit: ATTACHMENT_TOTAL_MAX_BYTES,
      usedBytes: value.reduce((sum, item) => sum + item.size, 0),
      // ⚠️ `deviceBudget` 은 지금 넘기지 않는다(= 모른다). 통신망으로 실제로 나갈 수 있는
      //    크기는 단말이 SIM 에서 읽는 `MMS_CONFIG_MAX_MESSAGE_SIZE` 이고, 그것을 여기로
      //    넘기면 통신사 거절을 **첨부 시점에** 막을 수 있다. `modules/nature-sms` 의
      //    capabilities 에 `maxMessageSize` 를 노출하는 작업이 남아 있다 — 네이티브를
      //    건드리면 APK 를 다시 깔아야 해서 이번 범위가 아니다. 모르는 값을 지어내면
      //    멀쩡한 사진을 필요 이상으로 뭉갠다.
    });
    // 장수가 찼거나 합계에 남은 몫이 없다 — 줄여도 붙일 곳이 없으므로 인코딩을 시작하지 않는다.
    if (target === null || value.length >= ATTACHMENT_MAX_COUNT) { setError(ATTACHMENT_QUOTA_MESSAGE); return; }
    lock.current = true; setBusy(true); onBusy?.(true); setError('');
    try {
      let ready = file;
      if (needsShrink(file.size, target)) {
        setShrinking(true);
        try {
          ready = await shrinkImage(file, target);
        } catch (e) {
          // 🔴 축소 실패와 업로드 실패는 **다른 말을 해야 한다.** 줄여도 안 된 것이면
          //    사용자가 할 일은 「더 작은 이미지 고르기」 하나뿐이고, 서버 오류라면 그 말은
          //    거짓말이 된다. 그래서 여기서만 공용 규칙의 문구를 쓴다(→ `attachmentReason`).
          setError(attachmentReason(e, ATTACHMENT_PICK_MAX_BYTES));
          return;
        } finally {
          setShrinking(false);
        }
      }
      // 줄인 결과로 합계·장수를 다시 본다. 목표를 지켰다면 통과하지만, 한 번 더 보지 않으면
      // 계획과 실제가 갈라졌을 때 서버가 대신 거절하게 된다.
      if (quotaExceeded(value, ready.size)) { setError(ATTACHMENT_QUOTA_MESSAGE); return; }
      const item = await attachmentApi.upload({ name: ready.fileName, mimeType: ready.mimeType, dataBase64: ready.dataBase64 });
      onChange([...value, item]);
    } catch (e) {
      setError(smsError(e));
    } finally {
      lock.current = false; setBusy(false); onBusy?.(false);
    }
  }

  return <View style={s.card}>
    <Text style={s.subtitle}>첨부 이미지 {value.length} / {ATTACHMENT_MAX_COUNT}</Text>
    {/* 한도와 문구는 웹·네이티브 선택기가 쓰는 것과 같은 곳에서 온다(→ `lib/attachment-file.ts`). */}
    <Notice message={ATTACHMENT_HINT} />
    {value.map((item) => <View key={item.id} style={{ gap: 8 }}>
      <AttachmentPreview attachment={item} />
      <SmsButton label={`${item.name} 첨부 삭제`} secondary danger disabled={disabled || busy} onPress={() => onChange(value.filter((file) => file.id !== item.id))} />
    </View>)}
    <FilePicker label="첨부 이미지 추가" accept={ATTACHMENT_ACCEPT} maxBytes={ATTACHMENT_PICK_MAX_BYTES} disabled={disabled || busy || value.length >= ATTACHMENT_MAX_COUNT} onError={setError} onPick={(file) => {
      if (lock.current) return;
      if (!isAllowedImage(file.mimeType)) { setError(ATTACHMENT_TYPE_MESSAGE); return; }
      void add(file);
    }} />
    {busy ? <Loading /> : null}{shrinking ? <Notice message={ATTACHMENT_SHRINKING_MESSAGE} /> : null}{error ? <Notice error message={error} /> : null}
  </View>;
}
