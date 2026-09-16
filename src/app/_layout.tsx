import { router, Stack, usePathname, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ErrorScreen } from '@/components/error-screen';
import { ENV } from '@/config/env';
import { colors } from '@/constants/theme';
import { useAppFonts } from '@/hooks/use-app-fonts';
import { hideBootSplash } from '@/lib/boot-splash';
import { postReadyToNative, setNativeNavigationHandler } from '@/lib/native-bridge';
import { useUserStore } from '@/store/user-store';

/**
 * 스플래시는 우리가 내린다. 부르지 않으면 expo-splash-screen 이 첫 프레임에 스스로 걷혀,
 * 폰트도 세션도 아직 없는 화면이 그대로 보인다.
 */
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // 네이티브는 TTF 를 `useFonts` 로, 웹은 CDN 폰트를 기다린다 —
  // 플랫폼별 구현은 `hooks/use-app-fonts(.web).ts` 에 있다.
  const fontsReady = useAppFonts();

  // 저장된 토큰으로 세션을 복구하기 전에는 로그인/홈 중 어디로 보낼지 알 수 없다.
  const booted = useUserStore((s) => s.booted);
  const authed = useUserStore((s) => s.stage === 'authed');
  const bootstrap = useUserStore((s) => s.bootstrap);
  const pathname = usePathname();

  const ready = fontsReady && booted;

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /**
   * 껍데기가 보낸 이동 요청을 라우터로 잇는다.
   *
   * 이 자리에 두는 이유는 `native-bridge` 가 컴포넌트가 아니어서다 — 모듈 로드 시점에는
   * 라우터가 아직 마운트 전이라 거기서 직접 부르면 호출이 조용히 사라진다. 루트 레이아웃이
   * 살아 있는 동안만 핸들러를 걸어 둔다.
   *
   * 네이티브에서는 브리지가 스텁이라 아무 일도 하지 않는다(→ `lib/native-bridge.ts`).
   */
  useEffect(() => {
    setNativeNavigationHandler(({ path }) => {
      /*
       * 경로가 런타임 문자열이라 타입을 단언한다. 껍데기가 보낸 값이라 컴파일 시점에
       * 알 수 없고, 앱 내부 경로인지는 브리지가 이미 확인했다(→ `native-bridge.web.ts`).
       * 없는 경로면 expo-router 가 not-found 로 보낸다 — 앱이 죽지는 않는다.
       */
      router.push(path as Parameters<typeof router.push>[0]);
    });
    return () => setNativeNavigationHandler(null);
  }, []);

  /**
   * 껍데기 모드 진입.
   *
   * 조건이 바뀌었을 때 **라우터가 알아서 어디론가 가 주기를 기대하지 않는다** — 대체 목적지는
   * 그때 스택에 남아 있는 라우트의 순서에 따라 달라져서, 인증 직후 엉뚱한 화면에 설 수 있다.
   * 목적지를 여기서 못 박아 두면 그 우연에 기대지 않아도 된다.
   */
  useEffect(() => {
    if (!ready) return;
    if (!authed || !ENV.webShell) return;
    if (pathname === '/shell') return;
    router.replace('/shell');
  }, [ready, authed, pathname]);

  useEffect(() => {
    if (!ready) return;
    /*
     * 🔴 **세 가지를 같은 조건으로 묶는다.** 한쪽만 먼저 걷히면 폰트가 아직 없는 화면이나
     * 로그인/홈이 정해지기 전 화면이 잠깐 보인다 — 「앱이 한 번 깜빡이고 다시 뜬다」로 읽히는
     * 그 증상이다. **폰트와 세션 복구가 끝난 그 순간이 곧 "보여도 되는 순간"**이다.
     *
     * - `SplashScreen.hideAsync()` : 네이티브의 진짜 스플래시
     * - `hideBootSplash()`         : 웹에서 `+html.tsx` 가 심은 부팅 스플래시(네이티브는 no-op)
     * - `postReadyToNative()`      : 껍데기가 웹뷰 위에 덮어 둔 로딩 판(껍데기 밖은 no-op)
     *
     * 마지막 것을 이보다 **먼저** 알리면 껍데기가 아직 준비 안 된 화면을 그대로 내보이고,
     * **늦게** 알리면 껍데기의 8초 폴백이 먼저 걷어 두 판이 어긋난다.
     */
    SplashScreen.hideAsync().catch(() => {});
    hideBootSplash();
    postReadyToNative();
  }, [ready]);

  /*
   * 폰트 로딩·세션 복구 전에는 아무것도 그리지 않는다.
   *
   * 웹에서는 이 `null` 구간이 곧 하얀 화면인데, `+html.tsx` 가 React 트리 **밖**에 심어 둔
   * 부팅 스플래시가 그 자리를 덮고 있다(→ `constants/boot-splash.ts`). 그래서 여기서 굳이
   * 로딩 화면을 그리지 않는다 — 그리면 스플래시 위에 또 한 겹이 얹혀 두 번 바뀐다.
   */
  if (!ready) return null;

  return (
    // react-native-gesture-handler 의 제스처는 이 루트 뷰 안에서만 동작한다(웹 포함).
    <GestureHandlerRootView style={styles.root}>
      {/* 종이 바탕이라 상태바 글자는 어두워야 한다. */}
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          /*
           * 화면 전환 중 잠깐 드러나는 바탕색이다. 기본값(흰색)으로 두면 종이색 화면 사이에
           * 흰 판이 스치는데, 밝은 화면끼리라 「깜빡였다」로만 보이고 원인이 잘 안 잡힌다.
           */
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

/**
 * 이 트리 어디서든 렌더 예외가 나면 그 자리에 서는 화면.
 *
 * **expo-router 의 규약이다** — 라우트 파일이 `ErrorBoundary` 를 내보내면 그 화면을 감싼다.
 * 루트 레이아웃에 두었으므로 앱 전체가 이 그물 안에 있다. 없으면 리액트가 트리를 통째로
 * 걷어내 **빈 화면**이 남는다.
 *
 * 로그로도 남긴다. 화면의 한 줄은 사용자가 찍어 보내 줄 때만 오지만, 로그는 웹뷰 콘솔과
 * 개발 서버에 그대로 찍혀 우리가 먼저 볼 수 있다.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  console.error('[error-boundary] 화면을 그리지 못했어요', error);
  return <ErrorScreen error={error} onRetry={() => void retry()} />;
}
