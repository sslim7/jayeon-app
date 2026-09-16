/**
 * WAS REST 클라이언트.
 *
 * - 저장된 accessToken 이 있으면 `Authorization: Bearer` 를 자동으로 붙인다(`auth: false` 로 해제).
 * - 401 을 받으면 refreshToken 으로 **한 번만** 재발급을 시도하고 원요청을 1회 재시도한다.
 *   동시에 터진 401 들은 하나의 리프레시 프라미스를 공유한다.
 * - 재발급까지 실패하면 토큰을 지우고 `onSessionExpired` 훅을 부른 뒤 원래 ApiError 를 던진다.
 */

import { ENV } from '@/config/env';
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from '@/lib/auth-tokens';
import type { ApiErrorBody, TokenSet } from '@/types/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
    this.name = 'ApiError';
  }

  /** 서버가 준 기계 판독용 오류 코드. 없으면 null. */
  get code(): string | null {
    const body = this.body as ApiErrorBody | null | undefined;
    return typeof body?.code === 'string' ? body.code : null;
  }

  /**
   * 어느 대상 때문에 막혔는지 알려 주는 부가 정보. 없으면 null.
   * 화면이 이 값을 사람이 아는 이름으로 되짚어 보여 준다.
   */
  get details(): Record<string, unknown> | null {
    const body = this.body as ApiErrorBody | null | undefined;
    return body?.details ?? null;
  }

  /** 사용자에게 그대로 보여 줄 수 있는 서버 문구. 없으면 null. */
  get serverMessage(): string | null {
    const body = this.body as ApiErrorBody | null | undefined;
    return typeof body?.message === 'string' ? body.message : null;
  }
}

/**
 * 응답을 기다리다 스스로 끊었다. **연결 문제이지 서버가 준 실패가 아니다** —
 * `ApiError`(상태 코드가 온 실패)와 반드시 구분해야 한다. 상태 코드가 온 실패는 다시 걸어도
 * 같은 답이 오지만, 이쪽은 다시 걸어 볼 값어치가 있다.
 */
export class ApiTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super('요청 시간이 초과됐어요. 네트워크를 확인해 주세요');
    this.name = 'ApiTimeoutError';
  }
}

/**
 * 요청 하나가 응답을 기다리는 한도.
 *
 * 이 값이 없으면 응답 없이 끊긴 연결에서 `fetch` 가 **영원히 매달린다** — 화면은 실패도
 * 성공도 아닌 채로 멈춰 있고, 사용자는 무엇이 잘못됐는지 알 방법이 없다. 서버 주소가 죽은
 * 호스트를 가리킬 때(로컬 개발에서 흔하다) 이것이 「영원히 전송 중」으로 나타난다.
 *
 * 15초는 사람이 「멈췄다」고 느끼기 시작하는 지점보다 넉넉하되, 죽은 연결을 붙잡고 있기에는
 * 긴 값이다. 오래 걸리는 것이 생기면 그 요청만 `timeoutMs` 로 따로 늘려라.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

export type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  /** `false` 면 Authorization 헤더를 붙이지 않고 401 자동 재발급도 하지 않는다. */
  auth?: boolean;
  /** 이 요청만의 응답 대기 한도(ms). 생략하면 `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
};

// ──────────────────────────────────────────────────────────────
// 세션 만료 훅
// ──────────────────────────────────────────────────────────────

type SessionExpiredHandler = () => void;

let sessionExpiredHandler: SessionExpiredHandler | null = null;

/**
 * 리프레시까지 실패해 세션이 끊겼을 때 호출될 콜백을 등록한다.
 * 스토어가 로그인 상태로 되돌리는 데 쓴다(→ `store/user-store.ts`). 반환값으로 해제한다.
 *
 * 스토어를 여기서 직접 import 하지 않는 이유는 **방향을 하나로 두기 위해서다** — 스토어는
 * api 를 쓰고, api 는 스토어를 모른다. 반대로 이으면 순환 import 가 되고, 그 고장은 빈
 * 모듈 객체가 런타임에 터지는 모양으로 나타나 원인을 짚기 어렵다.
 */
