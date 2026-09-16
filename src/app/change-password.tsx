/**
 * 비밀번호 변경.
 *
 * 이 화면에 서는 길은 둘이다.
 *
 * 1. **강제** — 임시 비밀번호로 처음 들어온 사람(`stage === 'password-change'`). 여기서는
 *    다른 화면으로 나갈 수 없다. 나가는 길을 막는 것은 이 파일이 아니라 루트 레이아웃이다 —
 *    그 단계에서는 이 화면 말고 **스택에 아무 라우트도 없다**(→ `app/_layout.tsx`).
 * 2. **자발** — 이미 로그인한 사람(`stage === 'authed'`)이 홈에서 들어온 경우. 이쪽은 뒤로
 *    갈 수 있어야 한다.
 *
 * 📌 **강제로 들어온 사람에게는 왜 이 화면인지부터 말한다.** 아무 설명 없이 비밀번호부터
 * 물으면, 사람은 자기가 뭘 잘못 눌렀는지 혹은 계정이 잘못됐는지부터 의심한다. 「임시
 * 비밀번호라서」라는 한 줄이 그 의심을 없앤다.
 *
 * 📌 **로그아웃 길은 강제 단계에서도 열어 둔다.** 다른 사람의 계정으로 잘못 로그인했을 수
 * 있는데, 그때 나갈 길이 없으면 앱을 지우는 것 말고 방법이 없다.
 */

import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PasswordField } from '@/components/form-fields';
import { colors, fonts, layout, radii, spacing, text } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { readApiErrorMessage } from '@/lib/api-errors';
import { useUserStore } from '@/store/user-store';
import { API_ERROR_CODE } from '@/types/api';

/**
 * 서버가 `message` 를 빠뜨렸을 때만 쓰는 예비 문구(→ `lib/api-errors.ts`).
 *
 * 이 화면에서 `INVALID_CREDENTIALS` 는 **현재 비밀번호가 틀렸다**는 뜻이다. 같은 코드가
 * 로그인 화면에서는 「이메일 또는 비밀번호」를 가리키므로 문구가 다르다 — 코드 하나에 문구
 * 하나를 고정해 두지 않고 화면마다 고르는 이유가 이것이다.
 */
const FALLBACK_BY_CODE = {
  [API_ERROR_CODE.INVALID_CREDENTIALS]: '현재 비밀번호가 맞지 않아요',
  [API_ERROR_CODE.VALIDATION_FAILED]: '새 비밀번호가 규칙에 맞지 않아요',
  [API_ERROR_CODE.ACCOUNT_DISABLED]: '사용할 수 없는 계정이에요',
  [API_ERROR_CODE.INTERNAL_ERROR]: '서버 오류가 생겼어요. 잠시 후 다시 시도해 주세요',
};

const GENERIC_FAILURE = '비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요';

/** 한 번에 보여 줄 사유의 최대 개수. 많이 와도 화면을 덮지 않게 한다. */
const MAX_REASONS = 5;

/**
 * `VALIDATION_FAILED` 의 `details` 를 사람이 읽을 수 있는 줄들로 편다.
 *
 * 🔴 **모양을 모른 채 다룬다.** 서버는 「사유가 `details` 에 온다」까지만 약속했고, 그것이
 * 문자열 하나인지 배열인지 필드별 객체인지는 정하지 않았다. 한 모양만 가정하고 `.map` 이나
 * `.join` 을 부르면 다른 모양이 온 날 **이 화면이 통째로 렌더 예외로 죽는다** — 하필 사용자가
 * 규칙을 어겨 도움말이 가장 필요한 순간에. 그래서 어느 쪽이 와도 글자만 주워 낸다.
 *
 * 값이 객체일 때 키는 버리고 값만 쓴다. 키는 대개 서버 필드 이름(`newPassword` 같은)이라
 * 사용자에게는 읽을 거리가 되지 못한다.
 */
function flattenReasons(details: unknown): string[] {
  const out: string[] = [];

  const walk = (value: unknown, depth: number) => {
    if (out.length >= MAX_REASONS || depth > 4) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) out.push(trimmed);
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) walk(item, depth + 1);
    }
  };

  walk(details, 0);
  return out.slice(0, MAX_REASONS);
}

