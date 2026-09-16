import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ENV } from '@/config/env';
import { APP_VERSION } from '@/constants/app-meta';
import { colors, fonts, layout, radii, spacing, text } from '@/constants/theme';
import { useUserStore } from '@/store/user-store';

/**
 * 홈 — **아직 자리를 잡아 두는 화면이다.**
 *
 * 로그인한 사람이 자기 계정을 확인하고 나가거나 비밀번호를 바꿀 수 있는 것까지가 지금의 전부다.
 * 환경과 API 주소는 개발 환경에서만 보여 운영 화면에 구현 정보를 드러내지 않는다.
 *
 * 🔴 **껍데기 모드(네이티브 앱)에서는 이 화면이 보이지 않는다.** 인증이 끝나면 루트 레이아웃이
 * 곧장 `/shell` 로 보내고 그 뒤는 웹뷰가 그린다(→ `app/_layout.tsx`). 즉 여기 붙이는 것은
 * 사실상 **웹 화면**이다 — 네이티브에도 보여야 하는 것을 여기 붙이지 마라.
 *
 * 📌 이 파일은 **토큰을 쓰는 본보기**이기도 하다. 색·글꼴·크기·여백·둥글기를 한 군데도
 * 직접 적지 않았다 — 앞으로 만드는 화면도 그래야 한다(→ `constants/theme.ts` 머리말).
 */
export default function HomeScreen() {
  const profile = useUserStore((s) => s.profile);
  const signOut = useUserStore((s) => s.signOut);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>JAYEON</Text>
        <Text style={styles.title}>{profile?.userName || '자연'}</Text>
        <Text style={styles.subtitle}>{profile?.email || '로그인했어요.'}</Text>

        <View style={styles.card}>
          <Row label="버전" value={APP_VERSION || '—'} />
          {ENV.isDev ? (
            <>
              <Row label="환경" value={ENV.name} />
              <Row label="API" value={ENV.apiUrl} />
            </>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="비밀번호 변경"
          onPress={() => router.push('/change-password')}
          style={styles.secondary}>
          <Text style={styles.secondaryText}>비밀번호 변경</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="로그아웃"
          /*
            로그아웃 뒤에 화면을 옮기지 않는다. `stage` 가 anonymous 로 내려가면 루트 레이아웃이
            이 화면을 스택에서 걷어 간다(→ `app/_layout.tsx`).
          */
          onPress={() => void signOut()}
          style={styles.secondary}>
          <Text style={styles.secondaryText}>로그아웃</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

/** 라벨 + 값 한 줄. 값은 주소처럼 길어질 수 있어 남는 자리를 전부 준다. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    // 넓은 브라우저 창에서 한 줄이 지나치게 길어지지 않게 한다.
    maxWidth: layout.maxContentWidth,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxl,
  },
  kicker: {
    ...fonts.mono,
    fontSize: text.sm,
    letterSpacing: 2,
    color: colors.muted,
  },
  title: {
    marginTop: spacing.xs,
    ...fonts.bodyBold,
    fontSize: text.display,
    color: colors.ink,
  },
  subtitle: {
    marginTop: spacing.sm,
    ...fonts.body,
    fontSize: text.md,
    lineHeight: 20,
    color: colors.mid,
  },
  card: {
    marginTop: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowLabel: {
    ...fonts.bodySemi,
    fontSize: text.base,
    color: colors.muted,
    width: 48,
  },
  rowValue: {
    flex: 1,
    ...fonts.mono,
    fontSize: text.base,
    lineHeight: 18,
    color: colors.ink,
  },
  secondary: {
    marginTop: spacing.md,
    height: 50,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderPill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...fonts.bodySemi, fontSize: text.md, color: colors.mid },
});
