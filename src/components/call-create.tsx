import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { CallAsrOption } from '@/components/call-asr-option';
import { CallDateField } from '@/components/call-date-field';
import { CallFileField } from '@/components/call-file-field';
import { TextField } from '@/components/form-fields';
import { Notice, ProgressBar, SmsButton, s } from '@/components/sms-ui';
import { spacing } from '@/constants/theme';
import { defaultCallTime, parseCallTime } from '@/lib/call-date';
import { failureReason } from '@/lib/call-errors';
import { CallUploadError, uploadCall } from '@/lib/call-upload';
import { percentOf } from '@/lib/call-progress';
import { recipientApi } from '@/lib/sms-api';
import { formatPhone } from '@/lib/phone';
import { matchesRecipientQuery } from '@/lib/recipient-search';
import { nativeShellCanOpen, openNativeScreen } from '@/lib/native-bridge';
import { CALL_CREATE_PATH } from '@/lib/shell-routes';
import type { AsrModelId } from '@/lib/asr-models';
import type { CallFile } from '@/types/calls';
import type { Recipient } from '@/types/sms';

/**
 * 통화분석 등록.
 *
 * 흐름은 하나다 — 파일을 고르고, 상대와 통화일시를 정하고, 올린다. 올리는 동안 보이는
 * 막대는 **실제로 보낸 바이트**이고(→ `lib/call-put.web.ts`), 취소는 그 전송을 진짜로 끊는다.
 * 올라간 뒤의 전사·분석은 서버가 하므로 목록에서 이어 본다.
 */
