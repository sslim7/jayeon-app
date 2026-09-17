import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { TextField } from '@/components/form-fields';
import { Loading, Notice, SmsButton, s } from '@/components/sms-ui';
import { callDevice } from '@/lib/call-device';
import { recipientApi } from '@/lib/sms-api';
import { formatPhone } from '@/lib/phone';
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
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
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
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(date)) throw new Error('통화일시를 2026-09-17 14:20 형식으로 입력해 주세요.');
    const recorded = new Date(date.replace(' ', 'T') + ':00');
    if (!Number.isFinite(recorded.getTime()) || localDate(recorded) !== date) throw new Error('유효한 통화일시를 입력해 주세요.');
    // 기기 시계 오차 5분까지만 인정한다. 그 이상은 서버가 거부하므로 여기서 이유를 밝혀 막는다.
    if (recorded.getTime() > Date.now() + 5 * 60_000) throw new Error('미래의 통화일시는 입력할 수 없습니다. 통화일시와 기기 시계를 확인해 주세요.');
    await callDevice.start({ file, contact, recorded_at: recorded.toISOString() });
    onStarted(); onClose();
  }
  return <BottomSheet title="녹음파일 분석하기" visible onClose={onClose}>
    <Notice message="AI 분석은 기기에서 처리됩니다. 완료 후 통화 원문과 분석 결과가 내 계정에 저장됩니다. 원본 녹음은 서버에 업로드하지 않습니다." />
    {!model ? <Loading /> : !model.supported ? <Notice message="녹음파일 분석은 AI 기능을 지원하는 Nature 모바일 앱에서 사용할 수 있습니다. 여기서는 저장된 결과를 조회할 수 있습니다." /> : !model.installed ? <View style={s.card}><Text style={s.subtitle}>AI 기능 설치</Text><Notice message={`첫 사용 시 AI 기능을 설치합니다.${model.total_bytes > 0 ? ` 다운로드 크기: 약 ${(model.total_bytes / 1e9).toFixed(2)} GB.` : ''} Wi-Fi 환경을 권장합니다.`} />{model.downloading ? <><Loading /><Text accessibilityLiveRegion="polite" style={s.body}>다운로드 중… {(model.downloaded_bytes / 1e6).toFixed(0)} MB{model.total_bytes > 0 ? ` / ${(model.total_bytes / 1e6).toFixed(0)} MB` : ''}</Text></> : <SmsButton label={model.notice ? 'AI 기능 이어받기' : 'AI 기능 설치'} disabled={busy} onPress={() => void action(() => callDevice.install())} />}{model.notice ? <Notice message={model.notice} /> : null}{model.error ? <Notice error message={model.error} /> : null}</View> : null}
    <SmsButton label="통화파일 불러오기" secondary disabled={!model?.supported || busy} onPress={() => void action(async () => { const chosen = await callDevice.pickFile(); if (chosen) setFile(chosen); })} />
    {file ? <Text style={s.body}>{file.name} · {(file.size / 1e6).toFixed(1)} MB</Text> : <Text style={s.meta}>m4a, mp3, wav, aac, 3gp, ogg</Text>}
    <View style={s.row}><SmsButton label="수신자에서 선택" secondary={manual} onPress={() => setManual(false)} /><SmsButton label="직접 입력" secondary={!manual} onPress={() => setManual(true)} /></View>
    {manual ? <><TextField label="통화 상대 이름" value={name} onChangeText={setName} maxLength={100} /><TextField label="통화 상대 전화번호" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={30} /></> : <><TextField label="수신자 검색" value={query} onChangeText={setQuery} />{recipient ? <Text style={s.body}>선택: {recipient.name} · {formatPhone(recipient.phone)}</Text> : null}{recipients.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30).map((r) => <SmsButton key={r.id} label={`${r.name} · ${formatPhone(r.phone)}`} secondary={recipient?.id !== r.id} onPress={() => setRecipient(r)} />)}{recipients.length > 30 ? <Text style={s.meta}>최대 30명이 표시됩니다. 이름을 검색해 주세요.</Text> : null}</>}
    <TextField label="통화일시 (YYYY-MM-DD HH:mm)" value={date} onChangeText={setDate} placeholder="2026-09-17 14:20" maxLength={16} />
    <Text style={s.meta}>기기 현지 시간 기준으로 실제 통화일시를 입력해 주세요. 파일 생성일과 다를 수 있습니다.</Text>
    {error ? <Notice error message={error} /> : null}
    <SmsButton label={busy ? '준비 중…' : '분석하기'} disabled={busy || !model?.installed || !file || !date || (manual ? !name.trim() || !phone.trim() : !recipient)} onPress={() => void action(start)} />
    <Text style={s.meta}>분석 중 다른 화면으로 이동할 수 있습니다. 앱이 종료되면 다음 실행에서 저장된 단계부터 이어집니다.</Text>
  </BottomSheet>;
}
function localDate(date: Date) { const pad = (n: number) => String(n).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`; }

function normalizeCallPhone(value: string) {
  if (!/^[+\d()\s-]+$/.test(value.trim())) throw new Error('전화번호를 확인해 주세요.');
  const normalized = value.replace(/[()\s-]/g, '');
  if (!/^\+?\d{7,15}$/.test(normalized)) throw new Error('전화번호를 확인해 주세요.');
  return normalized;
}
