import { router, Stack, usePathname, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { NativeBootSplash } from '@/components/native-boot-splash';
import { AppNavigation } from '@/components/app-navigation';
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
  const stage = useUserStore((s) => s.stage);
  const bootstrap = useUserStore((s) => s.bootstrap);
  const pathname = usePathname();

  const authed = stage === 'authed';

  const ready = fontsReady && booted;
  const [nativeBootComplete, setNativeBootComplete] = useState(Platform.OS === 'web');
  const finishNativeBoot = useCallback(() => setNativeBootComplete(true), []);

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
   *
   * 📌 **조건이 `authed` 인 것이 곧 「인증까지만 네이티브」라는 결정이다.** 로그인과 비밀번호
   * 강제 변경은 껍데기 모드에서도 네이티브가 그린다 — 웹뷰는 그 뒤에야 뜬다. 웹뷰를 먼저
   * 열어 그 안에서 로그인하게 하면, 껍데기는 토큰을 주입해 줄 수도 되받을 수도 없는 상태로
   * 시작하게 된다(→ `config/env.ts` 의 `webShell`, `components/web-shell.tsx`).
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
    // 네이티브는 사진이 준비된 뒤 NativeBootSplash에서 시스템 화면을 걷는다.
    if (Platform.OS === 'web') SplashScreen.hideAsync().catch(() => {});
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
  if (!ready && Platform.OS === 'web') return null;

  return (
    // react-native-gesture-handler 의 제스처는 이 루트 뷰 안에서만 동작한다(웹 포함).
    <GestureHandlerRootView style={styles.root}>
      {/* 종이 바탕이라 상태바 글자는 어두워야 한다. */}
      <StatusBar style="dark" />
      {ready ? <>
      <AppNavigation enabled={authed && pathname !== '/shell' && !ENV.webShell}>
      <Stack
        screenOptions={{
          headerShown: false,
          /*
           * 화면 전환 중 잠깐 드러나는 바탕색이다. 기본값(흰색)으로 두면 종이색 화면 사이에
           * 흰 판이 스치는데, 밝은 화면끼리라 「깜빡였다」로만 보이고 원인이 잘 안 잡힌다.
           */
          contentStyle: { backgroundColor: colors.bg },
        }}>
        {/*
          🔴 **단계마다 스택에 남는 라우트 자체를 갈라 둔다.**

          `Stack.Protected` 는 guard 가 거짓인 화면을 내비게이션 상태에서 **아예 빼 버린다.**
          그래서 「가면 안 되는 화면으로 갔다가 되돌려 보내는」 리다이렉트와 달리, 그 화면에
          닿는 순간 자체가 없다 — 되돌리기 전의 한 프레임이 스치는 일도, 뒤로 가기로 다시
          들어가는 일도 없다.

          비밀번호 강제 변경이 실제로 이 차이에 기댄다: `password-change` 단계에서는 스택에
          그 화면 **하나뿐**이라 뒤로 나갈 곳이 없다. 화면 안에서 뒤로 가기를 막는 장치를
          따로 두지 않아도 되는 이유다(→ `app/change-password.tsx`).

          `change-password` 만 guard 가 `stage !== 'anonymous'` 인 것은, 이미 로그인한
          사람도 스스로 비밀번호를 바꿀 수 있어야 하기 때문이다(→ `app/index.tsx`).
        */}
        <Stack.Protected guard={stage === 'anonymous'}>
          <Stack.Screen name="login" />
        </Stack.Protected>

        {/* 일반 로그인 직후에는 첫 번째 허용 화면인 홈으로 들어간다. */}
        <Stack.Protected guard={authed}>
          <Stack.Screen name="index" />
          <Stack.Screen name="shell" />
          <Stack.Screen name="recipients" />
          <Stack.Screen name="sms" />
          <Stack.Screen name="templates" />
        </Stack.Protected>

        <Stack.Protected guard={stage !== 'anonymous'}>
          {/*
            강제 단계에서는 뒤로 밀어 닫는 제스처도 막는다. 스택에 돌아갈 화면이 없어 실제로
            닫히지는 않지만, 화면이 끌려갔다 제자리로 튀는 모습은 **눌리는 버튼이 없는데도
            반응하는** 것처럼 보여 사람을 계속 시도하게 만든다.
          */}
          <Stack.Screen name="change-password" options={{ gestureEnabled: authed }} />
        </Stack.Protected>
      </Stack>
      </AppNavigation>
      </> : null}
      {!nativeBootComplete ? <NativeBootSplash ready={ready} onFinished={finishNativeBoot} /> : null}
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
