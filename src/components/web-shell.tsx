/**
 * 네이티브 껍데기의 본체 — 웹뷰로 `ENV.webUrl` 을 띄운다.
 *
 * 이 앱은 **대부분 웹으로 동작하고 일부만 네이티브로 구현한다.** 인증까지만 네이티브가 그리고
 * 그 뒤 화면은 전부 웹이 그린다 — 화면을 두 벌 만들지 않겠다는 결정이라, 껍데기가 하는 일은
 * 화면이 아니라 **배관**이다: 저장해 둔 토큰을 페이지가 뜨기 전에 심어 주고, 웹이 토큰을
 * 갱신하면 되받아 저장하고, 바깥으로 나가는 링크는 웹뷰 밖으로 내보낸다.
 *
 * 웹 쪽 짝은 `@/lib/native-bridge(.web).ts` 다. 프로토콜(주입 키 이름, 메시지 모양)은 두
 * 파일이 함께 지켜야 하므로 **한쪽만 고치지 마라.**
 *
 * 웹 빌드에서는 `web-shell.web.tsx` 의 스텁이 대신 선택된다.
 */

import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { ENV } from '@/config/env';
import { APP_VERSION } from '@/constants/app-meta';
import { colors, fonts, radii, text } from '@/constants/theme';
import { PASSWORD_CHANGED_NOTICE, useUserStore } from '@/store/user-store';
import { getStoredTokens, isStoredTokens, saveTokens, type StoredTokens } from '@/lib/auth-tokens';
import { handleSmsRequest, type SmsShellRequest } from '@/lib/sms-shell-handler';
import { startCallService } from '@/lib/call-runtime';
import { SHELL_NATIVE_ROUTES, shellNavigateTarget } from '@/lib/shell-routes';

/**
 * 웹이 토큰을 읽는 localStorage 키. `@/lib/auth-tokens` 의 `KEY` 와 **같은 값이어야 한다.**
 *
 * 그 파일에서 export 해 오지 않고 여기 다시 적은 것은, 이 문자열이 앱 안의 저장 키가 아니라
 * **껍데기와 웹 사이의 프로토콜**이기 때문이다. 껍데기는 자기보다 새 웹 빌드를 열 수도 있고
 * 그 반대일 수도 있어서, 한쪽이 저장 방식을 바꾼다고 다른 쪽이 조용히 따라 움직이면 안 된다.
 */
// 브랜드 변경으로 기존 로그인 저장소를 잃지 않도록 프로토콜 키는 유지한다.
const TOKENS_KEY = 'jayeon.tokens';

/**
 * `ready` 가 끝내 오지 않을 때 로딩 판을 강제로 걷는 시간.
 *
 * 🔴 **판이 안 걷히는 것이 가장 나쁘다.** 브리지가 없는 옛 웹 빌드(캐시에 남은 정적 파일,
 * 롤백된 배포)를 열면 `ready` 가 아예 오지 않는데, 그때 판이 영영 남으면 사용자가 보는 것은
 * 빈 화면뿐이고 그 뒤에서 멀쩡히 그려진 앱은 손에 닿지 않는다 — **사용자가 갇힌다.**
 * 조금 이르게 걷혀 그리는 중인 화면이 잠깐 보이는 편이 낫다.
 *
 * 웹의 부팅 스플래시 폴백과 같은 값이다(→ `constants/boot-splash.ts`). 둘이 같은 상황을
 * 막는 장치라 서로 다른 시간을 쓸 이유가 없다.
 */
const READY_FALLBACK_MS = 8000;

/** 주소를 오리진과 그 뒤(경로·쿼리·해시)로 가른 결과. */
type UrlParts = { origin: string; rest: string };

/**
 * 주소를 `scheme://authority` 와 나머지로 가른다. **읽기 애매하면 통과시키지 않고 `null` 이다.**
 *
 * `new URL()` 을 쓰지 않는다 — RN 의 URL 은 폴리필이라 `origin`·`pathname` 을 돌려주지 않고,
 * 여기서 필요한 것은 `scheme://host[:port]` 를 잘라내는 일뿐이다.
 *
 * **관대한 파서는 여기서 위험하다.** 이 결과가 곧 「우리 주소인가」의 판정이고, 그 판정이
 * **토큰이 심긴 웹뷰에 무엇을 띄울지**를 정한다. 애매하면 받아 주는 대신 버린다.
 */
