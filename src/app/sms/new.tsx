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
import { TextField } from '@/components/form-fields';
import { Loading, Notice, SmsButton, SmsPage, s, smsError } from '@/components/sms-ui';
import { colors, fonts, inputFontSize, radii, spacing, text } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { useUserStore } from '@/store/user-store';
import { clearSmsDraft, readSmsDraft, writeSmsDraft } from '@/lib/sms-draft';
import { newSmsRequestId } from '@/lib/sms-dispatch';
import { utf8Length } from '@/lib/phone';
import { attachmentApi, recipientApi, smsApi, templateApi } from '@/lib/sms-api';
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
  const frozen = busy || !draftLoaded || pending !== null;
  // 폰 폭에서는 세 조작을 앱 헤더 아이콘으로 올려 목록에 세로 공간을 준다.
  const phone = useWindowDimensions().width < COMPACT_MAX_WIDTH;
  useHeaderActions(useMemo(() => phone ? <SmsHeaderActions frozen={frozen} onOpen={setPanel} /> : null, [phone, frozen]));
  const sendButton = stage === 'recipients' ? <SmsButton label={`${selected.length}명에게 발송${selected.length > 50 ? ' (50명 제한)' : ''}`} secondary={selected.length > 50} danger={selected.length > 50} disabled={frozen || loading || !selected.length || selected.length > 50} onPress={() => { setStage('compose'); void openTemplates(); }} /> : null;
  const listFooter = phone && stage === 'recipients';
  const groups = [...new Set(rows.map((item) => item.groupId).filter(Boolean))];
  const visible = rows.filter((item) => (!group || item.groupId === group) && item.name.toLowerCase().includes(query.trim().toLowerCase()));
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
      {stage === 'recipients' ? <>
        <RecipientFilters groups={groups} group={group} onGroupChange={setGroup} query={query} onQueryChange={setQuery} />
        {loading ? <Loading /> : null}
        <RecipientTable includeSentFilter={{ selected: includeSent, disabled: frozen || loading, onPress: () => { setSelected([]); setIncludeSent(!includeSent); } }} items={visible} selectedIds={selected} onSelectionChange={setSelected} onHistory={setHistory} onEdit={setEditingRecipient} disabled={frozen || loading} dense={phone} />
        {listFooter ? null : sendButton}
      </> : <>
        <Notice message="템플릿을 가져오거나 직접 작성하세요. 캠페인을 만든 다음 Android 앱에서 최종 전송합니다." />
        <Text style={s.subtitle}>수신자 {selected.length}명 선택</Text>
        {!pending ? <SmsButton label="수신자 선택으로 돌아가기" secondary disabled={busy || uploading} onPress={() => setStage('recipients')} /> : null}
        <SmsButton label="템플릿 가져오기" secondary disabled={frozen || uploading} onPress={() => void openTemplates()} />
        <TextField label="발송 제목" value={title} maxLength={100} editable={!frozen} onChangeText={setTitle} />
        <Text style={s.subtitle}>메시지</Text>
        <TextInput accessibilityLabel="메시지" multiline value={message} editable={!frozen} onChangeText={setMessage} textAlignVertical="top" style={{ minHeight: 180, padding: spacing.lg, borderRadius: radii.button, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.card, color: colors.ink, ...fonts.body, fontSize: inputFontSize(text.lg) }} />
        <Text selectable style={s.meta}>{Array.from(message).length} / 2,000자 · UTF-8 {utf8Length(message)} bytes</Text>
        <Notice message="짧은 문자는 SMS, 장문은 LMS, 이미지 첨부는 MMS로 자동 발송합니다. 표시된 byte 수는 참고용이며 실제 발송 유형은 Android에서 결정합니다." />
        <AttachmentEditor value={attachments} onChange={setAttachments} disabled={frozen} onBusy={setUploading} />
        <SmsButton label={busy ? '캠페인 확인 중…' : pending ? '같은 캠페인 생성 요청 다시 확인' : `${selected.length}명 발송 준비`} disabled={busy || uploading || loading || !draftLoaded || !selected.length || selected.length > 50} onPress={() => void create()} />
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