export function onSessionExpired(handler: SessionExpiredHandler): () => void {
  sessionExpiredHandler = handler;
  return () => {
    if (sessionExpiredHandler === handler) sessionExpiredHandler = null;
  };
}

// ──────────────────────────────────────────────────────────────
// 토큰 재발급 (동시 401은 단일 프라미스 공유)
// ──────────────────────────────────────────────────────────────

let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${ENV.apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;

    const text = await res.text();
    const tokens = (text ? JSON.parse(text) : null) as TokenSet | null;
    if (!tokens?.accessToken || !tokens?.refreshToken) return false;

    await saveTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    return true;
  } catch {
    return false;
  }
}

/**
 * 진행 중인 재발급이 있으면 그 결과를 공유한다.
 *
 * 화면 하나가 요청 몇 개를 한꺼번에 보내면 401 도 한꺼번에 온다. 각자 재발급을 부르면
 * 리프레시 토큰이 연달아 회전하면서 **서로가 서로를 무효로 만들어** 결국 전부 실패한다.
 */
function refreshTokens(): Promise<boolean> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// ──────────────────────────────────────────────────────────────
// 요청 코어
// ──────────────────────────────────────────────────────────────

async function send<T>(path: string, options: RequestOptions): Promise<T> {
  const { body, headers, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = options;
  const accessToken = auth ? getAccessToken() : null;

  /*
   * 호출자가 준 취소 신호와 우리 타임아웃 **둘 다** 이 요청을 끊을 수 있어야 한다.
   * `AbortSignal.any` 는 아직 못 믿는 런타임이 있어 직접 잇는다.
   *
   * `timedOut` 을 따로 두는 이유는 abort 사유를 되짚기 위해서다 — 취소도 타임아웃도 똑같이
   * AbortError 로 오기 때문에, 이 표시가 없으면 사용자가 스스로 취소한 것을 「시간 초과」라고
   * 잘못 말하게 된다.
   */
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);

  /*
   * 한도가 **본문을 다 읽을 때까지** 살아 있어야 한다. 헤더만 오고 본문이 멈추는 연결이
   * 실제로 있는데, 타이머를 응답 도착 시점에 꺼 버리면 그 경우가 다시 무한 대기가 된다.
   * 그래서 `clearTimeout` 이 `res.text()` 뒤의 `finally` 에 있다.
   */
  let text: string;
  let status: number;
  let ok: boolean;
  try {
    const res = await fetch(`${ENV.apiUrl}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    text = await res.text();
    status = res.status;
    ok = res.ok;
  } catch (error) {
    if (timedOut) throw new ApiTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }

  /*
   * 앞단(CDN · 로드밸런서)이 JSON 대신 HTML 오류 페이지를 돌려줄 수 있다. 그때
   * `JSON.parse` 가 SyntaxError 를 던지면 호출부는 **상태 코드를 영영 못 보고** 네트워크
   * 장애와 구분할 수 없게 된다 — 파싱 실패는 삼키고 상태 코드를 살린다. 본문 앞머리는
   * 단서로 남겨 둔다(무엇이 왔는지 알아볼 수 있을 만큼만).
   */
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 200) };
    }
  }
  if (!ok) throw new ApiError(status, data);
  return data as T;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await send<T>(path, options);
  } catch (error) {
    const canRetry = error instanceof ApiError && error.status === 401 && options.auth !== false;
    if (!canRetry) throw error;

    const refreshed = await refreshTokens();
    if (!refreshed) {
      await clearTokens();
      sessionExpiredHandler?.();
      throw error;
    }

    try {
      return await send<T>(path, options);
    } catch (retryError) {
      // 방금 재발급한 토큰으로도 401 이면 서버가 세션을 무효화한 것이다.
      if (retryError instanceof ApiError && retryError.status === 401) {
        await clearTokens();
        sessionExpiredHandler?.();
      }
      throw retryError;
    }
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