function splitUrl(url: string): UrlParts | null {
  // 공백·제어문자가 섞인 주소는 버린다. 파서마다 다르게 잘라 읽어 우회에 쓰이는 자리다.
  if (!url || /[\u0000-\u0020\u007f]/.test(url)) return null;
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([\s\S]*)$/i.exec(url);
  if (!match) return null;
  const [, scheme, authority, rest] = match;
  /*
   * `user:pass@host` 형태는 통째로 버린다. `https://nature.redhead.kr@evil.com/` 은 사람 눈에
   * 우리 주소로 읽히지만 실제 목적지는 `evil.com` 이다 — 아래 오리진 비교로도 걸러지지만,
   * 이런 모양을 우리가 해석해 줄 이유가 없다.
   */
  if (authority.includes('@')) return null;
  return { origin: `${scheme}://${authority}`.toLowerCase(), rest };
}

/**
 * 껍데기가 여는 오리진. `ENV.webUrl` 은 끝 슬래시가 이미 떼여 있다(→ `config/env.ts`).
 *
 * 가르지 못하는 값이면 원본을 그대로 둔다 — 그 경우 아래 비교가 전부 어긋나 모든 링크가
 * 바깥으로 판정되는데, 껍데기가 자기 사이트조차 못 여는 것보다는 조용히 보수적인 편이 낫다.
 */
const WEB_ORIGIN = splitUrl(ENV.webUrl)?.origin ?? ENV.webUrl.toLowerCase();

/**
 * 껍데기가 연 사이트 안의 주소인가.
 *
 * **오리진이 정확히 같아야 한다.** 접두사 비교로 때우면 `https://nature.redhead.kr.evil.com`
 * 이 그대로 통과한다. 기본 포트를 굳이 적은 주소(`https://nature.redhead.kr:443`)도 여기서는
 * 남으로 본다 — 받아 주는 폭을 넓히는 것보다 좁게 두고 버리는 편이 안전하고, 웹뷰가 그런
 * 모양으로 주소를 만들지도 않는다.
 */
function isShellOrigin(url: string): boolean {
  return splitUrl(url)?.origin === WEB_ORIGIN;
}

/** 오리진만 있는 주소와 `?`·`#` 로 시작하는 나머지는 홈에 붙인다. */
function restToPath(rest: string): string {
  return rest.startsWith('/') ? rest : '/' + rest;
}

/**
 * 앱을 깨우는 커스텀 스킴. `app.json` 의 `expo.scheme` 과 같아야 한다.
 *
 * 값을 두 곳에 적는 것이 마음에 걸리지만, 여기서 `app.json` 을 읽어 올 수는 없다 —
 * 어긋나면 **앱은 깨어나는데 껍데기가 못 알아들어 홈이 뜬다.** 스킴을 바꾸는 날 이 줄을
 * 함께 고쳐라.
 */
const APP_SCHEME = 'nature';

/**
 * 앱을 깨운 주소를 웹의 경로로 바꾼다. 우리 것이 아니면 `null`.
 *
 * 받아 주는 모양은 둘이다 — 우리 오리진의 https 주소(App Link)와 `nature://...`(커스텀 스킴).
 * **그 밖에는 전부 버린다.** 여기서 나온 값이 그대로 웹뷰의 주소가 되는데, 이 웹뷰는 로그인
 * 토큰이 심긴 창이다. 아무 앱이나 우리를 임의의 주소로 깨울 수 있으므로 좁게 받는다.
 */
function linkToPath(url: string): string | null {
  const parts = splitUrl(url);
  if (!parts) return null;
  if (parts.origin === WEB_ORIGIN) return restToPath(parts.rest);
  const prefix = `${APP_SCHEME}://`;
  if (!parts.origin.startsWith(prefix)) return null;
  // `nature://home/x` 는 authority 가 `home` 이다 — 경로의 첫 마디로 되돌린다.
  return restToPath(parts.origin.slice(prefix.length) + parts.rest);
}