export default function ChangePasswordScreen() {
  const stage = useUserStore((s) => s.stage);
  const changePassword = useUserStore((s) => s.changePassword);
  const signOut = useUserStore((s) => s.signOut);

  const forced = stage === 'password-change';

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const newRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  /* 중복 제출 방어. state 가 아니라 ref 인 이유는 `app/login.tsx` 의 같은 주석에 있다. */
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current) return;

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('세 칸을 모두 입력해 주세요');
      setReasons([]);
      return;
    }

    /*
     * 확인 칸이 다른 것은 서버에 물어볼 일이 아니다 — 왕복 한 번과 그 사이의 기다림이 통째로
     * 낭비고, 서버는 애초에 확인 칸을 받지도 않는다.
     *
     * 반대로 **비밀번호 정책(길이·문자 종류)은 여기서 다시 검사하지 않는다.** 규칙을 아는
     * 곳은 서버 하나여야 한다. 여기 사본을 두면 서버가 규칙을 고친 날 앱만 옛 규칙으로 막아,
     * 서버가 받아 줄 비밀번호를 앱이 거절하는 상태가 된다.
     */
    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 서로 달라요');
      setReasons([]);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setReasons([]);
    try {
      await changePassword(currentPassword, newPassword);

      // 성공하면 스토어가 세션을 정리하고 로그인 화면에서 새 비밀번호 입력을 안내한다.
    } catch (err) {
      setError(readApiErrorMessage(err, FALLBACK_BY_CODE, GENERIC_FAILURE));
      setReasons(
        err instanceof ApiError && err.code === API_ERROR_CODE.VALIDATION_FAILED
          ? flattenReasons(err.details)
          : [],
      );
    } finally {
      // 성공·실패를 가리지 않고 푼다 — 버튼이 영원히 로딩에 남는 것을 막는다.
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  /**
   * 이 화면에서 나간다.
   *
   * 뒤로 갈 곳이 있을 때만 `back()` 이다. 홈에서 들어오지 않고(예: 웹에서 주소를 직접 친
   * 경우) 스택이 비어 있으면 `back()` 이 아무 일도 하지 않아 **버튼이 죽은 것처럼 보인다.**
   */
  const leave = () => {
    if (!router.canGoBack()) router.replace('/');
    else router.back();
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* 키보드가 입력칸을 가리지 않게 한다. 플랫폼 분기의 이유는 `app/login.tsx` 와 같다. */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <Text style={styles.kicker}>NATURE</Text>
          <Text style={styles.title}>비밀번호 변경</Text>

          {forced ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>임시 비밀번호로 로그인했어요</Text>
              <Text style={styles.noticeText}>
                전달받은 임시 비밀번호는 한 번 쓰고 바꾸는 값이에요. 새 비밀번호를 정해야
                앱을 쓸 수 있어요.
              </Text>
            </View>
          ) : (
            <Text style={styles.subtitle}>새로 쓸 비밀번호를 정해 주세요.</Text>
          )}

          <PasswordField
            label={forced ? '임시 비밀번호' : '현재 비밀번호'}
            value={currentPassword}
            onChangeText={(value) => setCurrentPassword(value)}
            placeholder={forced ? '전달받은 임시 비밀번호' : '현재 비밀번호'}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => newRef.current?.focus()}
            editable={!submitting}
          />

          <PasswordField
            ref={newRef}
            label="새 비밀번호"
            value={newPassword}
            onChangeText={(value) => setNewPassword(value)}
            placeholder="새 비밀번호"
            /*
              `new-password` 로 알려 주면 비밀번호 관리자가 **새 값을 제안하고 저장한다.**
              `current-password` 를 그대로 쓰면 옛 비밀번호가 채워져 들어간다.
            */
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => confirmRef.current?.focus()}
            editable={!submitting}
          />

          <PasswordField
            ref={confirmRef}
            label="새 비밀번호 확인"
            value={confirmPassword}
            onChangeText={(value) => setConfirmPassword(value)}
            placeholder="새 비밀번호 다시 입력"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            editable={!submitting}
          />

          {error ? (
            <View accessibilityRole="alert">
              <Text selectable style={styles.error}>
                {error}
              </Text>
              {reasons.map((reason, index) => (
                <Text key={`${index}-${reason}`} style={styles.reason}>
                  · {reason}
                </Text>
              ))}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="비밀번호 바꾸기"
            accessibilityState={{ disabled: submitting, busy: submitting }}
            disabled={submitting}
            onPress={() => void submit()}
            style={[styles.cta, submitting && styles.ctaBusy]}>
            {submitting ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.ctaText}>비밀번호 바꾸기</Text>
            )}
          </Pressable>

          {forced ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="로그아웃"
              accessibilityState={{ disabled: submitting }}
              disabled={submitting}
              onPress={() => void signOut()}
              style={styles.secondary}>
              <Text style={styles.secondaryText}>다른 계정으로 로그인</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="취소"
              accessibilityState={{ disabled: submitting }}
              disabled={submitting}
              onPress={leave}
              style={styles.secondary}>
              <Text style={styles.secondaryText}>취소</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: layout.maxContentWidth,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxl,
  },
  kicker: { ...fonts.mono, fontSize: text.sm, letterSpacing: 2, color: colors.muted },
  title: { marginTop: spacing.xs, ...fonts.bodyBold, fontSize: text.h2, color: colors.ink },
  subtitle: {
    marginTop: spacing.sm,
    ...fonts.body,
    fontSize: text.md,
    lineHeight: 20,
    color: colors.mid,
  },
  notice: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
  },
  noticeTitle: { ...fonts.bodySemi, fontSize: text.md, color: colors.ink },
  noticeText: {
    marginTop: 6,
    ...fonts.body,
    fontSize: text.base,
    lineHeight: 18,
    color: colors.mid,
  },
  error: {
    marginTop: spacing.md,
    ...fonts.bodyMedium,
    fontSize: text.md,
    lineHeight: 20,
    color: colors.red,
  },
  reason: {
    marginTop: spacing.xs,
    ...fonts.body,
    fontSize: text.base,
    lineHeight: 18,
    color: colors.red,
  },
  cta: {
    marginTop: spacing.xl,
    height: 50,
    borderRadius: 999,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBusy: { opacity: 0.7 },
  ctaText: { ...fonts.bodyBold, fontSize: text.md, color: colors.onInk },
  secondary: {
    marginTop: spacing.sm,
    height: 50,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderPill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...fonts.bodySemi, fontSize: text.md, color: colors.mid },
});
