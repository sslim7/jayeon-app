import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * 첨부 한 장.
 *
 * # 왜 「누르면 받기」와 「열리자마자 받기」가 따로 있나
 *
 * 첨부는 한 장이 최대 700KB 다. 수신자 50명이 서 있는 목록에서 전부 미리 받으면 **보지도
 * 않을 수십 MB 를 받기 시작한다** — 폰 회선에서는 그것만으로 화면이 멈춘 것처럼 보이고,
 * 발송 중이라면 네트워크를 놓고 러너와 다투게 된다.
 *
 * 그래서 기본은 지금처럼 **눌러야 받는다**(첨부 편집기가 그 자리다). `auto` 를 켜는 쪽은
 * **이미 펼쳐진 한 줄에서만**이다 — 사람이 그 줄을 연 것 자체가 「이 한 장을 보겠다」는
 * 뜻이므로, 거기서 한 번 더 누르게 할 이유가 없다.
 *
 * ⚠️ `auto` 를 「이 화면은 첨부를 보여 준다」 정도의 뜻으로 펼쳐지지 않은 줄에까지 달지 마라.
 * 줄이 있는 만큼 요청이 나간다.
 */
export function AttachmentPreview({ attachment, auto }: { attachment: Attachment; auto?: boolean }) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /**
   * 이 카드가 아직 화면에 있는가.
   *
   * 🔴 펼친 줄을 곧바로 접으면 이 컴포넌트는 사라지는데 **받던 요청은 남는다.** 사라진 자리에
   * 결과를 쓰면 경고가 뜨고, 700KB 짜리 base64 문자열이 그대로 붙잡혀 있게 된다.
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const show = useCallback(async () => {
    setLoading(true);
    try {
      const content = await attachmentApi.content(attachment.id);
      if (!alive.current) return;
      setUri(`data:${content.mimeType};base64,${content.dataBase64}`);
      setError('');
    } catch (e) { if (alive.current) setError(smsError(e)); }
    finally { if (alive.current) setLoading(false); }
  }, [attachment.id]);
  /**
   * 🔴 **자동으로 받는 것은 한 번뿐이다.** 실패해도 다시 받지 않는다 — 발송 상세는 3초마다
   * 목록을 다시 읽어 그리므로(→ `components/campaign-details.tsx`), 실패할 때마다 다시 받게
   * 두면 못 받는 첨부 하나가 **3초에 한 번씩 서버를 두드린다.**
   * ⚠️ 버튼 경로(`auto` 없음)는 예전 그대로 몇 번이든 다시 누를 수 있다.
   */
  const fetched = useRef(false);
  useEffect(() => {
    if (!auto || fetched.current) return;
    fetched.current = true;
    void show();
  }, [auto, show]);
  return <View style={{ gap: 8 }}>
    <Text style={s.body}>{attachment.name} · {Math.ceil(attachment.size / 1024)} KB</Text>
    {/*
      ⚠️ 못 받았을 때는 **이미지 자리를 비워 둔다.** 사유는 아래 `Notice` 가 적는다. `auto` 인
      곳에 미리보기 버튼을 대신 세우지 않는 이유는, 거기서만 버튼이 튀어나오면 「무엇이
      고장났나」로 읽히기 때문이다.
    */}
    {uri
      ? <Image accessibilityLabel={attachment.name} source={{ uri }} resizeMode="contain" style={{ width: '100%', height: 200 }} />
      : auto
        ? (loading ? <Loading /> : null)
        : <SmsButton label={`${attachment.name} 미리보기`} secondary disabled={loading} onPress={() => void show()} />}
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
      // ⚠️ **껍데기 다리의 폭도 여기서 깎지 않는다.** 그 폭(→ `lib/image-shrink-plan.ts` 의
      //    `bridgeAttachmentBudget`)으로 붙이는 시점에 줄여 버리면 모든 첨부가 같은 크기가
      //    되어 **기기마다 다른 실제 한도를 실험으로 찾을 수 없다.** 다리를 못 건너는 첨부는
      //    발송 직전에 그 수신자만 분명한 문구로 실패시킨다(→ `lib/sms-runner.ts`).
      //
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
