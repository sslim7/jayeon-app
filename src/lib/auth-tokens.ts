/**
 * 토큰 영속화 + 동기 메모리 캐시.
 *
 * 네이티브는 SecureStore(Keychain/Keystore), 웹은 localStorage 를 쓴다.
 * `api.ts` 가 매 요청마다 토큰을 **동기로** 읽어야 하므로 메모리 캐시를 항상 함께 유지한다 —
 * 앱 부팅 때 `loadTokens()` 를 한 번 await 하면 그 뒤 `getAccessToken()` 은 동기다.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { postTokensToNative } from '@/lib/native-bridge';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * 저장 키. **껍데기와 웹이 함께 보는 값이다** — 껍데기가 웹뷰의 localStorage 에 심는 키도
 * 같아야 한다(→ `components/web-shell.tsx` 의 `TOKENS_KEY`). 그래서 가볍게 바꾸면 안 된다:
 * 키를 바꾼 웹 빌드가 옛 껍데기와 만나면 주입된 토큰을 못 찾아 **로그인 화면이 다시 뜬다.**
 */
const KEY = 'jayeon.tokens';
const isWeb = Platform.OS === 'web';

let cache: StoredTokens | null = null;
let loaded = false;
let sessionVersion = 0;
let persistence: Promise<void> = Promise.resolve();

// 로그아웃 이후 도착한 요청이 예전 세션을 되살리지 못하게 한다.
export function invalidateSessionRequests(): void {
  sessionVersion += 1;
}

export function getSessionVersion(): number {
  return sessionVersion;
}

function persist(operation: () => Promise<void>): Promise<void> {
  persistence = persistence.then(operation).catch(() => {
    // 저장소 접근이 막힌 환경에서도 현재 실행 중인 세션은 사용할 수 있다.
  });
  return persistence;
}

export function isStoredTokens(value: unknown): value is StoredTokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as StoredTokens;
  return typeof tokens.accessToken === 'string' && tokens.accessToken.length > 0 &&
    typeof tokens.refreshToken === 'string' && tokens.refreshToken.length > 0;
}

async function readRaw(): Promise<string | null> {
  if (isWeb) {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(KEY);
  }
  return SecureStore.getItemAsync(KEY);
}

async function writeRaw(value: string): Promise<void> {
  if (isWeb) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, value);
    return;
  }
  await SecureStore.setItemAsync(KEY, value);
}

async function deleteRaw(): Promise<void> {
  if (isWeb) {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}

/** 손상됐거나 모양이 다른 값은 **없는 것으로** 취급한다 — 반쪽짜리 토큰으로 도는 것보다 낫다. */
function parse(raw: string | null): StoredTokens | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isStoredTokens(parsed)) return parsed;
  } catch {
    // 파싱 실패도 같은 처리다.
  }
  return null;
}

/**
 * 저장소에서 토큰을 읽어 메모리 캐시를 채운다.
 * 앱 부팅 때 1회 await 해야 `getAccessToken()` 이 의미 있는 값을 돌려준다.
 */
export async function loadTokens(): Promise<StoredTokens | null> {
  if (loaded) return cache;
  const version = sessionVersion;
  try {
    const stored = parse(await readRaw());
    if (!loaded && version === sessionVersion) cache = stored;
  } catch {
    // 읽는 동안 새 로그인이나 로그아웃이 있었다면 그 결과를 보존한다.
  }
  loaded = true;
  return cache;
}

/**
 * 토큰셋을 저장하고 메모리 캐시를 즉시 갱신한다.
 *
 * 📌 **네이티브 껍데기에도 되돌려 준다**(→ `@/lib/native-bridge`). 껍데기는 콜드 스타트마다
 * 저장해 둔 토큰을 웹뷰에 다시 주입하는데, 갱신은 대부분 **웹뷰 안에서** 일어난다.
 * 알리지 않으면 껍데기의 사본만 로그인 시점 그대로 멈춰 선다.
 *
 * 그 사본이 당장 죽지는 않는다. 리프레시 토큰은 상태 없는 JWT 라 새로 발급해도 옛것이
 * 곧바로 무효가 되지는 않기 때문이다. 문제는 **수명이 갱신되지 않는다**는 것이다 — TTL 이
 * 로그인 시점부터 흐르므로, 앱을 매일 쓰던 사람도 TTL 이 끝나는 날 콜드 스타트에서 **이유
 * 없이 로그인이 풀린다.** 웹뷰는 그동안 새 토큰을 계속 받고 있었는데도 그렇다. 원인을
 * 나중에 찾기가 아주 어려운 종류의 고장이라(형제 프로젝트가 같은 이유로 같은 장치를 둔다 →
 * `birdieup-app/src/lib/auth-tokens.ts`), 토큰이 바뀌는 **모든** 길목인 이 함수와
 * `clearTokens()` 에서 알린다. 껍데기 밖에서는 no-op 이다.
 */
export async function saveTokens(tokens: StoredTokens): Promise<void> {
  cache = tokens;
  loaded = true;
  /*
   * 저장소 쓰기보다 **먼저** 알린다. 메모리 캐시가 이미 새 값이라 이 앱은 새 토큰으로
   * 도는데, 쓰기가 실패했다고 껍데기만 옛 값에 남겨 두면 다음 콜드 스타트가 그 옛 값으로
   * 시작한다 — 쓰기가 실패했을 때야말로 껍데기의 사본이 유일하게 살아 있는 최신본이다.
   */
  postTokensToNative(tokens);
  await persist(() => writeRaw(JSON.stringify(tokens)));
}

/**
 * 토큰을 지운다(로그아웃 · 리프레시 실패).
 *
 * 껍데기에도 「지워졌다」를 알린다 — 여기서 알리지 않으면 껍데기가 이미 죽은 토큰을 다음
 * 콜드 스타트에 그대로 다시 주입한다(→ `saveTokens` 주석).
 */
export async function clearTokens(reason?: 'password-changed'): Promise<void> {
  sessionVersion += 1;
  cache = null;
  loaded = true;
  postTokensToNative(null, reason);
  await persist(deleteRaw);
}

/** 동기 조회. `loadTokens()` 이전에는 항상 null 이다. */
export function getAccessToken(): string | null {
  return cache?.accessToken ?? null;
}

/** 동기 조회. `loadTokens()` 이전에는 항상 null 이다. */
export function getRefreshToken(): string | null {
  return cache?.refreshToken ?? null;
}

/** 메모리 캐시 전체. 부팅 이후의 동기 접근용(껍데기가 웹뷰에 주입할 때 쓴다). */
export function getStoredTokens(): StoredTokens | null {
  return cache;
}
