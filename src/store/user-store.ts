/**
 * 세션 · 프로필 스토어.
 *
 * 이 스토어가 아는 것은 「내가 어느 단계에 있는가」와 「내가 누구인가」 둘뿐이다. 화면은
 * 라우터를 직접 건드리지 않고 `stage` 만 움직이며, 어느 화면을 세울지는 루트 레이아웃이
 * 정한다(→ `app/_layout.tsx` 의 `Stack.Protected`).
 *
 * 📌 **`stage` 를 `booted` 와 따로 두는 이유.** 부팅 직후의 상태는 「로그인 안 됨」이 아니라
 * 「아직 모름」이다. 둘을 하나로 합치면 저장된 토큰을 확인하는 그 짧은 사이에 로그인 화면이
 * 한 번 번쩍이고 사라진다. 그래서 루트 레이아웃은 `booted` 가 될 때까지 아무것도 그리지
 * 않는다.
 *
 * 🔴 **여기서 오류 문구를 정하지 않는다.** 실패는 그대로 던지고, 무슨 말을 띄울지는 그 실패를
 * 받은 화면이 고른다(→ `lib/api-errors.ts`). 스토어가 문구를 들고 있으면 같은 실패를 화면마다
 * 다르게 말할 수 없게 되고, 스토어를 고칠 때마다 문구 검토가 따라붙는다.
 *
 * 예외가 `authNotice` 다 — 아래 그 필드의 주석에 이유를 적어 두었다.
 */

import { create } from 'zustand';

import { api, ApiError, onSessionExpired } from '@/lib/api';
import { ContractError } from '@/lib/api-errors';
import {
  clearTokens,
  getSessionVersion,
  invalidateSessionRequests,
  isStoredTokens,
  loadTokens,
  saveTokens,
} from '@/lib/auth-tokens';
import type { LoginResponse, MeResponse } from '@/types/api';

/**
 * 비밀번호를 바꾼 뒤 로그인 화면에 띄우는 안내.
 *
 * 이 문구가 없으면 사람은 **자기가 방금 성공했다는 것을 모른 채** 로그인 화면을 마주한다 —
 * 변경이 실패해서 튕겨 나온 것과 화면이 똑같기 때문이다.
 */
export const PASSWORD_CHANGED_NOTICE = '비밀번호가 변경됐어요. 새 비밀번호로 로그인해 주세요';

/**
 * 이 앱이 아는 사용자. `GET /users/me` 응답에서 **화면이 쓰는 것만** 추린 모양이다.
 *
 * 📌 **`mustChangePassword` 를 일부러 넣지 않았다.** 그 값은 `stage` 가 들고 있다. 프로필에도
 * 사본을 두면 변경 직후 그 사본이 낡은 채로 남아 「바꿨는데도 바꾸라고 하는」 화면이 생기는데,
 * 그 어긋남은 다음 부팅까지 드러나지 않는다.
 */
export type Profile = { userId: string; email: string; userName: string };

/**
 * 세션 단계. **세 단계가 곧 세 무리의 라우트다**(→ `app/_layout.tsx`).
 *
 * - `anonymous`       로그인 화면
 * - `password-change` 임시 비밀번호로 들어온 사람. 여기서는 다른 화면으로 나갈 수 없다
 * - `authed`          앱 본체(껍데기 모드면 웹뷰)
 *
 * `password-change` 가 **「토큰은 있지만 아직 authed 는 아닌」 중간 단계**인 것이 핵심이다.
 * 토큰이 있다는 이유로 곧장 authed 로 올리면 임시 비밀번호를 그대로 쓰는 계정이 앱을 다 쓰게
 * 된다. 계정은 초대로만 만들어지고 임시 비밀번호가 사람 손을 거쳐 전달되므로(→ README 의
 * 「제품 결정」), 그 비밀번호는 **이미 한 번 남의 눈을 지난 값**이라고 봐야 한다.
 */
export type Stage = 'anonymous' | 'password-change' | 'authed';