/** 웹이 껍데기에 보내는 말. `native-bridge.web.ts` 의 `OutboundMessage` 와 1:1 이다. */
type ShellMessage =
  | SmsShellRequest
  | { type: 'ready' }
  | { type: 'tokens'; tokens: StoredTokens | null; reason?: 'password-changed' }
  /*
   * 「이 네이티브 화면을 열어 달라」. 웹뷰 안의 웹은 whisper 도 파일 선택기도 쓸 수 없어서,
   * 그 화면들로 가는 길은 이 한마디뿐이다(→ `lib/native-bridge.web.ts` 의 `openNativeScreen`).
   * 🔴 여는 화면은 아래 `case 'navigate'` 의 **허용 목록**이 정한다.
   */
  | { type: 'navigate'; path: string };

/**
 * 페이지가 뜨기 전에 웹뷰에 심는 스크립트.
 *
 * 🔴 **웹의 JS 가 한 줄이라도 돌기 전에 끝나야 한다.** 로드 후에 넣으면 웹이 이미 「토큰
 * 없음」으로 판정을 마친 뒤라 로그인 화면이 한 번 스쳐 지나간다.
 *
 * 안드로이드는 이 스크립트를 `onPageStarted` 시점에 돌린다. DOM 은 아직 없다고 봐야 하므로
 * 여기서는 전역과 localStorage 만 건드린다.
 */
function buildInjectedScript(tokens: StoredTokens | null): string {
  /*
   * 🔴 **껍데기가 자기 능력을 스스로 밝힌다.** 웹은 배포하면 즉시 새것이 되지만 껍데기는
   * 스토어를 거치므로 「옛 껍데기가 새 웹을 연다」가 정상적으로 존재하는 조합이고, 그 껍데기는
   * 모르는 화면 요청을 로그 한 줄 남기고 버린다. 웹이 그것을 모른 채 입구를 세우면 사용자는
   * **눌러도 아무 일이 없는 메뉴**를 보게 된다 — 고장으로 읽히는 그 상태다.
   * 열 수 있는 화면을 여기 실어 보내면, 옛 껍데기에서는 그 입구가 아예 서지 않는다
   * (→ `lib/native-bridge.web.ts` 의 `nativeShellCanOpen`).
   */
  const nativeInfo = JSON.stringify({
    platform: Platform.OS,
    appVersion: APP_VERSION,
    smsApiVersion: 1,
    navigateRoutes: SHELL_NATIVE_ROUTES,
  });

  /*
   * **`JSON.stringify` 를 두 번 쓴다.** 한 번은 토큰셋 → JSON 문자열(웹이 그대로 저장해 읽을
   * 값), 또 한 번은 그 문자열 → JS 문자열 리터럴이다. 안쪽 값에 따옴표나 백슬래시가 들어
   * 있어도(지금의 JWT 는 base64url 이라 없지만, 토큰 형식은 서버 사정이다) 주입 스크립트가
   * 깨지지 않는다. 문자열을 손으로 이어 붙이면 그런 날 **로그인이 통째로 막힌다.**
   */
  const setTokens = tokens
    ? `window.localStorage.setItem(${JSON.stringify(TOKENS_KEY)}, ${JSON.stringify(
        JSON.stringify(tokens),
      )});`
    : `window.localStorage.removeItem(${JSON.stringify(TOKENS_KEY)});`;

  /*
   * 전체를 즉시실행함수로 감싸고 단계마다 try/catch 를 둔다. 이 스크립트가 예외를 던지면
   * 웹뷰는 **페이지 로드 자체를 멈춘다** — 토큰을 못 심는 것(로그인 화면으로 떨어짐)보다
   * 하얀 화면이 훨씬 나쁘다. 저장소 접근이 막힌 환경(사생활 모드 등)도 여기 걸린다.
   *
   * 마지막 줄의 `true;` 는 장식이 아니다. react-native-webview 는 주입 스크립트의 마지막
   * 표현식 값을 브리지로 넘기는데, 값이 없으면 iOS 가 경고를 뱉는다(공식 문서가 명시한다).
   */
  return `(function () {
  try { window.__NATURE_NATIVE__ = ${nativeInfo}; window.__JAYEON_NATIVE__ = window.__NATURE_NATIVE__; } catch (e) {}
  try { ${setTokens} } catch (e) {}
})();
true;`;
}

