/**
 * 세션 · 프로필 스토어.
 *
 * 지금은 **뼈대뿐이다** — 로그인 흐름(전화번호 인증·가입 등)은 아직 없고, 이 스토어가 아는
 * 것은 「토큰이 있는가」와 「내가 누구인가」 둘뿐이다. 화면이 늘어나면 여기에 붙인다.
 *
 * 📌 **`stage` 를 `booted` 와 따로 두는 이유.** 부팅 직후의 상태는 「로그인 안 됨」이 아니라
 * 「아직 모름」이다. 둘을 하나로 합치면 저장된 토큰을 확인하는 그 짧은 사이에 로그인 화면이
 * 한 번 번쩍이고 사라진다. 그래서 루트 레이아웃은 `booted` 가 될 때까지 아무것도 그리지
 * 않는다(→ `app/_layout.tsx`).
 */

import { create } from 'zustand';

import { api, onSessionExpired } from '@/lib/api';
import { clearTokens, loadTokens, saveTokens } from '@/lib/auth-tokens';
import type { TokenSet } from '@/types/api';

/** 이 앱이 아는 사용자. 서버가 내려주는 모양이 정해지면 `@/types/api` 로 옮긴다. */
export type Profile = {
  userId: string;
  userName: string;
};

/**
 * 세션 단계.
 *
 * 값이 둘뿐인 것은 아직 인증 흐름이 없기 때문이다. 흐름이 생기면 중간 단계(`sms`·`signup`
 * 같은)가 여기 늘어난다 — 그때도 **화면이 `stage` 를 보고 갈리는 구조는 그대로 둔다.**
 */
export type Stage = 'anonymous' | 'authed';

type UserState = {
  stage: Stage;
  /** 저장된 토큰을 확인하는 일이 끝났는가. 이 값이 false 인 동안은 아무것도 그리지 않는다. */
  booted: boolean;
  profile: Profile | null;

  /** 앱 부팅 때 1회. 저장된 토큰으로 세션을 되살린다. **던지지 않는다.** */
  bootstrap: () => Promise<void>;
  /** 인증이 끝났을 때. 토큰을 저장하고 authed 로 올린다. */
  beginSession: (tokens: TokenSet, profile: Profile) => Promise<void>;
  /** 로그아웃. 토큰을 지우고 anonymous 로 내린다. */
  signOut: () => Promise<void>;
};

const anonymousState = {
  stage: 'anonymous',
  profile: null,
} satisfies Pick<UserState, 'stage' | 'profile'>;

/**
 * 부팅을 이미 시작했는가.
 *
 * 개발 중에는 이펙트가 두 번 불리므로(React StrictMode) 막지 않으면 `/me` 를 두 번 부른다.
 * 지금은 조회뿐이라 손해가 없지만, 여기에 토큰을 회전시키는 요청이 붙는 순간 **두 번째
 * 호출이 첫 번째가 받아 온 토큰을 무효로 만들어** 부팅이 실패하게 된다. 그 고장은 개발
 * 환경에서만 나서 원인을 짚기 어렵다 — 미리 막아 둔다.
 */
let bootstrapStarted = false;

export const useUserStore = create<UserState>((set) => ({
  ...anonymousState,
  booted: false,

  bootstrap: async () => {
    if (bootstrapStarted) return;
    bootstrapStarted = true;

    const stored = await loadTokens();
    if (!stored?.accessToken) {
      set({ ...anonymousState, booted: true });
      return;
    }

    try {
      /*
       * ⚠️ **`/me` 는 아직 WAS 에 없다.** 지금 이 호출은 404 로 떨어지고, 그때 앱은 아래
       * catch 를 지나 anonymous 로 뜬다 — 그것이 맞는 동작이다. 엔드포인트가 생기면 이 줄은
       * 그대로 두고 응답 타입만 `@/types/api` 로 옮기면 된다.
       *
       * 🔴 **그래서 이 길은 무슨 일이 있어도 앱을 띄우고 끝나야 한다.** 여기서 던지면
       * `booted` 가 영영 true 가 되지 않고, 루트 레이아웃은 `null` 을 그린 채 부팅 스플래시
       * 뒤에 갇힌다(→ `app/_layout.tsx`). 서버가 없는 것과 앱이 안 뜨는 것은 다른 일이다.
       */
      const profile = await api.get<Profile>('/me');
      set({ stage: 'authed', profile, booted: true });
    } catch {
      /*
       * 실패의 종류를 지금은 가르지 않는다. **토큰까지 지운다.**
       *
       * 나중에 여기를 손볼 사람을 위해 남긴다: 형제 프로젝트는 「서버가 자격을 거절했을
       * 때(401·403)만 토큰을 버리고, 네트워크 실패면 토큰을 지키고 다음 기회에 다시
       * 시도한다」로 갈랐다(→ `birdieup-app/src/store/user-store.ts` 의 `bootstrap`).
       * 이유는 모바일 콜드 스타트의 첫 요청이 자주 실패하는데, 그때마다 토큰을 지우면
       * 리프레시 수명을 아무리 늘려도 소용이 없어지기 때문이다.
       *
       * 이 앱에서 아직 그렇게 하지 않는 것은 **`/me` 가 없어 지금은 모든 실패가 「서버가
       * 모른다」이기 때문**이고, 토큰을 남겨 두면 매 부팅마다 죽은 토큰으로 헛걸음한다.
       * 로그인 흐름과 `/me` 가 붙는 날 위 갈래를 함께 들여와라.
       */
      await clearTokens();
      set({ ...anonymousState, booted: true });
    }
  },

  beginSession: async (tokens, profile) => {
    /*
     * 🔴 **토큰 저장이 먼저다.** 상태를 authed 로 올린 뒤에 저장하면, 그 사이에 나가는
     * 요청이 Authorization 없이 떠나 401 로 떨어진다. 저장은 메모리 캐시를 즉시 채우므로
     * 이 await 가 끝난 순간부터 `api` 가 토큰을 본다(→ `lib/auth-tokens.ts`).
     */
    await saveTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    set({ stage: 'authed', profile });
  },

  signOut: async () => {
    /*
     * 토큰을 먼저 지운다. 화면을 먼저 내리면 **토큰은 살아 있는데 화면만 로그아웃된** 짧은
     * 구간이 생기고, 그 사이에 뒤늦게 돌아온 응답이 화면을 다시 authed 로 올릴 수 있다.
     */
    await clearTokens();
    // 다시 로그인한 뒤 앱을 껐다 켜면 부팅이 처음부터 다시 돌아야 한다.
    bootstrapStarted = false;
    set({ ...anonymousState });
  },
}));

/* ------------------------------------------------------------------ */
/* api.ts 훅 연결                                                       */
/* ------------------------------------------------------------------ */

/**
 * 리프레시까지 실패해 세션이 끊기면 anonymous 로 되돌린다.
 *
 * **모듈 최상단에서 건다.** 이 등록이 화면이나 이펙트 안에 있으면 그 화면이 뜨기 전에 터진
 * 401 을 아무도 듣지 못하고, 앱은 토큰 없이 authed 인 채로 남는다 — 화면마다 조용히 실패하는
 * 상태라 「로그인이 풀렸다」는 것조차 알기 어렵다.
 *
 * `clearTokens()` 는 `api` 쪽이 이미 불렀으므로 여기서는 상태만 내린다.
 */
onSessionExpired(() => {
  useUserStore.setState({ ...anonymousState });
});