type UserState = {
  stage: Stage;
  /** 저장된 토큰을 확인하는 일이 끝났는가. 이 값이 false 인 동안은 아무것도 그리지 않는다. */
  booted: boolean;
  profile: Profile | null;
  /**
   * 로그인 화면 위에 한 번 띄울 안내.
   *
   * **이것만 스토어가 문구를 들고 있는 이유**는, 말해야 할 일이 화면 하나가 아니라 **화면
   * 사이에서** 일어나기 때문이다. 비밀번호 변경 성공도 세션 복구 실패도 그 사실을 아는 화면은
   * 사라지고 로그인 화면이 대신 선다 — 사라지는 화면에 문구를 들려 보낼 수는 없다.
   */
  authNotice: string | null;

  /** 앱 부팅 때. 저장된 토큰으로 세션을 되살린다. **던지지 않는다.** */
  bootstrap: () => Promise<void>;
  /** 이메일·비밀번호 로그인. **실패하면 던진다** — 문구는 화면이 고른다. */
  signIn: (email: string, password: string) => Promise<void>;
  /** 비밀번호 변경. 성공하면 **로그아웃하고** 재로그인을 안내한다(아래 주석 참고). */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** 로그아웃. 토큰을 지우고 anonymous 로 내린다. */
  signOut: () => Promise<void>;
};

const anonymousState = {
  stage: 'anonymous',
  profile: null,
  authNotice: null,
} satisfies Pick<UserState, 'stage' | 'profile' | 'authNotice'>;

/**
 * 진행 중인 복구. **개발 중 이펙트가 두 번 불려도(React StrictMode) 요청은 하나다.**
 *
 * 불리언 깃발이 아니라 프라미스를 들고 있는 이유는 **실패한 뒤 다시 시도할 수 있어야** 하기
 * 때문이다. 깃발이면 한 번 켜진 뒤 영영 꺼지지 않아, 연결이 끊긴 채 뜬 앱은 연결이 돌아와도
 * 저장된 세션을 다시 확인할 길이 없다.
 */
let bootstrapInFlight: Promise<void> | null = null;

/**
 * `/users/me` 를 받아 **모양까지 확인한다.**
 *
 * 🔴 **타입 단언만으로는 부족하다.** `mustChangePassword` 가 빠진 응답이 오면 `undefined` 는
 * 거짓이라 그대로 authed 가 되고, **비밀번호를 바꿔야 하는 사람이 관문을 지나간다.** 타입도
 * 화면도 깨지지 않아 아무도 모르는 종류의 고장이다. 서버가 아직 구현 전이라(→ README)
 * 지금은 더더욱 「오기로 한 모양」을 믿을 수 없다.
 */
async function fetchMe(): Promise<MeResponse> {
  const me = await api.get<MeResponse>('/users/me');
  if (
    !me ||
    typeof me.userId !== 'string' ||
    !me.userId ||
    typeof me.email !== 'string' ||
    typeof me.userName !== 'string' ||
    typeof me.mustChangePassword !== 'boolean'
  ) {
    throw new ContractError('사용자 응답의 필수 필드가 올바르지 않다');
  }
  return me;
}

function toProfile(me: MeResponse): Profile {
  return { userId: me.userId, email: me.email, userName: me.userName };
}