/**
 * 실행 중인 웹에 「이 경로로 가라」고 보내는 스크립트. `native-bridge.web.ts` 의 `receive`
 * 가 받는다(→ 그쪽의 `navigate` 처리).
 *
 * 주소를 갈아 끼우지 않고 브리지로 보내는 이유는 **웹의 상태를 버리지 않기 위해서다** —
 * `location.replace` 는 페이지를 다시 로드하므로 번들 평가부터 세션 복구까지 전부 처음부터
 * 다시 한다. 앱이 이미 떠 있는데 링크를 눌렀다고 몇 초를 기다리게 할 이유가 없다.
 *
 * 브리지가 없는 옛 웹 빌드에서는 이 호출이 조용히 실패한다(try/catch). 그 경우 링크가
 * 사라지는 셈이라, 브리지를 못 믿어야 하는 상황이 실제로 생기면 그때는 주소를 갈아 끼우는
 * 길로 떨어뜨려야 한다(형제 프로젝트가 그 갈래를 갖고 있다 →
 * `birdieup-app/src/components/web-shell.tsx` 의 `buildLocationScript`).
 */
function buildNavigateScript(path: string): string {
  const message = JSON.stringify(JSON.stringify({ type: 'navigate', path }));
  return `(function () {
  try { (window.__NATURE_NATIVE_BRIDGE__ || window.__JAYEON_NATIVE_BRIDGE__).receive(${message}); } catch (e) {}
})();
true;`;
}

