import { create } from 'zustand';

import { api, ApiError, onSessionExpired } from '@/lib/api';
import { ContractError } from '@/lib/api-errors';
import {
  clearTokens, getSessionVersion, invalidateSessionRequests, isStoredTokens,
  loadTokens, saveTokens,
} from '@/lib/auth-tokens';
import type { LoginResponse, MeResponse } from '@/types/api';

export const PASSWORD_CHANGED_NOTICE = '비밀번호가 변경됐어요. 새 비밀번호로 로그인해 주세요';

export type Profile = { userId: string; email: string; userName: string };
export type Stage = 'anonymous' | 'password-change' | 'authed';

type UserState = {
  stage: Stage;
  booted: boolean;
  profile: Profile | null;
  authNotice: string | null;
  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const anonymousState = {
  stage: 'anonymous', profile: null, authNotice: null,
} satisfies Pick<UserState, 'stage' | 'profile' | 'authNotice'>;

// StrictMode에서도 하나의 복구 요청만 진행한다. 실패하면 재시도할 수 있다.
let bootstrapInFlight: Promise<void> | null = null;

async function fetchMe(): Promise<MeResponse> {
  const me = await api.get<MeResponse>('/users/me');
  if (!me || typeof me.userId !== 'string' || !me.userId ||
      typeof me.email !== 'string' || typeof me.userName !== 'string' ||
      typeof me.mustChangePassword !== 'boolean') {
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
    if (get().booted && get().stage !== 'anonymous') return Promise.resolve();
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
          profile: toProfile(me), booted: true, authNotice: null,
        });
      } catch (error) {
        if (version !== getSessionVersion()) return;
        // 네트워크/서버 장애는 다음 복구 기회를 위해 토큰을 보존한다.
        if (error instanceof ApiError && error.status === 403) {
          const clearing = clearTokens();
          set({ ...anonymousState, booted: true });
          await clearing;
          return;
        }
        set({ ...anonymousState, booted: true,
          authNotice: '저장된 로그인을 확인하지 못했어요. 연결을 확인하고 다시 로그인해 주세요',
        });
      } finally {
        bootstrapInFlight = null;
      }
    })();
    return bootstrapInFlight;
  },

  signIn: async (email, password) => {
    invalidateSessionRequests();
    const version = getSessionVersion();
    set({ authNotice: null });
    const res = await api.post<LoginResponse>('/auth/login', { email, password }, { auth: false });
    if (version !== getSessionVersion()) return;
    if (!isStoredTokens(res) || typeof res.mustChangePassword !== 'boolean') {
      throw new ContractError('로그인 응답의 토큰 또는 비밀번호 변경 여부가 올바르지 않다');
    }
    await saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    if (version !== getSessionVersion()) return;
    const stage: Stage = res.mustChangePassword ? 'password-change' : 'authed';
    set({ stage, profile: null, booted: true });
    try {
      const me = await fetchMe();
      if (version !== getSessionVersion()) return;
      set({ stage: me.mustChangePassword ? 'password-change' : stage, profile: toProfile(me) });
    } catch (error) {
      // 로그인 응답의 관문은 이미 검증했다. 프로필 조회 장애가 로그인 성공을 취소하지 않는다.
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
    // 서버는 모든 refresh 토큰을 무효화하고 새 토큰은 주지 않는다.
    const clearing = clearTokens('password-changed');
    set({ ...anonymousState, booted: true,
      authNotice: PASSWORD_CHANGED_NOTICE,
    });
    await clearing;
  },

  signOut: async () => {
    const clearing = clearTokens();
    set({ ...anonymousState, booted: true });
    await clearing;
  },
}));

// API가 토큰을 지운 직후 상태도 내려야 네트워크/저장소 지연 중 화면이 살아 있지 않는다.
onSessionExpired(() => {
  useUserStore.setState({ ...anonymousState, booted: true });
});
