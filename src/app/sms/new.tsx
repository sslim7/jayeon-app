import { useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useHeaderActions } from '@/components/app-navigation';
import { SmsHeaderActions } from '@/components/sms-header-actions';
import { COMPACT_MAX_WIDTH } from '@/components/recipient-table-columns';
import { CampaignHistorySheet } from '@/components/campaign-history-sheet';
import { RecipientRegistrationSheet } from '@/components/recipient-registration-sheet';
import { TemplateManager } from '@/components/template-manager';
import { BottomSheet } from '@/components/bottom-sheet';
import { AttachmentEditor } from '@/components/message-attachments';
import { RecipientFilters } from '@/components/recipient-filters';
import { RecipientTable } from '@/components/recipient-table';
import { RecipientHistorySheet } from '@/components/recipient-history';
import { ReserveSheet } from '@/components/reserve-sheet';
import { TextField } from '@/components/form-fields';
import { ButtonRow, Loading, Notice, SmsButton, SmsPage, s, smsError } from '@/components/sms-ui';
import { colors, fonts, inputFontSize, radii, spacing, text } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { useUserStore } from '@/store/user-store';
import { clearSmsDraft, readSmsDraft, writeSmsDraft } from '@/lib/sms-draft';
import { newSmsRequestId } from '@/lib/sms-dispatch';
import { utf8Length } from '@/lib/phone';
import { matchesRecipientQuery } from '@/lib/recipient-search';
import { attachmentApi, recipientApi, smsApi, templateApi } from '@/lib/sms-api';
import { excludeReserved, mergeReservation, reservedRecipientIds, reservedRows, MAX_RESERVATION_SIZE } from '@/lib/sms-reservations';
import { useReservations } from '@/hooks/use-reservations';
import type { Attachment, CreateCampaignInput, MessageTemplate, Recipient } from '@/types/sms';
export default function NewCampaignScreen() {
  const userId = useUserStore((s) => s.profile?.userId);
  const [panel, setPanel] = useState<'register' | 'templates' | 'history' | null>(null);
  const [editingRecipient, setEditingRecipient] = useState<Recipient | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const { ids } = useLocalSearchParams<{ ids?: string }>();
  const [stage, setStage] = useState<'recipients' | 'compose'>('recipients');
  const [includeSent, setIncludeSent] = useState(!!ids);
  const [group, setGroup] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [history, setHistory] = useState<Recipient | null>(null);
  const [rows, setRows] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<string[]>(() =>
    (ids ?? '').split(',').filter(Boolean),
  );
  const [title, setTitle] = useState('더메이');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // 예약·삭제는 발송 준비와 잠금이 달라 별도의 진행 상태를 쓴다.
  const [sheet, setSheet] = useState<'reserve' | 'remove' | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const reservations = useReservations();
  // 응답 유실 시 같은 캠페인을 확인할 수 있도록 요청 당시 내용을 보존한다.
  const [pending, setPending] = useState<CreateCampaignInput | null>(null);
  const lock = useRef(false);
  async function load(pruneMissing = true) {
    setLoading(true);
    try {
      const items = await recipientApi.list({ includeSent });
      setRows(items);
      if (pruneMissing) {
        const existingIds = new Set(items.map((item) => item.id));
        setSelected((previous) => previous.filter((id) => existingIds.has(id)));
      }
      setError('');
    } catch (e) {
      setError(smsError(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // 예약 표시는 캠페인 목록에서 모으므로 수신자 조회와 독립적으로 한 번만 부른다.
    void reservations.reload();
    // 화면 진입에 한 번이면 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // 복원 중인 멱등 요청의 대상은 서버가 확정 거절하기 전까지 유지한다.
    void Promise.resolve().then(() => load(false));
    // 필터 변경 시 선택은 클릭 핸들러에서 해제하며 복원 요청은 유지한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeSent]);
  useEffect(() => {
    if (!userId) return;
    readSmsDraft(userId)
      .then((draft) => {
        if (draft) {
          setPending(draft);
          setStage('compose');
          void Promise.all((draft.attachmentIds ?? []).map((id) => attachmentApi.content(id))).then(setAttachments).catch((e) => setError(smsError(e)));
          setTitle(draft.title);
          setMessage(draft.message);
          setSelected(draft.recipientIds);
        }
        setDraftLoaded(true);
      })
      .catch((e) => setError(smsError(e)));
  }, [userId]);
  async function create() {
    if (lock.current || uploading) return;
    if (
      !pending &&
      (!title.trim() || (!message.trim() && !attachments.length) || selected.length < 1 || selected.length > 50)
    ) {
      setError('제목, 메시지 또는 첨부, 수신자 1~50명을 확인해 주세요.');
      return;
    }
    if (Array.from(message).length > 2000) {
      setError('메시지는 2,000자까지 입력할 수 있어요.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    const payload = pending ?? {
      requestId: newSmsRequestId(),
      title: title.trim(),
      message,
      recipientIds: [...selected],
      attachmentIds: attachments.map((item) => item.id),
    };
    setPending(payload);
    try {
      if (!userId || !draftLoaded) throw new Error('계정의 발송 준비 내용을 먼저 불러와 주세요.');
      await writeSmsDraft(userId, payload);
      const campaign = await smsApi.create(payload);
      await clearSmsDraft(userId);
      router.replace({ pathname: '/sms/[id]', params: { id: campaign.id } });
    } catch (e) {
      const rejected =
        e instanceof ApiError &&
        ((e.status === 400 && e.code === 'VALIDATION_FAILED') ||
          (e.status === 404 && e.code === 'NOT_FOUND'));
      if (rejected && userId) {
        try {
          await clearSmsDraft(userId);
          setPending(null);
          await load();
        } catch {
          setError(
            '저장된 요청을 정리하지 못했어요. 저장소 접근을 확인하고 같은 요청으로 다시 확인해 주세요.',
          );
          return;
        }
      }
      setError(
        rejected
          ? `${smsError(e)} 수신자 목록과 내용을 확인한 뒤 다시 준비해 주세요.`
          : `${smsError(e)} 같은 요청으로 다시 확인할 수 있어요.`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function openTemplates() {
    setTemplateOpen(true); setTemplateLoading(true); setTemplateError('');
    try { setTemplates(await templateApi.list()); }
    catch (e) { setTemplateError(smsError(e)); }
    finally { setTemplateLoading(false); }
  }
  /** 예약 = 캠페인을 만들되 발송을 시작하지 않는 것. 이미 예약된 사람은 같은 내용을 두 번 받지 않게 뺀다. */
  async function reserve(template: MessageTemplate) {
    setActionBusy(true);
    setError('');
    // 화면에 떠 있는 동안 다른 곳에서 예약이 늘었을 수 있으므로 만들기 직전에 다시 읽어 판정한다.
    const fresh = await reservations.reload();
    if (!fresh) {
      setActionBusy(false);
      setError('예약 현황을 확인하지 못해 예약하지 않았어요. 연결을 확인하고 다시 시도해 주세요.');
      return;
    }
    const { targetIds, excludedCount } = excludeReserved(selected, reservedRecipientIds(reservedRows(fresh)));
    if (!targetIds.length) {
      setSheet(null);
      setActionBusy(false);
      setNotice(`선택한 ${selected.length}명은 이미 예약되어 있어요. 새로 예약하지 않았어요.`);
      return;
    }
    // 같은 템플릿 예약이 여러 건으로 쪼개지지 않게 기존 예약을 흡수해 다시 만든다.
    const { replaced, chunks, mergedCount } = mergeReservation(fresh, template.name, targetIds);
    const created: string[] = [];
    try {
      for (const recipientIds of chunks) {
        const campaign = await smsApi.create({
          requestId: newSmsRequestId(),
          title: template.name,
          message: template.message,
          recipientIds,
          attachmentIds: template.attachments.map((item) => item.id),
          reserved: true,
        });
        created.push(campaign.id);
      }
    } catch (e) {
      // 새 예약을 다 만들지 못했으면 기존 예약은 그대로 두고 방금 만든 것만 되돌린다.
      for (const id of created) await smsApi.setStatus(id, 'CANCELLED').catch(() => undefined);
      setError(`${smsError(e)} 기존 예약은 그대로 두었어요.`);
      setActionBusy(false);
      return;
    }
    // 새 명단이 모두 생긴 다음에 지운다 — 순서를 뒤집으면 중간 실패가 예약 유실이 된다.
    let stale = 0;
    for (const item of replaced) {
      try { await smsApi.setStatus(item.campaign.id, 'CANCELLED'); } catch { stale += 1; }
    }
    setSheet(null);
    setSelected([]);
    // 템플릿 이름의 끝소리에 따라 조사가 갈리지 않게 「템플릿으로」를 사이에 둔다.
    setNotice([
      `${targetIds.length}명을 「${template.name}」 템플릿으로 예약했어요.`,
      mergedCount ? `이미 예약돼 있던 ${mergedCount}명과 합쳤어요.` : '',
      chunks.length > 1 ? `한 건은 ${MAX_RESERVATION_SIZE}명까지라 ${MAX_RESERVATION_SIZE}명씩 ${chunks.length}건으로 나눠 예약했어요.` : '',
      excludedCount ? `다른 템플릿으로 이미 예약된 ${excludedCount}명은 제외했어요.` : '',
      stale ? `기존 예약 ${stale}건을 정리하지 못했어요. 예약 문자 보내기 화면을 확인해 주세요.` : '',
    ].filter(Boolean).join(' '));
    try {
      await reservations.reload();
    } finally {
      setActionBusy(false);
    }
  }
  /** 수신자 영구 삭제. 서버는 수신자 문서만 지우고 이미 만들어진 예약·이력은 그대로 둔다. */
  async function removeSelected() {
    setActionBusy(true);
    setError('');
    let done = 0;
    let failed = 0;
    for (const id of selected) {
      try { await recipientApi.remove(id); done += 1; } catch { failed += 1; }
    }
    setSheet(null);
    setSelected([]);
    setNotice(`${done}명을 삭제했어요.${failed ? ` ${failed}명은 삭제하지 못했어요. 목록을 확인해 주세요.` : ''}`);
    setActionBusy(false);
    await load();
    await reservations.reload();
  }
  const frozen = busy || !draftLoaded || pending !== null;
  // 폰 폭에서는 세 조작을 앱 헤더 아이콘으로 올려 목록에 세로 공간을 준다.
  const phone = useWindowDimensions().width < COMPACT_MAX_WIDTH;
  useHeaderActions(useMemo(() => phone ? <SmsHeaderActions frozen={frozen} onOpen={setPanel} /> : null, [phone, frozen]));
  const overLimit = selected.length > 50;
  const noSelection = frozen || loading || actionBusy || !selected.length;
  // 인원수는 바로 위 (선택/전체) 표시가 맡고, 하단은 폰 폭에서도 세 조작이 한 줄에 들어가게 짧은 라벨만 둔다.
  const sendButton = stage === 'recipients' ? <View style={{ gap: spacing.sm }}>
    {overLimit ? <Notice error message={`${selected.length}명을 선택했어요. 한 번에 50명까지 발송·예약할 수 있어요.`} /> : null}
    <ButtonRow>
      <SmsButton fill label="발송하기" disabled={noSelection || overLimit} onPress={() => { setStage('compose'); void openTemplates(); }} />
      <SmsButton fill secondary label="예약하기" disabled={noSelection || overLimit} onPress={() => { setNotice(''); setSheet('reserve'); }} />
      <SmsButton fill secondary danger label="삭제" disabled={noSelection} onPress={() => { setNotice(''); setSheet('remove'); }} />
    </ButtonRow>
  </View> : null;
  const listFooter = phone && stage === 'recipients';
  const groups = [...new Set(rows.map((item) => item.groupId).filter(Boolean))];
  const reservedSelected = selected.filter((id) => reservations.recipientIds.has(id)).length;
  const visible = rows.filter((item) => (!group || item.groupId === group) && matchesRecipientQuery(query, item));
  return (
    <SmsPage hideTitle wide={stage === 'recipients'} compact={listFooter} footer={listFooter ? sendButton : undefined} title={stage === 'recipients' ? '문자 보내기' : '문자 작성'} actions={phone ? undefined : <>
      <SmsButton label="수신자 등록" secondary disabled={frozen} onPress={() => setPanel('register')} />
      <SmsButton label="템플릿" secondary disabled={frozen} onPress={() => setPanel('templates')} />
      <SmsButton label="발송 이력" secondary onPress={() => setPanel('history')} />
    </>}>
      {panel === 'register' || editingRecipient ? <RecipientRegistrationSheet recipient={editingRecipient ?? undefined} onClose={() => { setPanel(null); setEditingRecipient(null); }} onSaved={() => void load()} /> : null}
      {panel === 'templates' ? <TemplateManager onClose={() => setPanel(null)} /> : null}
      {panel === 'history' ? <CampaignHistorySheet onClose={() => { setPanel(null); void load(); }} /> : null}
      {history ? <RecipientHistorySheet key={history.id} recipient={history} onClose={() => setHistory(null)} /> : null}
      {error ? <Notice error message={error} /> : null}
      {notice ? <Notice message={notice} /> : null}
      {reservations.error ? <Notice error message={`예약 표시를 불러오지 못했어요. ${reservations.error}`} /> : null}
      {sheet === 'reserve' ? <ReserveSheet count={selected.length} busy={actionBusy} onClose={() => setSheet(null)} onReserve={(template) => void reserve(template)} /> : null}
      {sheet === 'remove' ? <BottomSheet title="수신자 삭제" visible onClose={() => setSheet(null)}>
        <Notice error message={`선택한 ${selected.length}명을 영구 삭제할까요? 되돌릴 수 없어요.`} />
        <Notice message="수신자 정보만 지웁니다. 과거 발송 이력은 그대로 남습니다." />
        {reservedSelected ? <Notice error message={`이 중 ${reservedSelected}명은 예약되어 있어요. 수신자를 지워도 이미 만들어진 예약은 남아 그대로 발송됩니다. 「예약 문자 보내기」에서 예약을 먼저 취소해 주세요.`} /> : null}
        <SmsButton label="삭제" accessibilityLabel="수신자 삭제 확인" danger secondary disabled={actionBusy} onPress={() => void removeSelected()} />
        <SmsButton label="취소" accessibilityLabel="수신자 삭제 취소" secondary disabled={actionBusy} onPress={() => setSheet(null)} />
      </BottomSheet> : null}
      {stage === 'recipients' ? <>
        <RecipientFilters groups={groups} group={group} onGroupChange={setGroup} query={query} onQueryChange={setQuery} />
        {loading ? <Loading /> : null}
        <RecipientTable includeSentFilter={{ selected: includeSent, disabled: frozen || loading, onPress: () => { setSelected([]); setIncludeSent(!includeSent); } }} items={visible} selectedIds={selected} onSelectionChange={setSelected} onHistory={setHistory} onEdit={setEditingRecipient} reservedIds={reservations.recipientIds} disabled={frozen || loading} dense={phone} />
        {listFooter ? null : sendButton}
      </> : <>
        <Notice message="템플릿을 가져오거나 직접 작성하세요. 문자를 준비한 다음 Android 앱에서 최종 전송합니다." />
        {/* 지금 보내기는 예약과 별개다 — 예약된 사람에게 한 번 더 가는 상황을 미리 알린다. */}
        {reservedSelected ? <Notice error message={`선택한 ${reservedSelected}명은 이미 예약되어 있어요. 지금 보내면 예약한 문자와 별개로 한 번 더 갑니다.`} /> : null}
        <Text style={s.subtitle}>수신자 {selected.length}명 선택</Text>
        {!pending ? <SmsButton label="수신자 선택으로 돌아가기" secondary disabled={busy || uploading} onPress={() => setStage('recipients')} /> : null}
        <SmsButton label="템플릿 가져오기" secondary disabled={frozen || uploading} onPress={() => void openTemplates()} />
        <TextField label="발송 제목" value={title} maxLength={100} editable={!frozen} onChangeText={setTitle} />
        <Text style={s.subtitle}>메시지</Text>
        <TextInput accessibilityLabel="메시지" multiline value={message} editable={!frozen} onChangeText={setMessage} textAlignVertical="top" style={{ minHeight: 180, padding: spacing.lg, borderRadius: radii.button, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.card, color: colors.ink, ...fonts.body, fontSize: inputFontSize(text.lg) }} />
        <Text selectable style={s.meta}>{Array.from(message).length} / 2,000자 · UTF-8 {utf8Length(message)} bytes</Text>
        <Notice message="짧은 문자는 SMS, 장문은 LMS, 이미지 첨부는 MMS로 자동 발송합니다. 표시된 byte 수는 참고용이며 실제 발송 유형은 Android에서 결정합니다." />
        <AttachmentEditor value={attachments} onChange={setAttachments} disabled={frozen} onBusy={setUploading} />
        <SmsButton label={busy ? '확인 중…' : pending ? '같은 요청 다시 확인' : `${selected.length}명 발송 준비`} disabled={busy || uploading || loading || !draftLoaded || !selected.length || selected.length > 50} onPress={() => void create()} />
        {pending ? <Notice message="요청 결과가 확인될 때까지 내용은 고정됩니다. 같은 요청으로 생성 여부를 확인하며 자동으로 문자를 발송하지 않습니다." /> : null}
      </>}
      <BottomSheet title="템플릿 가져오기" visible={templateOpen} onClose={() => setTemplateOpen(false)}>
        <Notice message="템플릿을 선택하면 작성 중인 메시지와 첨부를 해당 템플릿으로 바꿉니다." />
        {templateLoading ? <Loading /> : !templates.length ? <Notice message="등록된 템플릿이 없습니다. 직접 작성하거나 헤더의 템플릿 버튼에서 등록해 주세요." /> : templates.map((item) => <View key={item.id} style={s.card}>
          <Text style={s.subtitle}>{item.name}</Text><Text style={s.body}>{item.message || '이미지 메시지'}</Text><Text style={s.meta}>첨부 {item.attachments.length}개</Text>
          <SmsButton label={`${item.name} 템플릿 선택`} disabled={frozen || uploading} onPress={() => { setMessage(item.message); setAttachments(item.attachments); if (!title) setTitle(item.name); setTemplateOpen(false); }} />
        </View>)}
        {templateError ? <Notice error message={templateError} /> : null}
        <SmsButton label="직접 작성" secondary onPress={() => setTemplateOpen(false)} />
      </BottomSheet>
    </SmsPage>
  );
}