export function WebShell() {
  const insets = useSafeAreaInsets();
  // 웹이 보낸 navigate 를 받아 네이티브 화면을 연다(→ 아래 `case 'navigate'`).
  const router = useRouter();
  useEffect(() => { startCallService(); }, []);
  const ref = useRef<WebView>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 페이지 로드가 한 번이라도 끝났는가. 아직이면 이동 요청을 보내도 받을 사람이 없다. */
  const loadedRef = useRef(false);
  /** 로드 전에 도착한 이동 요청. 로드가 끝나는 순간 흘려보낸다. */
  const pendingPathRef = useRef<string | null>(null);

  /**
   * 웹뷰 히스토리를 한 칸 물릴 수 있는가. 뒤로가기 핸들러가 읽는다.
   *
   * state 가 아니라 ref 다 — 화면에 그리는 값이 아니고, 웹 안에서 이동할 때마다 바뀌는데
   * 그때마다 껍데기 전체를 다시 그릴 이유가 없다.
   */
  const canGoBackRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // 컴포넌트가 사라진 뒤 타이머가 상태를 건드리지 않게 정리한다.
  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    };
  }, []);

  /**
   * 앱을 깨운 링크를 웹뷰에 전한다.
   *
   * 📌 **첫 주소로 넣지 않고 이동 요청으로 보내는 이유.** 콜드 스타트 링크는 `getInitialURL`
   * 로 오는데, 그 시점에는 이미 `ENV.webUrl` 이 로드되기 시작한 뒤다. 거기서 첫 주소를
   * 바꾸면 페이지가 한 번 더 로드되어 **사용자는 화면이 두 번 바뀌는 것을 본다.**
   * 로드가 끝난 뒤 브리지로 보내면 웹이 라우터로 옮겨 준다.
   *
   * 로드 전에 온 것은 쌓아 뒀다가 `onLoadEnd` 에서 흘려보낸다 — 이 큐가 없으면 **링크로 연
   * 첫 실행만** 이동이 통째로 사라진다. 웹 쪽에도 같은 이유의 큐가 하나 더 있다
   * (→ `lib/native-bridge.web.ts`): 페이지 로드가 끝났다고 React 트리까지 준비된 것은 아니다.
   */
  useEffect(() => {
    const handle = (url: string) => {
      const path = linkToPath(url);
      if (!path) return;
      if (!loadedRef.current) {
        pendingPathRef.current = path;
        return;
      }
      ref.current?.injectJavaScript(buildNavigateScript(path));
    };

    void Linking.getInitialURL().then((url) => {
      if (url) handle(url);
    });
    const sub = Linking.addEventListener('url', (event) => handle(event.url));
    return () => sub.remove();
  }, []);

  /**
   * 안드로이드 하드웨어 뒤로가기.
   *
   * 핸들러가 없으면 뒤로가기가 곧바로 시스템에 넘어가 **어느 화면에서 누르든 앱이 닫힌다.**
   * 모든 화면이 웹뷰 안에 있으니 네이티브 내비게이션 스택에는 물릴 것이 없고, 사용자가
   * 기대하는 「이전 화면」은 웹뷰의 히스토리다. 그래서 웹뷰가 뒤로 갈 수 있으면 한 칸 물리고
   * `true`, 못 가면 `false` 로 시스템에 넘긴다 — 첫 화면에서 누르면 앱이 닫히는 것이
   * 안드로이드의 기본 기대다.
   *
   * 📌 **웹은 expo-router SPA 라 이동이 `history.pushState` 로만 일어난다.** 페이지 로드가 없어도
   * 안드로이드 웹뷰는 `doUpdateVisitedHistory` 를 부르고, react-native-webview(13.16.1)는
   * 거기서 `canGoBack` 을 실은 loadingStart 이벤트를 쏘아 `onNavigationStateChange` 까지
   * 올려 보낸다(→ `RNCWebViewClient.java`). 그래서 아래 `onNavigationStateChange` 만으로
   * SPA 이동도 따라간다.
   *
   * 웹의 ☰ 메뉴(`app-navigation.tsx`)도 BackHandler 를 걸지만 그건 **웹뷰 안의 웹 번들**이라
   * 여기 네이티브 핸들러와 섞이지 않는다(웹의 BackHandler 는 아무 일도 하지 않는다).
   * 메뉴가 열린 채로 뒤로가기를 누르면 이전 화면으로 가고, 메뉴는 경로가 바뀌며 닫힌다.
   */
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBackRef.current || !ref.current) return false;
      ref.current.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  /** `ready` 가 오지 않을 때 판을 걷을 안전장치. 이미 걸려 있으면 그대로 둔다. */
  function armReadyFallback() {
    if (fallbackTimerRef.current) return;
    fallbackTimerRef.current = setTimeout(() => {
      fallbackTimerRef.current = null;
      setLoading(false);
    }, READY_FALLBACK_MS);
  }

  function revealContent() {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    setLoading(false);
  }

  function handleMessage(raw: string) {
    let message: ShellMessage;
    // 웹이 보낸 원문에 상한을 둔다. 브리지 입력은 그대로 파싱되므로 크기를 재지 않으면 메모리를 그만큼 먹는다.
    if (typeof raw !== 'string' || raw.length > 64 * 1024) {
      console.warn('[web-shell] 웹 메시지 크기 초과');
      return;
    }
    try {
      message = JSON.parse(raw) as ShellMessage;
    } catch {
      console.warn('[web-shell] 웹 메시지 형식 오류');
      return;
    }
    switch (message?.type) {
      case 'sms':
        void handleSmsRequest(message).then((reply) => {
          ref.current?.injectJavaScript(`(window.__NATURE_SMS_BRIDGE__ || window.__JAYEON_SMS_BRIDGE__)?.receive(${JSON.stringify(reply)}); true;`);
        });
        return;
      case 'ready':
        revealContent();
        return;
      case 'navigate': {
        // 🔴 웹이 준 경로를 그대로 router 에 넘기지 않는다. 웹뷰가 여는 페이지는 바깥
        // 서버가 주는 것이라, 임의 경로를 받으면 껍데기의 아무 화면이나 열 수 있는
        // 통로가 된다. 열 수 있는 화면과 파라미터는 **허용 목록**이 정한다
        // (→ `lib/shell-routes.ts`).
        const target = shellNavigateTarget(message.path);
        if (!target) {
          // 조용히 삼키지 않는다 — 「눌렀는데 아무 일도 없다」를 쫓을 단서가 이 한 줄뿐이다.
          console.warn('[web-shell] 허용 목록에 없는 화면 요청');
          return;
        }
        if (target.params) router.push({ pathname: target.path, params: target.params });
        else router.push(target.path);
        return;
      }
      case 'tokens':
        // null은 명시적 로그아웃/자격 만료일 때만 전송된다. 일시 복구 장애는 토큰을 보존한다.
        if (message.tokens === null) {
          void useUserStore.getState().signOut();
          if (message.reason === 'password-changed') {
            useUserStore.setState({ authNotice: PASSWORD_CHANGED_NOTICE });
          }
        } else if (isStoredTokens(message.tokens)) void saveTokens(message.tokens);
        return;
      default:
        console.warn('[web-shell] 지원하지 않는 메시지');
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <WebView
        ref={ref}
        source={{ uri: ENV.webUrl + '/' }}
        originWhitelist={['https://*', 'http://*']}
        injectedJavaScriptBeforeContentLoaded={buildInjectedScript(getStoredTokens())}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        allowsInlineMediaPlayback
        // 사진 업로드의 파일 선택기가 고른 파일을 읽으려면 필요하다.
        allowFileAccess
        /*
         * 끄지 않으면 `target="_blank"` 링크가 `onShouldStartLoadWithRequest` 를 타지 않고
         * 새 창 요청으로 빠져 **아무 일도 일어나지 않는다** — 사용자는 링크가 죽은 줄 안다.
         * 끄면 그 링크도 같은 웹뷰의 이동 요청이 되어 아래 필터가 바깥 브라우저로 넘겨 준다.
         */
        setSupportMultipleWindows={false}
        // 당겨서 새로고침·오버스크롤은 끈다. 웹이 자체 스크롤 UI 를 그리는데 겹치면 튄다.
        pullToRefreshEnabled={false}
        overScrollMode="never"
        cacheEnabled
        // 서버와 웹이 「껍데기 안에서 열렸다」를 UA 만으로도 알아볼 수 있게 한다.
        applicationNameForUserAgent={'NatureApp/' + APP_VERSION}
        // 메모리 압박으로 웹 콘텐츠 프로세스가 죽으면 하얀 화면만 남는다. 조용히 다시 띄운다.
        onContentProcessDidTerminate={() => ref.current?.reload()}
        onMessage={(event) => {
          if (isShellOrigin(event.nativeEvent.url)) handleMessage(event.nativeEvent.data);
        }}
        // 뒤로가기 판단용(→ 위 `hardwareBackPress` 설명). pushState 이동에서도 불린다.
        onNavigationStateChange={(navState) => {
          canGoBackRef.current = navState.canGoBack;
        }}
        onLoadEnd={() => {
          loadedRef.current = true;
          const pending = pendingPathRef.current;
          if (pending) {
            pendingPathRef.current = null;
            ref.current?.injectJavaScript(buildNavigateScript(pending));
          }
          // `ready` 를 기다리되 영원히는 아니다(→ `READY_FALLBACK_MS`).
          armReadyFallback();
        }}
        onError={() => {
          setFailed(true);
          setLoading(false);
        }}
        /*
         * 웹뷰는 **메인 문서의** HTTP 오류만 여기로 올린다(이미지·API 같은 하위 요청은
         * 아니다). 그래서 여기 걸린다는 것은 앱이 통째로 안 열렸다는 뜻이라 오류 화면을
         * 세워도 된다.
         */
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode < 400) return;
          setFailed(true);
          setLoading(false);
        }}
        onShouldStartLoadWithRequest={(request) => {
          const url = request.url;
          /*
           * **첫 로드를 막지 않도록** 통과 조건을 먼저 본다. `about:blank` 와 `data:` 는
           * 웹뷰가 스스로 만드는 중간 상태라 막으면 페이지가 시작조차 못 한다.
           */
          if (!url || url === 'about:blank' || url.startsWith('data:')) return true;
          if (isShellOrigin(url)) return true;

          if (/^https?:\/\//i.test(url)) {
            /*
             * 바깥 사이트를 이 웹뷰에서 열면 **사용자가 돌아올 길을 잃는다** — 헤더도
             * 주소창도 없고 안드로이드 뒤로가기만이 유일한 출구다. 시스템 브라우저(커스텀
             * 탭)로 넘기면 닫기 버튼이 있는 제 화면에서 열린다.
             *
             * 토큰이 심긴 창에 남의 페이지를 띄우지 않는다는 뜻이기도 하다.
             */
            void WebBrowser.openBrowserAsync(url).catch(() => {
              console.warn('[web-shell] 바깥 링크를 열지 못했어요:', url);
            });
            return false;
          }

          /*
           * `mailto:` `tel:` `intent:` 같은 비-HTTP 스킴. 앱이 깔려 있지 않으면 `openURL` 이
           * 실패하는데 그건 막을 수 없는 일이라 삼키고 로그만 남긴다 — 여기서 던지면 웹뷰가
           * 아니라 앱이 죽는다.
           */
          void Linking.openURL(url).catch(() => {
            console.warn('[web-shell] 이 링크를 열 수 있는 앱이 없어요:', url);
          });
          return false;
        }}
        style={styles.webview}
      />
      {loading && !failed ? <LoadingCover /> : null}
      {failed ? (
        <ErrorCover
          onRetry={() => {
            setFailed(false);
            setLoading(true);
            ref.current?.reload();
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * 첫 로드를 덮는 판.
 *
 * 그동안 빈 웹뷰를 그대로 두면 흰 판이 보이는데, 앱 배경색과 달라 「잘못 켜졌다」처럼 읽힌다.
 * 스플래시와 같은 색으로 이어 붙인다.
 */
function LoadingCover() {
  return (
    <View style={[styles.cover, styles.photoCover]}>
      <Image accessibilityLabel="Nature를 준비하는 중" source={require('../../assets/images/splash.png')} resizeMode="contain" style={styles.photo} />
    </View>
  );
}

/**
 * 연결 실패 화면.
 *
 * 이게 없으면 비행기 모드에서 하얀 화면만 남는다 — 앱이 죽은 것과 구별되지 않아 사용자는
 * 껐다 켜는 것 말고 할 수 있는 일이 없다. 무슨 일인지 말하고, 그 자리에서 다시 시도하게 한다.
 */
function ErrorCover({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.cover}>
      <Text style={styles.errTitle}>연결이 끊겼어요</Text>
      <Text style={styles.errDesc}>
        인터넷이 잠시 불안정한 것 같아요. 연결을 확인하고 다시 시도해 주세요.
      </Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
        <Text style={styles.retryText}>다시 시도</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  webview: { flex: 1, backgroundColor: colors.bg },
  // require 이미지의 원본 크기가 absoluteFill을 이기지 않도록 크기를 명시한다(→ native-boot-splash.tsx).
  photo: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  // cover의 좌우 여백은 오류 문구용이다. 사진까지 줄어 네이티브 스플래시보다 작고 왼쪽으로 쏠려 보였다.
  photoCover: { paddingHorizontal: 0 },
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    paddingHorizontal: 32,
  },
  errTitle: { ...fonts.bodyBold, fontSize: text.title, color: colors.ink, textAlign: 'center' },
  errDesc: {
    marginTop: 10,
    ...fonts.body,
    fontSize: text.md,
    lineHeight: 20,
    color: colors.mid,
    textAlign: 'center',
  },
  retry: {
    marginTop: 22,
    paddingHorizontal: 26,
    paddingVertical: 13,
    borderRadius: radii.button,
    backgroundColor: colors.ink,
  },
  retryText: { ...fonts.bodySemi, fontSize: text.lg, color: colors.onInk },
});
