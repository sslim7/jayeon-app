import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { PasswordField } from '@/components/form-fields';
import { Notice, SmsButton, s } from '@/components/sms-ui';
import { readApiErrorMessage } from '@/lib/api-errors';
import { ApiError } from '@/lib/api';
import { useUserStore } from '@/store/user-store';
import { API_ERROR_CODE } from '@/types/api';

export function ProfileSheet({ onClose, onPassword }: { onClose: () => void; onPassword: () => void }) {
  const profile = useUserStore((state) => state.profile);
  const signOut = useUserStore((state) => state.signOut);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function leave() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try { await signOut(); }
    catch (cause) { setError(readApiErrorMessage(cause, {}, '로그아웃하지 못했어요. 다시 시도해 주세요.')); }
    finally { lock.current = false; setBusy(false); }
  }
  return <BottomSheet title="프로필" visible onClose={() => { if (!busy) onClose(); }}>
    <View style={s.card}>
      <Text style={s.meta}>이름</Text><Text selectable style={s.subtitle}>{profile?.userName || '내 계정'}</Text>
      <Text style={s.meta}>이메일</Text><Text selectable style={s.body}>{profile?.email || '프로필 정보를 불러오지 못했어요.'}</Text>
    </View>
    <SmsButton label="비밀번호 수정" disabled={busy} onPress={onPassword} />
    <SmsButton label={busy ? '로그아웃 중…' : '로그아웃'} secondary disabled={busy} onPress={() => void leave()} />
    {error ? <Notice error message={error} /> : null}
  </BottomSheet>;
}

const passwordErrors = {
  [API_ERROR_CODE.INVALID_CREDENTIALS]: '현재 비밀번호가 맞지 않아요',
  [API_ERROR_CODE.VALIDATION_FAILED]: '새 비밀번호가 규칙에 맞지 않아요',
  [API_ERROR_CODE.ACCOUNT_DISABLED]: '사용할 수 없는 계정이에요',
  [API_ERROR_CODE.INTERNAL_ERROR]: '서버 오류가 생겼어요. 잠시 후 다시 시도해 주세요',
};
function validationReasons(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => validationReasons(item, depth + 1)).slice(0, 5);
  if (value && typeof value === 'object') return validationReasons(Object.values(value), depth + 1);
  return [];
}

/** 강제 변경 화면과 동일한 스토어를 사용해 세션 폐기와 재로그인 안내를 유지한다. */
export function PasswordChangeSheet({ onClose }: { onClose: () => void }) {
  const changePassword = useUserStore((state) => state.changePassword);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reasons, setReasons] = useState<string[]>([]);
  const lock = useRef(false);
  const newRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  async function submit() {
    if (lock.current) return;
    setReasons([]);
    if (!currentPassword || !newPassword || !confirmPassword) { setError('세 칸을 모두 입력해 주세요'); return; }
    if (newPassword !== confirmPassword) { setError('새 비밀번호가 서로 달라요'); return; }
    // 길이와 문자 종류 정책은 기존 변경 화면처럼 서버 검증을 그대로 사용한다.
    lock.current = true;
    setBusy(true);
    setError('');
    try { await changePassword(currentPassword, newPassword); }
    catch (cause) {
      setError(readApiErrorMessage(cause, passwordErrors, '비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요'));
      setReasons(cause instanceof ApiError && cause.code === API_ERROR_CODE.VALIDATION_FAILED ? validationReasons(cause.details) : []);
    } finally { lock.current = false; setBusy(false); }
  }
  return <BottomSheet title="비밀번호 변경" visible onClose={() => { if (!busy) onClose(); }}>
    <Notice message="비밀번호를 바꾸면 로그아웃됩니다. 새 비밀번호로 다시 로그인해 주세요." />
    <PasswordField label="현재 비밀번호" value={currentPassword} onChangeText={setCurrentPassword} autoComplete="current-password" textContentType="password" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => newRef.current?.focus()} editable={!busy} />
    <PasswordField ref={newRef} label="새 비밀번호" value={newPassword} onChangeText={setNewPassword} autoComplete="new-password" textContentType="newPassword" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => confirmRef.current?.focus()} editable={!busy} />
    <PasswordField ref={confirmRef} label="새 비밀번호 확인" value={confirmPassword} onChangeText={setConfirmPassword} autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={() => void submit()} editable={!busy} />
    {error ? <Notice error message={error} /> : null}
    {reasons.map((reason, index) => <Notice key={`${index}-${reason}`} error message={reason} />)}
    <SmsButton label={busy ? '비밀번호 변경 중…' : '비밀번호 바꾸기'} disabled={busy} onPress={() => void submit()} />
  </BottomSheet>;
}
