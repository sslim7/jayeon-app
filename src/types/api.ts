/**
 * WAS 계약의 정본.
 *
 * 📌 **서버와 주고받는 모양은 앞으로 전부 이 파일에 적는다.** 지금은 인증에 쓰는 타입들뿐이지만,
 * 엔드포인트가 늘어날 때마다 응답 타입을 화면 옆에 적어 두면 같은 모양이 조금씩 다른 이름으로
 * 여러 벌 생기고, 서버가 필드를 하나 바꿨을 때 **어디를 고쳐야 하는지 아무도 말해 주지
 * 못한다.** 한곳에 모아 두면 그때 타입 오류가 고칠 자리를 전부 짚어 준다.
 *
 * 여기 적는 것은 **서버가 실제로 내려주는 모양**이지 화면이 쓰기 좋은 모양이 아니다.
 * 화면용으로 접은 모델은 그 화면이나 스토어 쪽에 둔다.
 *
 * 🔴 **아래 인증 엔드포인트는 WAS 에 아직 구현되지 않았다.** 모양만 먼저 고정한 것이다
 * (jayeon-was 쪽에서 확정한 계약). 지금 부르면 404 가 오므로, 화면은 그 404 를 「자격 실패」가
 * 아니라 「서버에 닿지 못함」으로 말해야 한다(→ `lib/api-errors.ts`).
 */

/**
 * 토큰 한 벌. `POST /auth/login` 과 `POST /auth/refresh` 가 **공통으로** 주는 부분이다.
 *
 * 📌 **`mustChangePassword` 를 여기 넣지 않은 이유.** 그 플래그는 로그인 응답에만 있고
 * 재발급 응답에는 **없다.** 공통 타입에 올려 두면 재발급 경로에서 언제나 `undefined` 가
 * 읽히는데, 타입은 「있다」고 말하고 있어서 `if (tokens.mustChangePassword)` 가 조용히 항상
 * 거짓이 된다 — 비밀번호를 바꿔야 하는 사람이 재발급 한 번으로 그 관문을 지나쳐 버리는,
 * 타입도 화면도 깨지지 않는 종류의 고장이다. 그래서 로그인 전용 필드는 `LoginResponse` 로
 * 갈라 둔다.
 */
export interface TokenSet {
  /** REST 호출에 `Authorization: Bearer` 로 붙이는 토큰. */
  accessToken: string;
  /** 액세스 토큰이 만료됐을 때 재발급에 쓰는 토큰. */
  refreshToken: string;
  /**
   * 액세스 토큰의 남은 수명(초).
   *
   * 지금 이 값을 쓰는 코드는 없다 — `lib/api.ts` 는 만료를 **미리 재지 않고** 401 을 받은
   * 뒤에 재발급한다(시계가 어긋난 기기에서도 그 쪽이 맞는다). 그래도 적어 두는 것은 서버가
   * 실제로 내려주는 필드이기 때문이다. 나중에 「만료 n초 전 선제 갱신」이 필요해지면 여기서
   * 시작하면 된다.
   */
  expiresInSec: number;
}

/** `POST /auth/login` 의 200 응답. */
export interface LoginResponse extends TokenSet {
  /**
   * 임시 비밀번호로 발급된 계정인가. 참이면 **다른 화면으로 가기 전에** 비밀번호를 바꿔야
   * 한다(→ `store/user-store.ts` 의 `password-change` 단계).
   */
  mustChangePassword: boolean;
}

/** `GET /users/me` 의 200 응답. 🔴 경로는 `/me` 가 아니라 `/users/me` 다. */
export interface MeResponse {
  userId: string;
  email: string;
  userName: string;
  /**
   * 앱을 껐다 켠 뒤에도 강제 변경을 건너뛸 수 없도록 **서버가 매번 다시 알려 준다.**
   * 부팅 복구가 이 값을 보고 단계를 되살린다(→ `store/user-store.ts` 의 `bootstrap`).
   */
  mustChangePassword: boolean;
  createdAt: string;
}

/**
 * 실패 응답의 본문.
 *
 * 세 필드가 전부 선택인 이유는 **이 모양을 우리가 정하지 않기 때문이다.** 앞단(CDN·프록시)이
 * 내려주는 오류에는 이 중 아무것도 없고, 그때도 `ApiError` 는 상태 코드를 들고 살아 있어야
 * 한다(→ `lib/api.ts`). 필수로 적어 두면 타입만 그럴듯해지고 런타임에는 `undefined` 가 흐른다.
 */
export interface ApiErrorBody {
  /** 기계가 갈라 보는 오류 코드. 화면이 문구를 고르는 근거로 쓴다. */
  code?: string;
  /** 사용자에게 그대로 보여 줄 수 있는 서버 문구. */
  message?: string;
  /** 무엇 때문에 막혔는지 알려 주는 부가 정보. */
  details?: Record<string, unknown> | null;
}

/**
 * 서버가 쓰는 오류 코드.
 *
 * **상수로 두는 이유는 오타 때문이다.** 화면이 `'INVALID_CREDENTAILS'` 처럼 한 글자 틀린
 * 문자열로 갈라도 타입 검사는 통과하고, 그 갈래는 영영 선택되지 않은 채 기본 문구만 나온다 —
 * 아무것도 깨지지 않아서 발견되지 않는 고장이다. 상수로 부르면 컴파일러가 잡는다.
 *
 * 🔴 **`INVALID_CREDENTIALS` 는 「없는 이메일」과 「틀린 비밀번호」를 구분하지 않는다.**
 * 서버가 일부러 감춘 것이다 — 계정이 없을 때도 미끼 해시로 bcrypt 를 돌려 응답 시간까지
 * 맞춘다. 그러니 **화면에서 이 코드를 「가입되지 않은 이메일이에요」 같은 문구로 갈라 쓰지
 * 마라.** 그렇게 쓰는 순간 아무나 이메일을 넣어 보며 **어느 주소가 이 서비스에 등록돼
 * 있는지 알아낼 수 있게 된다.** 서버가 숨긴 것을 화면이 도로 흘리는 셈이다.
 */
export const API_ERROR_CODE = {
  /** 401 — 로그인 실패 · 비밀번호 변경 시 현재 비밀번호 불일치. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** 403 — 비활성 계정. */
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  /** 400 — 형식 오류 · 새 비밀번호 정책 위반. 사유는 `details` 에 온다. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** 401 — 토큰이 없거나 만료·무효. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** 500 — 서버 내부 오류. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /**
   * 429 — 로그인 시도가 너무 잦다. `details.retryAfterSec` 에 남은 초가 온다.
   *
   * 📌 **서버는 아직 이 코드를 내지 않는다.** 그런데도 지금 갈래를 넣어 두는 이유는, 켜는 날
   * 앱이 그 코드를 모르면 「알 수 없는 오류」를 띄우기 때문이다. 사용자가 보는 것은 「비밀번호가
   * 틀렸나?」이고, 그래서 **더 시도한다** — 잠긴 사람에게 더 잠기라고 안내하는 화면이 된다.
   * 이름은 jayeon-was 가 예약해 두었다.
   */
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE];