export function CallCreate({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const [file, setFile] = useState<CallFile | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [manual, setManual] = useState(false);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  // 파일을 고르기 전에도 통화일시는 채워 둔다(현재 시각). 비워 두면 손으로 다 적어야 한다.
  const [date, setDate] = useState(() => defaultCallTime(null));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * 폰에서 받아쓸 것인가 — 켜져 있으면 쓸 모델, 꺼져 있으면 `null`.
   *
   * 🔴 **웹에서는 언제나 `null` 이다.** 체크박스 자체가 없어 아무도 이 값을 올려 주지 않는다
   * (→ `components/call-asr-option.web.tsx`). 그래서 웹의 등록 흐름은 이 기능이 생기기
   * 전과 **한 글자도 다르지 않다**.
   */
  const [asrModel, setAsrModel] = useState<AsrModelId | null>(null);
  /** 올린 비율(0~1). `null` 이면 아직 전송이 시작되지 않았다. */
  const [sent, setSent] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  /**
   * 🔴 재시도는 **앞서 쓰던 통화 ID 를 그대로** 쓴다. 객체 경로가 ID 로 정해지므로 같은 ID 면
   * 덮어쓰고, 새 ID 를 뽑으면 못 쓰는 28MB 객체가 버킷에 1년 남는다.
   */
  const callId = useRef<string | undefined>(undefined);
  const lock = useRef(false);
  /** 사용자가 통화일시를 직접 건드렸으면 파일을 다시 골라도 덮어쓰지 않는다. 고쳐 둔 값을 말없이 되돌리는 쪽이 더 나쁘다. */
  const dateChosen = useRef(false);
  useEffect(() => {
    let live = true;
    void recipientApi.list().then((rows) => { if (live) setRecipients(rows); }).catch(() => { if (live) setError('수신자 목록을 불러오지 못했습니다. 직접 입력하거나 화면을 다시 열어 주세요.'); });
    return () => { live = false; abort.current?.abort(); };
  }, []);
  async function start() {
    if (!file || lock.current) return;
    let contact;
    try { contact = manual ? { name: name.trim(), phone: normalizeCallPhone(phone) } : recipient ? { name: recipient.name, phone: recipient.phone, recipient_id: recipient.id } : null; }
    catch (e) { setError(e instanceof Error ? e.message : '통화 상대를 확인해 주세요.'); return; }
    if (!contact?.name) { setError('통화 상대를 선택하거나 이름과 전화번호를 입력해 주세요.'); return; }
    lock.current = true; setBusy(true); setError(''); setSent(0);
    const controller = new AbortController();
    abort.current = controller;
    try {
      /*
       * 🔴 **녹음은 어느 쪽이든 올라간다.** 바뀌는 것은 `asr` 한 값뿐이다 — 폰에서 받아쓰기로
       * 했다고 업로드를 건너뛰면 나중에 통화를 다시 들을 수 없게 된다(→ `lib/call-upload.ts`).
       */
      const local = asrModel;
      const result = await uploadCall({ file, contact, recorded_at: parseCallTime(date) }, {
        callId: callId.current,
        signal: controller.signal,
        onProgress: (fraction) => setSent(fraction),
        // 끄면 `undefined` 라 본문 자체가 나가지 않는다 — 지금까지의 서버 경로 그대로다.
        asr: local ? 'client' : undefined,
      });
      callId.current = result.callId;
      onStarted(); onClose();
      /*
       * 🔴 **여기서 멈추면 안 된다.** `asr: 'client'` 로 등록한 통화는 서버가 받아쓰기를
       * 하지 않고 기다린다 — 앱이 전사문을 보내 주지 않으면 6시간 뒤 `CLIENT_TRANSCRIPT_TIMEOUT`
       * 으로 실패한다. 받아쓰기 화면으로 넘기는 이 한 줄이 그 약속의 나머지 절반이다.
       *
       * ⚠️ 원본 경로를 함께 넘긴다. 문서 선택기가 캐시에 복사해 둔 파일이고, 그 화면이
       * 16kHz 로 바꿔야 한다(→ `lib/asr-audio.ts`). 이어하기로 다시 열 때는 저장된 상태가
       * 이 값들을 들고 있어 파라미터가 없어도 된다.
       */
      if (local && file.source.kind === 'native') {
        router.push({ pathname: '/asr-run', params: {
          callId: result.callId, model: local,
          uri: file.source.uri, name: file.name, bytes: String(file.size),
        } });
      }
    } catch (e) {
      // 다음 시도가 같은 객체를 덮어쓰도록 이번에 쓴 ID 를 붙잡아 둔다.
      if (e instanceof CallUploadError) { callId.current = e.callId || callId.current; setError(failureReason(e.code)); }
      else setError('등록을 완료하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
      setSent(null);
    } finally {
      lock.current = false; setBusy(false); abort.current = null;
    }
  }
  /**
   * **검색해야 후보가 선다.**
   *
   * 수신자가 200명인 계정에서 빈 검색어로 목록을 펴면 시트가 이름 더미가 되고, 그 안에서
   * 원하는 사람을 눈으로 찾는 일은 검색보다 느리다. 그래서 빈 검색어는 후보 대신 「어떻게
   * 찾는지」 한 줄만 보여 준다.
   */
  const searching = query.trim().length > 0;
  const matches = searching ? recipients.filter((r) => matchesRecipientQuery(query, r)) : [];
  const shown = matches.slice(0, CANDIDATE_MAX);
  const percent = percentOf(sent);
  return <BottomSheet title="통화분석 등록하기" visible onClose={onClose}>
    {/*
      🔧 **고지 문구를 여기 두지 않는다**(사용자 결정, 2026-09-18). 원본 녹음이 서버로 올라가
      약 366일 보관된다는 사실은 화면 어디에도 적지 않는다 — 어디에 적을지는 약관·개인정보
      처리방침 쪽에서 따로 정한다(→ `docs/call-analysis.md`). 시트는 바로 파일 선택으로 연다.
    */}
    <CallFileField label="통화파일 불러오기" value={file} disabled={busy} onPick={(chosen) => {
      setFile(chosen); setError('');
      // 같은 자리에서 파일을 바꾸면 앞서 올리던 객체와 섞이면 안 된다. ID 를 새로 뽑게 비운다.
      callId.current = undefined; setSent(null);
      // 파일 시각(생성일이 남지 않는 기기에서는 수정일)을 기본값으로 채운다. 없거나 미래면 비워 둔다.
      if (!dateChosen.current) setDate(defaultCallTime(chosen.modified_at));
    }} onError={setError} />
    <View style={s.row}><SmsButton label="수신자에서 선택" secondary={manual} onPress={() => setManual(false)} /><SmsButton label="직접 입력" secondary={!manual} onPress={() => setManual(true)} /></View>
    {manual ? <><TextField label="통화 상대 이름" value={name} onChangeText={setName} maxLength={100} /><TextField label="통화 상대 전화번호" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={30} /></> : <>{/* 검색칸은 placeholder 가 같은 말을 하므로 라벨 글자를 걷는다(낭독기에는 그대로 읽힌다). */}
      <TextField hideLabel label="이름,전화번호 뒷자리 4자" placeholder="이름,전화번호 뒷자리 4자" value={query} onChangeText={setQuery} />{recipient ? <Text style={s.body}>선택: {recipient.name} · {formatPhone(recipient.phone)}</Text> : null}
      {/*
        후보는 세 줄 높이 안에서만 스크롤한다. 시트 하나에 **파일 선택 → 상대 선택 → 통화일시
        → 등록하기**가 모두 들어와야 하는데, 후보를 그대로 쌓으면 아래 둘이 화면 밖으로 밀린다.
      */}
      {!recipients.length ? <Text style={s.meta}>등록된 수신자가 없습니다. 직접 입력으로 통화 상대를 적어 주세요.</Text>
        : !searching ? <Text style={s.meta}>이름,전화번호 뒷자리 4자로 검색해 주세요.</Text>
        : !shown.length ? <Text style={s.meta}>검색어에 해당하는 수신자가 없습니다.</Text>
        : <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.candidates} contentContainerStyle={styles.candidateList}>{shown.map((r) => <SmsButton key={r.id} label={`${r.name} · ${formatPhone(r.phone)}`} secondary={recipient?.id !== r.id} onPress={() => setRecipient(r)} />)}</ScrollView>}
      {/* 더 있다는 신호는 살짝 잘린 다음 줄이 맡는다. 안내는 그 스크롤로도 닿지 못할 때만 적는다. */}
      {searching && matches.length > shown.length ? <Text style={s.meta}>{matches.length}명이 맞습니다. 앞 {shown.length}명만 보여 주니 더 좁혀 주세요.</Text> : null}</>}
    <CallDateField label="통화일시" value={date} onChange={(value) => { dateChosen.current = true; setDate(value); }} />
    {/*
      🔴 **웹에서는 이 자리에 아무것도 서지 않는다**(→ `components/call-asr-option.web.tsx`).
      체크를 끄면 서버가 전부 하는 지금 동작 그대로다 — 그게 이 기능의 안전망이다.
    */}
    <CallAsrOption modelId={asrModel} onChange={setAsrModel} disabled={busy} />
    <NativeCallCreateEntry disabled={busy} />
    {error ? <Notice error message={error} /> : null}
    {/*
      🔴 막대는 **실제로 보낸 바이트**다. 100% 에 닿은 뒤에도 잠시 걸리는 구간이 있어(서버가
      객체를 확인하고 큐에 넣는다) 그때는 막대 대신 그 사실을 적는다 — 100% 인 채로 멈춰
      보이는 것이 가장 나쁘다.
    */}
    {percent !== null ? <View style={styles.progress}>
      <ProgressBar percent={percent} label={`업로드 ${percent}%`} />
      <Text accessibilityLiveRegion="polite" style={s.meta}>{percent < 100 ? `녹음 파일 업로드 중… ${percent}%` : '업로드 완료. 서버에 등록하는 중…'}</Text>
      <SmsButton secondary label="업로드 취소" disabled={percent >= 100} onPress={() => abort.current?.abort()} />
    </View> : null}
    <SmsButton label={busy ? '올리는 중…' : '등록하기'} disabled={busy || !file || !date || (manual ? !name.trim() || !phone.trim() : !recipient)} onPress={() => void start()} />
  </BottomSheet>;
}

/**
 * 껍데기 안의 웹 시트에만 서는 입구 — **「폰에서 받아쓰기로 등록」.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이 버튼이 없으면 폰 받아쓰기에 닿을 방법이 없다.** 사용자가 보는 등록 시트는 웹이  │
 * │ 그린 것이라 위 `CallAsrOption` 이 아무것도 세우지 않는다(→ `.web.tsx`). 그런데        │
 * │ 웹뷰에서 고른 파일은 껍데기로 넘길 수 없어서(64KB 메시지 한계 → `docs/call-analysis.md`)│
 * │ **파일 선택부터 네이티브여야** 한다. 그래서 이 줄은 값을 받는 칸이 아니라 화면을 여는   │
 * │ 문이다(→ `app/call-create.tsx`).                                              │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **조건을 달지 않는다.** 웹은 이 기기가 받아쓸 수 있는지 알 수 없다 — whisper 가 없으니
 * 잰 적도 없고, 모델이 깔렸는지도 모른다. 🔴 모르는 것을 아는 척해 「지원 안 함」으로 감추면,
 * 되는 기기를 쓰는 사람에게서 기능을 통째로 숨기게 된다. 판정과 안내는 **넘어간 네이티브
 * 화면이** 한다(→ `components/call-asr-option.tsx`).
 *
 * 🔴 **기존 웹 등록 흐름은 그대로 남는다.** 이 버튼을 누르지 않으면 지금까지처럼 서버가
 * 전부 받아쓴다 — 그게 이 기능의 안전망이다.
 *
 * 네이티브에서는 `nativeShellCanOpen` 이 언제나 거짓이라 서지 않는다. 이 화면 자신이
 * 자신을 여는 줄이 되면 안 되기 때문이다(→ `lib/native-bridge.ts`).
 */
function NativeCallCreateEntry({ disabled }: { disabled: boolean }) {
  if (!nativeShellCanOpen(CALL_CREATE_PATH)) return null;
  return <View style={styles.nativeEntry}>
    <SmsButton
      secondary
      label="폰에서 받아쓰기로 등록"
      disabled={disabled}
      onPress={() => openNativeScreen(CALL_CREATE_PATH)}
    />
    {/*
      ⚠️ **파일을 다시 고른다는 사실을 미리 말한다.** 앱 화면은 빈 양식으로 열리는데, 그것을
      말해 두지 않으면 사용자는 여기서 채운 것이 넘어갔다고 믿고 그 화면에서 등록을 누른다.
    */}
    <Text style={s.meta}>통화 내용을 서버로 보내지 않고 폰에서 직접 받아써요. 앱 화면이 열리면 파일과 통화 상대를 그곳에서 다시 골라 주세요.</Text>
  </View>;
}

/** 한 번에 펴 보이는 후보 줄 수. 버튼 높이(48)와 줄 간격(8)으로 시트 높이를 계산한다. */
const CANDIDATE_ROWS = 3;
/** 그려 두는 후보 수의 상한. 그보다 많으면 스크롤보다 검색어를 한 글자 더 치는 쪽이 빠르다. */
const CANDIDATE_MAX = 20;
const styles = StyleSheet.create({
  // 세 줄 + 다음 줄의 머리만큼. 살짝 잘려 보이는 네 번째 줄이 「더 있다」는 신호가 된다.
  candidates: { maxHeight: CANDIDATE_ROWS * 48 + (CANDIDATE_ROWS + 1) * spacing.sm },
  candidateList: { gap: spacing.sm },
  progress: { gap: spacing.sm },
  nativeEntry: { gap: spacing.sm },
});

function normalizeCallPhone(value: string) {
  if (!/^[+\d()\s-]+$/.test(value.trim())) throw new Error('전화번호를 확인해 주세요.');
  const normalized = value.replace(/[()\s-]/g, '');
  if (!/^\+?\d{7,15}$/.test(normalized)) throw new Error('전화번호를 확인해 주세요.');
  return normalized;
}
