/**
 * 로그인 — 이메일 + 비밀번호.
 *
 * # 이 화면에 없는 것들과 그 이유
 *
 * **가입 화면이 없다.** 「Nature」은 초대 전용 내부 서비스다. 계정은 서버 CLI 로 발급하고 임시
 * 비밀번호를 사람이 직접 전달한다 — 약관 동의도, 이메일 중복 확인도, 가입 경로도 없다.
 * 빠뜨린 것이 아니라 **만들지 않기로 한 것**이다.
 *
 * **비밀번호 찾기가 동작하지 않는다.** 재설정 메일을 보낼 경로가 아직 없어서 만들 수 없다.
 * 그래서 링크는 두되 누르면 안내만 띄운다 — 누르면 아무 일도 안 나는 버튼을 놓으면 사람은
 * 자기 손가락이나 앱을 의심하며 몇 번을 더 누른다.
 *
 * # 라우팅
 *
 * 이 화면은 **라우터를 부르지 않는다.** 로그인에 성공하면 스토어의 `stage` 가 올라가고,
 * 어느 화면을 세울지는 루트 레이아웃이 정한다(→ `app/_layout.tsx` 의 `Stack.Protected`).
 * 화면이 직접 목적지를 정하면 「비밀번호를 바꿔야 하는 사람」을 홈으로 보내는 갈래가 여기에도
 * 한 벌 생기고, 두 곳이 어긋나는 날 관문이 새는 쪽으로만 어긋난다.
 */

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

import { PasswordField, TextField } from '@/components/form-fields';
import { colors, fonts, layout, radii, spacing, text } from '@/constants/theme';
import { readApiErrorMessage } from '@/lib/api-errors';
import { useUserStore } from '@/store/user-store';
import { API_ERROR_CODE } from '@/types/api';

/**
 * 서버가 `message` 를 빠뜨렸을 때만 쓰는 예비 문구.
 *
 * 📌 **서버 문구를 우선 그대로 쓴다**(→ `lib/api-errors.ts`). 서버가 한국어 문장을 주기로 한
 * 이상, 화면이 코드마다 번역을 또 만들면 같은 실패에 **두 벌의 문구**가 생긴다. 아래는 그
 * 문장이 오지 않았을 때를 위한 것이지 번역본이 아니다.
 *
 * 🔴 `INVALID_CREDENTIALS` 를 「가입되지 않은 이메일이에요」로 갈라 쓰지 않는다. 서버는
 * 「없는 계정」과 「틀린 비밀번호」를 **일부러** 구분하지 않는다(→ `types/api.ts` 의
 * `API_ERROR_CODE`). 화면에서 갈라 말하면 서버가 감춘 것을 화면이 도로 흘리게 된다.
 */
const FALLBACK_BY_CODE = {
  [API_ERROR_CODE.INVALID_CREDENTIALS]: '이메일 또는 비밀번호가 맞지 않아요',
  [API_ERROR_CODE.ACCOUNT_DISABLED]: '사용할 수 없는 계정이에요',
  [API_ERROR_CODE.VALIDATION_FAILED]: '이메일과 비밀번호를 다시 확인해 주세요',
  [API_ERROR_CODE.INTERNAL_ERROR]: '서버 오류가 생겼어요. 잠시 후 다시 시도해 주세요',
};

const GENERIC_FAILURE = '로그인하지 못했어요. 잠시 후 다시 시도해 주세요';

