/**
 * 실행 환경에서 읽어 오는 값들. **이 파일 하나만 `process.env` 를 읽는다.**
 *
 * 값을 쓰는 자리마다 `process.env.EXPO_PUBLIC_…` 를 적으면 기본값이 흩어지고, 어느 날
 * 한쪽만 고쳐져도 타입도 화면도 깨지지 않아 눈치채지 못한다. 여기서 한 번 풀어 `ENV` 로만
 * 내보낸다.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

const envName = process.env.EXPO_PUBLIC_ENV ?? 'production';
const isDev = envName === 'development';

/**
 * 개발 빌드에서만 주소 안의 `localhost` 를 **Metro 를 띄운 머신의 호스트**로 바꾼다.
 *
 * 실기기에 붙인 개발 빌드에서 `localhost` 는 **폰 자신**이다. 노트북에서 띄운 API 서버는
 * 그 주소에 없으므로 요청이 전부 연결 거부로 떨어지는데, 화면에는 「서버가 응답하지
 * 않아요」처럼 보여서 서버를 의심하게 된다. Expo 가 알려 주는 `hostUri`(= Metro 가 실제로
 * 듣고 있는 주소)의 호스트로 바꿔 주면 그 요청이 개발 머신에 닿는다.
 *
 * 웹에도 같은 문제가 있다 — 다른 기기에서 LAN IP 로 dev 서버를 열면 그 페이지가 부르는
 * `localhost` 는 그 기기 자신이다. 그래서 페이지를 연 호스트가 localhost 가 아닐 때만
 * 그 호스트로 재작성한다(내 머신에서 localhost 로 연 경우는 그대로 둔다).
 *
 * 🔴 **재작성한 값을 서버로 보내거나 어딘가에 저장하지 마라.** 호스트는 기기마다 다르다.
 * 서버에 남길 주소는 언제나 서버가 준 원본이어야 한다.
 */
export function rewriteDevHost(value: string): string {
  if (!__DEV__) return value;
  const host =
    Platform.OS === 'web'
      ? typeof window === 'undefined'
        ? null
        : window.location.hostname
      : Constants.expoConfig?.hostUri?.split(':')[0];
  if (!host || host === 'localhost' || host === '127.0.0.1') return value;
  return value.replace(/localhost|127\.0\.0\.1/, host);
}

/**
 * 끝의 슬래시를 떼고 dev 호스트 재작성을 태운다.
 *
 * **끝 슬래시를 저장 시점에 한 번 다듬는 이유.** 이 값들은 쓰는 쪽에서 `/me` 나 `/shell`
 * 같은 경로를 그대로 이어 붙여 쓴다. 원본에 슬래시가 남아 있으면 `https://nature.redhead.kr//shell`
 * 이 되는데, 그 주소도 대개는 열린다 — 그래서 더 나쁘다. 오리진 비교(껍데기가 바깥 링크를
 * 걸러내는 판정, → `components/web-shell.tsx`)와 서버 로그가 조용히 지저분해질 뿐 아무도
 * 모른다. 붙이는 자리마다 조심하기보다 들어오는 자리에서 한 번 다듬는 편이 안전하다.
 */
function normalizeUrl(raw: string | undefined, fallback: string): string {
  const value = raw?.trim() || fallback;
  return rewriteDevHost(value.replace(/\/+$/, ''));
}

export const ENV = {
  /** `development` · `production` 같은 환경 이름. 화면에 그대로 보여 주기도 한다. */
  name: envName,
  isDev,
  /** WAS REST 기준 주소. 끝 슬래시 없음 — 경로를 그대로 이어 붙여 쓴다. */
  apiUrl: normalizeUrl(process.env.EXPO_PUBLIC_API_URL, 'https://nature-api.redhead.kr'),
  /** 껍데기 웹뷰가 열 주소. 끝 슬래시 없음. */
  webUrl: normalizeUrl(process.env.EXPO_PUBLIC_WEBVIEW_URL, 'https://nature.redhead.kr'),
  /**
   * 껍데기 모드 여부 — 인증까지만 네이티브가 그리고 그 뒤 화면은 웹뷰가 맡는다.
   *
   * **`'android'` 가 아니라 네이티브 전체로 판정한다.** 지금 내는 것은 안드로이드 앱뿐이지만,
   * 껍데기가 하는 일(토큰 주입 · 준비 신호 받기 · 바깥 링크 넘기기)에는 안드로이드에만
   * 성립하는 구석이 하나도 없다 — iOS 를 낼 때 그대로 선다.
   *
   * 여기서 플랫폼을 갈라 두면 같은 화면이 안드로이드에서는 웹뷰, iOS 에서는 네이티브로
   * 그려져 **어느 쪽이 진짜인지 아무도 모르게 된다**: 고장 신고가 오면 기종부터 물어야 하고,
   * 화면 하나를 고칠 때마다 두 구현을 함께 손봐야 하며, 둘이 어긋나 있어도 한참 뒤에야
   * 드러난다. 형제 프로젝트가 같은 이유로 같은 판정을 쓴다(→ `birdieup-app/src/config/env.ts`).
   *
   * 웹은 껍데기가 여는 대상 그 자체이므로 당연히 false 다.
   *
   * 🔧 **검증용 탈출구: `EXPO_PUBLIC_WEB_SHELL=false` 로 빌드하면 껍데기를 끈다.**
   * 껍데기 모드에서 사용자가 보는 화면은 **서버에 배포된 웹**이라(→ `webUrl`), 아직 배포하지
   * 않은 웹 화면은 앱을 새로 설치해도 나타나지 않는다. 그렇다고 웹뷰를 개발 서버로 돌리면
   * 이번에는 **API 가 CORS 로 막힌다** — 운영 서버는 CORS 를 끄고 있고(`jayeon-was/main.go`),
   * 그 와일드카드는 「운영에서는 쓰지 않는다」고 못박혀 있다. 즉 네이티브 화면을 실기기에서
   * 확인할 길이 그 둘 사이에 끼여 없어진다. 이 한 줄이 그 길이다.
   *
   * ⚠️ **기본값은 건드리지 않는다.** 정확히 문자열 `'false'` 일 때만 꺼지므로, 값을 주지
   * 않는 모든 빌드(운영 포함)는 예전과 한 글자도 다르지 않게 동작한다.
   */
  webShell: Platform.OS !== 'web' && process.env.EXPO_PUBLIC_WEB_SHELL !== 'false',
} as const;
