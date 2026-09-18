import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { CallDateField } from '@/components/call-date-field';
import { TextField } from '@/components/form-fields';
import { Loading, Notice, SmsButton, s } from '@/components/sms-ui';
import { spacing } from '@/constants/theme';
import { callDevice } from '@/lib/call-device';
import { defaultCallTime, parseCallTime } from '@/lib/call-date';
import { recipientApi } from '@/lib/sms-api';
import { formatPhone } from '@/lib/phone';
import { matchesRecipientQuery } from '@/lib/recipient-search';
import type { CallFile, CallModelState } from '@/types/calls';
import type { Recipient } from '@/types/sms';

export function CallCreate({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const [model, setModel] = useState<CallModelState | null>(null);
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
  const lock = useRef(false);
  /** 사용자가 통화일시를 직접 건드렸으면 파일을 다시 골라도 덮어쓰지 않는다. 고쳐 둔 값을 말없이 되돌리는 쪽이 더 나쁘다. */
  const dateChosen = useRef(false);
  useEffect(() => {
    let live = true;
    const refresh = () => { void callDevice.models().then((value) => { if (live) setModel(value); }).catch(() => { if (live) setError('AI 기능 상태를 확인할 수 없습니다.'); }); };
    refresh();
    void recipientApi.list().then((rows) => { if (live) setRecipients(rows); }).catch(() => { if (live) setError('수신자 목록을 불러오지 못했습니다. 직접 입력하거나 화면을 다시 열어 주세요.'); });
    const timer = setInterval(refresh, 2000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  async function action(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '요청을 처리하지 못했습니다. 다시 시도해 주세요.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function start() {
    if (!file) return;
    const contact = manual ? { name: name.trim(), phone: normalizeCallPhone(phone) } : recipient ? { name: recipient.name, phone: recipient.phone, recipient_id: recipient.id } : null;
    if (!contact?.name) throw new Error('통화 상대를 선택하거나 이름과 전화번호를 입력해 주세요.');
    const recorded = parseCallTime(date);
    await callDevice.start({ file, contact, recorded_at: recorded });
    onStarted(); onClose();
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
  return <BottomSheet title="통화분석 등록하기" visible onClose={onClose}>
    {/*
      분석이 어디서 도는지(기기/서버)는 곧 바뀐다. 바뀔 말을 여기 적어 두면 그날 이 문장이
      **조용히 거짓말**이 되므로, 지금 확실한 것 — 결과가 어디에 남는지 — 만 적는다.
    */}
    <Notice message="분석이 끝나면 통화 요약과 원문이 내 계정에 저장됩니다." />
    {/* 설치 카드는 **기기에서 분석하는 기기**에만 선다. 그렇지 않은 곳(브라우저)에서는 설치할 것이 없다. */}
    {!model ? <Loading /> : model.supported && !model.installed ? <View style={s.card}><Text style={s.subtitle}>AI 기능 설치</Text><Notice message={`첫 사용 시 AI 기능을 설치합니다.${model.total_bytes > 0 ? ` 다운로드 크기: 약 ${(model.total_bytes / 1e9).toFixed(2)} GB.` : ''} Wi-Fi 환경을 권장합니다.`} />{model.downloading ? <><Loading /><Text accessibilityLiveRegion="polite" style={s.body}>다운로드 중… {(model.downloaded_bytes / 1e6).toFixed(0)} MB{model.total_bytes > 0 ? ` / ${(model.total_bytes / 1e6).toFixed(0)} MB` : ''}</Text></> : <SmsButton label={model.notice ? 'AI 기능 이어받기' : 'AI 기능 설치'} disabled={busy} onPress={() => void action(() => callDevice.install())} />}{model.notice ? <Notice message={model.notice} /> : null}{model.error ? <Notice error message={model.error} /> : null}</View> : null}
    {/*
      **AI 기능 설치 여부로 막지 않는다.** 분석은 서버로 옮기기로 했고, 등록은 브라우저에서도
      할 일이다. 아직 올릴 곳(서버 업로드 API)이 없는 자리에서는 고르는 순간 그 사실이 오류로
      나온다 — 회색 버튼으로 이유 없이 막아 두는 것보다 낫다.
    */}
    <SmsButton label="통화파일 불러오기" secondary disabled={busy} onPress={() => void action(async () => {
      const chosen = await callDevice.pickFile();
      if (!chosen) return;
      setFile(chosen);
      // 파일 시각(생성일이 남지 않는 기기에서는 수정일)을 기본값으로 채운다. 없거나 미래면 비워 둔다.
      if (!dateChosen.current) setDate(defaultCallTime(chosen.modified_at));
    })} />
    {file ? <Text style={s.body}>{file.name} · {(file.size / 1e6).toFixed(1)} MB</Text> : <Text style={s.meta}>m4a, mp3, wav, aac, 3gp, ogg</Text>}
    <View style={s.row}><SmsButton label="수신자에서 선택" secondary={manual} onPress={() => setManual(false)} /><SmsButton label="직접 입력" secondary={!manual} onPress={() => setManual(true)} /></View>
    {manual ? <><TextField label="통화 상대 이름" value={name} onChangeText={setName} maxLength={100} /><TextField label="통화 상대 전화번호" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={30} /></> : <>{/* 검색칸은 placeholder 가 같은 말을 하므로 라벨 글자를 걷는다(낭독기에는 그대로 읽힌다). */}
      <TextField hideLabel label="이름 또는 폰번호 뒷4자리" placeholder="이름 또는 폰번호 뒷4자리" value={query} onChangeText={setQuery} />{recipient ? <Text style={s.body}>선택: {recipient.name} · {formatPhone(recipient.phone)}</Text> : null}
      {/*
        후보는 세 줄 높이 안에서만 스크롤한다. 시트 하나에 **파일 선택 → 상대 선택 → 통화일시
        → 분석하기**가 모두 들어와야 하는데, 후보를 그대로 쌓으면 아래 둘이 화면 밖으로 밀린다.
      */}
      {!recipients.length ? <Text style={s.meta}>등록된 수신자가 없습니다. 직접 입력으로 통화 상대를 적어 주세요.</Text>
        : !searching ? <Text style={s.meta}>이름 또는 폰번호 뒷4자리로 검색해 주세요.</Text>
        : !shown.length ? <Text style={s.meta}>검색어에 해당하는 수신자가 없습니다.</Text>
        : <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.candidates} contentContainerStyle={styles.candidateList}>{shown.map((r) => <SmsButton key={r.id} label={`${r.name} · ${formatPhone(r.phone)}`} secondary={recipient?.id !== r.id} onPress={() => setRecipient(r)} />)}</ScrollView>}
      {/* 더 있다는 신호는 살짝 잘린 다음 줄이 맡는다. 안내는 그 스크롤로도 닿지 못할 때만 적는다. */}
      {searching && matches.length > shown.length ? <Text style={s.meta}>{matches.length}명이 맞습니다. 앞 {shown.length}명만 보여 주니 더 좁혀 주세요.</Text> : null}</>}
    <CallDateField label="통화일시" value={date} onChange={(value) => { dateChosen.current = true; setDate(value); }} />
    {error ? <Notice error message={error} /> : null}
    {/*
      🔧 **업로드 진행률 자리.** 서버 업로드 API 가 붙으면 이 자리에 `ProgressBar`(→ sms-ui)와
      「취소」가 선다. 지금은 올릴 곳이 없어 **그리지 않는다** — 움직이기만 하는 막대는 「멈췄나?」를
      풀어 주지 못할 뿐 아니라, 아직 하지 않는 일을 하고 있다고 말하게 된다.
    */}
    <SmsButton label={busy ? '준비 중…' : '등록하기'} disabled={busy || !file || !date || (manual ? !name.trim() || !phone.trim() : !recipient)} onPress={() => void action(start)} />
  </BottomSheet>;
}

/** 한 번에 펴 보이는 후보 줄 수. 버튼 높이(48)와 줄 간격(8)으로 시트 높이를 계산한다. */
const CANDIDATE_ROWS = 3;
/** 그려 두는 후보 수의 상한. 그보다 많으면 스크롤보다 검색어를 한 글자 더 치는 쪽이 빠르다. */
const CANDIDATE_MAX = 20;
const styles = StyleSheet.create({
  // 세 줄 + 다음 줄의 머리만큼. 살짝 잘려 보이는 네 번째 줄이 「더 있다」는 신호가 된다.
  candidates: { maxHeight: CANDIDATE_ROWS * 48 + (CANDIDATE_ROWS + 1) * spacing.sm },
  candidateList: { gap: spacing.sm },
});

function normalizeCallPhone(value: string) {
  if (!/^[+\d()\s-]+$/.test(value.trim())) throw new Error('전화번호를 확인해 주세요.');
  const normalized = value.replace(/[()\s-]/g, '');
  if (!/^\+?\d{7,15}$/.test(normalized)) throw new Error('전화번호를 확인해 주세요.');
  return normalized;
}
