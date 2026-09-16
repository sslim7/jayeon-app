/**
 * 화면을 그리다 예외가 났을 때 그 자리에 서는 화면.
 *
 * # 왜 필요한가
 *
 * 리액트는 렌더 도중 예외가 나면 **그 트리를 통째로 걷어낸다.** 잡아 주는 것이 없으면 남는
 * 것은 빈 화면이고, 사용자가 할 수 있는 말은 「앱이 죽었어요」뿐이다. 어디서 무엇 때문에
 * 죽었는지는 우리 쪽에 아무것도 남지 않는다.
 *
 * expo-router 는 라우트 파일이 `ErrorBoundary` 를 내보내면 그 화면을 감싸 준다. 이 컴포넌트는
 * 그 자리에 그릴 그림이다(→ `app/_layout.tsx` 의 `ErrorBoundary`).
 *
 * # 무엇을 보여 주는가
 *
 * **오류 문구를 숨기지 않는다.** 사용자에게 읽히는 말은 아니지만, 그 한 줄을 찍어 보내 주는
 * 것이 우리가 얻는 유일한 단서다. 스택은 싣지 않는다 — 화면만 채우고 사진으로 옮겨지지 않는다.
 */

import { router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, radii, spacing, text } from '@/constants/theme';
import { hideBootSplash } from '@/lib/boot-splash';
import { postReadyToNative } from '@/lib/native-bridge';

export function ErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const insets = useSafeAreaInsets();

  /*
   * **덮고 있는 것들을 여기서도 걷는다.**
   *
   * 스플래시를 내리는 곳은 루트 레이아웃의 effect 하나뿐인데, expo-router 는 루트
   * 레이아웃째로 오류 경계에 감싼다. **첫 렌더에서 예외가 나면 그 레이아웃이 커밋되지 못한
   * 채 이 화면으로 갈리고, 그 effect 는 영영 돌지 않는다.** 오류 화면은 멀쩡히 그려져 있는데
   * 그 위를 스플래시가 덮고 있어 여전히 빈 화면으로 보인다 — 이 장치가 노린 바로 그 자리에서만
   * 안 보이게 되는 셈이다.
   *
   * 껍데기(웹뷰)에게도 알린다. 그쪽은 웹이 준비됐다고 말할 때까지 로딩 판을 덮고 있어서,
   * 알리지 않으면 네이티브 앱에서는 이 화면조차 가려진다.
   */
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    hideBootSplash();
    postReadyToNative();
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>화면을 그리지 못했어요</Text>
        <Text style={styles.body}>이 화면에서 예상하지 못한 문제가 났어요.</Text>

        {/*
          단서 한 줄. 개발자에게 보내려고 두는 것이라 사람 말로 옮기지 않는다 — 옮기면
          원문이 사라져 무엇이 났는지 알 수 없게 된다.
        */}
        {error?.message ? (
          <View style={styles.reason}>
            <Text style={styles.reasonLabel}>이 글을 그대로 보내 주시면 도움이 돼요</Text>
            <Text style={styles.reasonText} selectable>
              {error.message}
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="다시 시도"
          onPress={onRetry}
          style={styles.cta}>
          <Text style={styles.ctaText}>다시 시도</Text>
        </Pressable>

        {/*
          나갈 길. **`retry` 만 두면 갇힌다** — 항상 나는 문제면 다시 그려도 같은 화면이라
          앱을 껐다 켜는 것 말고 방법이 없다.

          🔴 **웹에서는 라우터로 옮기지 않고 문서를 다시 띄운다.** 라우터 이동은 같은 페이지
          안의 이동이라 메모리에 남은 것이 그대로 남는다. 원인이 화면 하나가 아니라 앱 전체가
          쓰는 무언가에 있으면 홈도 같은 자리에서 다시 터지고, 누르는 사람에게는 **버튼이 죽은
          것처럼 보인다**(형제 프로젝트에서 실제로 그렇게 겪었다 →
          `birdieup-app/src/components/error-screen.tsx`). 문서를 새로 띄우면 모듈 상태가
          통째로 새로 시작하므로, 아래 「앱을 껐다 열어 주세요」를 대신 눌러 주는 셈이 된다.

          네이티브에는 다시 띄울 문서가 없다. 거기서는 라우터 이동이 할 수 있는 전부다.

          이동이 실패해도(내비게이터까지 함께 죽은 경우) 삼키고 다시 그리기로 되돌린다 —
          나가려다 두 번째 오류를 내면 이 화면조차 못 그린다.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="처음 화면으로"
          onPress={() => {
            try {
              if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
                window.location.replace('/');
                return;
              }
              router.replace('/');
            } catch {
              onRetry();
            }
          }}
          style={styles.secondary}>
          <Text style={styles.secondaryText}>처음 화면으로</Text>
        </Pressable>

        <Text style={styles.note}>둘 다 같으면 앱을 껐다 열어 주세요.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: 32,
  },
  title: { ...fonts.bodyBold, fontSize: text.h2, color: colors.ink, textAlign: 'center' },
  body: {
    marginTop: 10,
    ...fonts.body,
    fontSize: text.md,
    lineHeight: 22,
    color: colors.mid,
    textAlign: 'center',
  },
  reason: {
    marginTop: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  reasonLabel: { ...fonts.body, fontSize: text.sm, color: colors.muted },
  reasonText: {
    marginTop: 6,
    ...fonts.mono,
    fontSize: text.base,
    lineHeight: 18,
    color: colors.ink,
  },
  cta: {
    marginTop: spacing.xxl,
    height: 50,
    borderRadius: 999,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  note: {
    marginTop: 10,
    ...fonts.body,
    fontSize: text.base,
    color: colors.muted,
    textAlign: 'center',
  },
});