export const useUserStore = create<UserState>((set, get) => ({
  ...anonymousState,
  booted: false,

  bootstrap: () => {
    if (bootstrapInFlight) return bootstrapInFlight;
    /*
     * 이미 세션을 되살린 뒤면 다시 하지 않는다. **`anonymous` 일 때는 다시 한다** — 연결
     * 장애로 확인에 실패한 상태가 그 모양이라, 여기서 막으면 위 `bootstrapInFlight` 주석이
     * 말한 재시도 길이 도로 닫힌다.
     */
    if (get().booted && get().stage !== 'anonymous') return Promise.resolve();

    /*
     * 이 복구가 시작된 시점의 세션 번호. 아래 곳곳에서 이 값을 다시 확인하는데, 그 사이에
     * 사용자가 로그아웃하거나 다른 계정으로 로그인했을 수 있기 때문이다 — 늦게 돌아온 응답이
     * **새 세션을 덮어쓰면** 방금 로그아웃한 사람이 다시 로그인된 화면을 보게 된다.
     */
    const version = getSessionVersion();

    bootstrapInFlight = (async () => {
      try {
        const stored = await loadTokens();
        if (version !== getSessionVersion()) return;
        if (!stored) {
          set({ ...anonymousState, booted: true });
          return;
        }
        const me = await fetchMe();
        if (version !== getSessionVersion()) return;
        set({
          stage: me.mustChangePassword ? 'password-change' : 'authed',
          profile: toProfile(me),
          booted: true,
          authNotice: null,
        });
      } catch (error) {
        if (version !== getSessionVersion()) return;
        /*
         * 🔴 **실패의 종류를 가른다.** 서버가 자격을 거절한 것(403)만 토큰을 버리고, 연결
         * 실패는 토큰을 지킨다.
         *
         * 모바일 콜드 스타트의 첫 요청은 자주 실패한다. 그때마다 토큰을 지우면 리프레시
         * 수명을 90일로 늘려 둔 것이 아무 소용이 없어진다 — 지하철에서 앱을 한 번 연 것만으로
         * 로그아웃된다(형제 프로젝트가 같은 갈래를 갖고 있다 →
         * `birdieup-app/src/store/user-store.ts` 의 `bootstrap`).
         *
         * 401 이 여기 없는 것은 `api` 가 이미 처리했기 때문이다 — 재발급까지 실패했다면
         * `onSessionExpired`(이 파일 맨 아래)가 벌써 세션을 내렸다.
         */
        if (error instanceof ApiError && error.status === 403) {
          const clearing = clearTokens();
          set({ ...anonymousState, booted: true });
          await clearing;
          return;
        }
        /*
         * 토큰은 남겨 두되 보호 화면을 열지는 않는다. **「확인하지 못했다」와 「로그인되지
         * 않았다」는 다른 일**이라 그 사실을 말해 준다 — 안내가 없으면 사용자는 앱이 자기를
         * 잊었다고 생각하고, 사실은 연결만 돌아오면 될 일에 다시 로그인하려 든다.
         */
        set({
          ...anonymousState,
          booted: true,
          authNotice: '저장된 로그인을 확인하지 못했어요. 연결을 확인하고 다시 로그인해 주세요',
        });
      } finally {
        bootstrapInFlight = null;
      }
    })();
    return bootstrapInFlight;
  },

  /*
   * 📌 **예전의 `beginSession(tokens, profile)` 을 없애고 이 함수로 합쳤다.**
   *
   * 그 함수는 인증 흐름이 없던 시절에 「누군가 토큰을 구해 오면 authed 로 올려 주는」 입구로
   * 두었던 것인데, 이제 토큰을 구해 오는 길이 여기 하나뿐이라 역할이 통째로 겹친다. 문제는
   * 겹치는 것으로 끝나지 않는다 — `beginSession` 은 **언제나 authed 로 올린다.** 남겨 두면
   * `mustChangePassword` 관문을 건너뛰는 두 번째 입구를 열어 두는 셈이고, 그 입구는 쓰이는
   * 날까지 아무 문제도 일으키지 않다가 조용히 관문을 무너뜨린다.
   */
  signIn: async (email, password) => {
    /*
     * 이전 세션의 요청들을 무효로 만든다. 계정을 갈아타는 자리라, 앞 사람의 늦은 응답이
     * 뒤이어 도착해 **남의 프로필이 잠깐 보이는** 일을 막는다.
     */
    invalidateSessionRequests();
    const version = getSessionVersion();
    set({ authNotice: null });

    /*
     * 🔴 **`auth: false` 가 꼭 필요하다.** 로그인은 인증이 필요 없는 요청인데, 기본값으로 두면
     * (1) 남아 있던 옛 액세스 토큰이 헤더로 붙고 (2) 401 을 받았을 때 `api` 가 **옛 리프레시
     * 토큰으로 재발급을 시도한다.** 그 재발급이 실패하면 `onSessionExpired` 가 돌아 세션이
     * 정리되는데 — 지금 이 사람은 애초에 로그인 중이라 정리될 세션이 없다. 비밀번호를 한 번
     * 잘못 친 것이 엉뚱한 부작용을 남기는 셈이다(→ `lib/api.ts` 의 `request`).
     */
    const res = await api.post<LoginResponse>('/auth/login', { email, password }, { auth: false });
    if (version !== getSessionVersion()) return;

    // 모양을 확인하는 이유는 `fetchMe` 의 주석과 같다 — 관문을 여는 값이기 때문이다.
    if (!isStoredTokens(res) || typeof res.mustChangePassword !== 'boolean') {
      throw new ContractError('로그인 응답의 토큰 또는 비밀번호 변경 여부가 올바르지 않다');
    }

    /*
     * 🔴 **토큰 저장이 먼저다.** 단계를 올린 뒤에 저장하면, 그 사이에 나가는 요청이
     * Authorization 없이 떠나 401 로 떨어진다. 저장은 메모리 캐시를 즉시 채우므로 이 await 가
     * 끝난 순간부터 `api` 가 토큰을 본다(→ `lib/auth-tokens.ts`).
     */
    await saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    if (version !== getSessionVersion()) return;

    const stage: Stage = res.mustChangePassword ? 'password-change' : 'authed';
    set({ stage, profile: null, booted: true });

    /*
     * 프로필은 **이어서** 받는다. 실패해도 로그인을 되돌리지 않는 이유는, 여기까지 온 시점에
     * 로그인은 이미 성공했고 토큰도 진짜이기 때문이다 — 이름 한 줄을 못 받았다고 사람을
     * 로그인 화면으로 돌려보내면, 그 사람은 맞는 비밀번호를 다시 치고 또 같은 자리에 선다.
     * 관문(`mustChangePassword`)은 로그인 응답으로 이미 세웠으므로 여기서 실패해도 새지 않는다.
     *
     * 403 만은 다르다. **서버가 이 계정을 거절한 것**이라 앱에 들여보내면 안 된다.
     */
    try {
      const me = await fetchMe();
      if (version !== getSessionVersion()) return;
      set({ stage: me.mustChangePassword ? 'password-change' : stage, profile: toProfile(me) });
    } catch (error) {
      if (version === getSessionVersion() && error instanceof ApiError && error.status === 403) {
        const clearing = clearTokens();
        set({ ...anonymousState, booted: true });
        await clearing;
        throw error;
      }
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    // 늦게 돌아온 로그인 프로필이 변경 완료 이후 관문을 다시 닫지 못하게 한다.
    invalidateSessionRequests();
    const version = getSessionVersion();
    await api.post<void>('/auth/change-password', { currentPassword, newPassword });
    if (version !== getSessionVersion()) return;

    /*
     * 🔴 **성공했는데 로그아웃시킨다.** 이상해 보이지만 이쪽이 맞다.
     *
     * 서버는 비밀번호를 바꾸면 **이미 나간 리프레시 토큰을 전부 무효로 만들고**, 새 토큰은
     * 주지 않는다(204 뿐이다). 그러니 지금 들고 있는 토큰은 액세스 토큰의 남은 수명 동안만
     * 살아 있는 시한부다. 그대로 두면 사용자는 **아무 예고 없이, 아무 때나** 튕긴다 — 화면
     * 하나를 쓰던 중에 갑자기 로그인 화면이 뜨고, 자기가 무엇을 잘못했는지 알 수 없다.
     *
     * 지금 한 번 다시 로그인하게 하는 편이 예측 가능하다. 방금 비밀번호를 바꾼 사람은 새
     * 비밀번호를 손에 들고 있는, 다시 로그인하기 **가장 쉬운 순간**에 있기도 하다.
     *
     * 다른 기기는 즉시 끊기지 않는다 — 서버가 액세스 토큰까지 매번 검사하지는 않아서(요청마다
     * 저장소를 한 번 더 읽어야 한다) 최대 1시간이 걸린다. 그 사실은 변경 화면이 안내한다
     * (→ `app/change-password.tsx`).
     */
    const clearing = clearTokens('password-changed');
    set({ ...anonymousState, booted: true, authNotice: PASSWORD_CHANGED_NOTICE });
    await clearing;
  },

  signOut: async () => {
    /*
     * 토큰을 먼저 지운다. 화면을 먼저 내리면 **토큰은 살아 있는데 화면만 로그아웃된** 짧은
     * 구간이 생기고, 그 사이에 뒤늦게 돌아온 응답이 화면을 다시 authed 로 올릴 수 있다.
     * `clearTokens()` 는 메모리 캐시를 즉시 비우므로 await 를 기다리지 않아도 그 순간부터
     * `api` 는 토큰을 못 본다.
     */
    const clearing = clearTokens();
    set({ ...anonymousState, booted: true });
    await clearing;
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
 * 토큰은 `api` 가 이미 지웠다. 여기서 상태를 **함께** 내리지 않으면 저장소 쓰기가 끝나기를
 * 기다리는 동안 화면이 살아 있어, 그 틈에 나가는 요청들이 전부 401 로 떨어진다.
 */
onSessionExpired(() => {
  useUserStore.setState({ ...anonymousState, booted: true });
});