export default function LoginScreen() {
  const signIn = useUserStore((s) => s.signIn);
  const authNotice = useUserStore((s) => s.authNotice);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  /*
   * 중복 제출 방어를 state 가 아니라 ref 로 한다.
   *
   * `setSubmitting(true)` 는 다음 렌더에서야 반영되므로, 같은 틱 안에 두 번 들어온 제출
   * (엔터를 연타하거나 엔터와 탭이 겹칠 때)은 **둘 다 `submitting === false` 를 보고
   * 통과한다.** 그러면 로그인 요청이 두 번 나가고, 그중 늦게 온 응답이 먼저 온 결과를
   * 덮어쓴다. ref 는 대입 즉시 보이므로 그 틈이 없다.
   */
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('이메일과 비밀번호를 모두 입력해 주세요');
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await signIn(trimmedEmail, password);
      // 성공했을 때 화면을 옮기는 일은 하지 않는다 — 머리말 「라우팅」 참고.
    } catch (err) {
      setError(readApiErrorMessage(err, FALLBACK_BY_CODE, GENERIC_FAILURE));
    } finally {
      /*
       * 🔴 **성공·실패를 가리지 않고 반드시 푼다.** 여기서 빠뜨리면 실패한 로그인 버튼이
       * 영원히 로딩 상태로 남고, 사용자는 앱을 껐다 켜는 것 말고 할 수 있는 일이 없다.
       * 성공한 경우에는 이 화면이 곧 사라지므로 이 대입이 보이지 않을 뿐이다.
       */
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      {/*
        키보드가 입력칸을 가리지 않게 한다. iOS 만 `padding` 인 이유는 안드로이드가
        `adjustResize` 로 창 자체를 줄여 주기 때문이다 — 양쪽에 다 걸면 안드로이드에서는
        줄어든 창을 한 번 더 밀어 올려 입력칸이 화면 밖으로 튄다.
      */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <Text style={styles.kicker}>NATURE</Text>
          <Text style={styles.title}>Nature</Text>
          <Text style={styles.subtitle}>초대받은 계정으로 로그인해 주세요.</Text>

          {authNotice ? (
            <View style={styles.helpBox} accessibilityRole="alert">
              <Text selectable style={styles.helpText}>
                {authNotice}
              </Text>
            </View>
          ) : null}

          <TextField
            label="이메일"
            value={email}
            onChangeText={(value) => setEmail(value)}
            placeholder="name@example.com"
            /*
              비밀번호 관리자가 채울 수 있게 한다. `autoComplete` 는 웹·안드로이드가,
              `textContentType` 은 iOS 가 읽는다 — 한쪽만 적으면 한쪽 플랫폼에서만 채워진다.
            */
            autoComplete="email"
            textContentType="username"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            // 엔터로 다음 칸까지 이어지게 한다. 손이 키보드를 떠나지 않아도 끝까지 간다.
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!submitting}
          />

          <PasswordField
            ref={passwordRef}
            label="비밀번호"
            value={password}
            onChangeText={(value) => setPassword(value)}
            placeholder="비밀번호"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            editable={!submitting}
          />

          {error ? (
            <Text selectable style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="로그인"
            accessibilityState={{ disabled: submitting, busy: submitting }}
            disabled={submitting}
            onPress={() => void submit()}
            style={[styles.cta, submitting && styles.ctaBusy]}>
            {submitting ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.ctaText}>로그인</Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="비밀번호를 잊으셨나요"
            accessibilityState={{ expanded: showHelp }}
            onPress={() => setShowHelp((prev) => !prev)}
            style={styles.helpLink}>
            <Text style={styles.helpLinkText}>비밀번호를 잊으셨나요?</Text>
          </Pressable>

          {showHelp ? (
            <View style={styles.helpBox}>
              <Text style={styles.helpText}>
                비밀번호를 직접 재설정하는 기능은 아직 없어요. 관리자에게 문의하시면 임시
                비밀번호를 다시 발급해 드려요.
              </Text>
            </View>
          ) : null}

          <Text style={styles.note}>
            「Nature」은 초대받은 사람만 쓰는 서비스라 가입 화면이 없어요.
          </Text>
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
    // 넓은 브라우저 창에서 입력칸이 지나치게 길어지지 않게 한다.
    maxWidth: layout.maxContentWidth,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxl,
  },
  kicker: { ...fonts.mono, fontSize: text.sm, letterSpacing: 2, color: colors.muted },
  title: { marginTop: spacing.xs, ...fonts.bodyBold, fontSize: text.h1, color: colors.ink },
  subtitle: {
    marginTop: spacing.sm,
    ...fonts.body,
    fontSize: text.md,
    lineHeight: 20,
    color: colors.mid,
  },
  error: {
    marginTop: spacing.md,
    ...fonts.bodyMedium,
    fontSize: text.md,
    lineHeight: 20,
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
  // 눌러도 소용없는 동안임을 보여 준다. 비활성만 걸고 모양이 그대로면 「먹통」으로 읽힌다.
  ctaBusy: { opacity: 0.7 },
  ctaText: { ...fonts.bodyBold, fontSize: text.md, color: colors.onInk },
  helpLink: { marginTop: spacing.lg, alignSelf: 'center', padding: spacing.xs },
  helpLinkText: { ...fonts.bodySemi, fontSize: text.base, color: colors.greenText },
  helpBox: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
  },
  helpText: { ...fonts.body, fontSize: text.base, lineHeight: 18, color: colors.mid },
  note: {
    marginTop: spacing.xl,
    ...fonts.body,
    fontSize: text.base,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
  },
});
