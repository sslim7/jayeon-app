/**
 * 로그인 기기(세션) — 서버 계약과 화면이 쓰는 표기.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이 화면은 폰을 잃어버린 순간에 열린다.** 그래서 여기 있는 모든 값은 「아는 것만     │
 * │ 아는 만큼」 말해야 한다 — 추정을 단정으로, 상한을 정확한 시각으로, 날짜를 시:분으로     │
 * │ 올려 적는 순간 사용자는 **끊기지 않은 기기를 끊겼다고 믿는다.**                       │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * 계약의 정본은 서버다(§`jayeon-was/internal/auth/session_handler.go`,
 * `docs/openapi.yaml` 의 `UserSession`). 아래 주석은 그 파일들이 적어 둔 성격 중에서
 * **화면이 지켜야 하는 것만** 옮긴 것이다.
 */

import { ApiError, api } from '@/lib/api';
import { ContractError, readApiErrorMessage } from '@/lib/api-errors';

/** 접속 기록 한 건. */
export interface SessionAccess {
  at: string;
  /** ⚠️ 이때 찍힌 기기 표시. `deviceLabel` 과 같은 추정값이다. */
  deviceLabel: string;
}

/** `GET /auth/sessions` 가 주는 기기 한 줄. */
export interface UserSession {
  sessionId: string;
  /**
   * ⚠️ **User-Agent 로 추정한 이름이다.** 「Chrome · macOS」 정도가 한계이고 모델명은 대개
   * 알 수 없다. 모르면 서버가 「알 수 없는 기기」를 보낸다.
   *
   * 🔴 **단정적인 문구로 감싸지 마라.** 같은 기종 두 대는 이 값이 **글자 그대로 같다** —
   * 어느 줄이 잃어버린 폰인지는 이 이름이 아니라 마지막 접속과 「이 기기」 표시가 가른다.
   */
  deviceLabel: string;
  /** 추정의 근거가 된 원문(512바이트에서 잘릴 수 있다). 추정이 빗나갔을 때 사람이 직접 읽는다. */
  userAgent: string;
  createdAt: string;
  /**
   * ⚠️ **날짜 단위로만 정확하다.** 서버가 쓰기를 줄이려고 한국 날짜가 바뀔 때만 기록해서,
   * 같은 날 안에서는 그날 처음 기록한 시각에 머문다.
   *
   * 🔴 **「방금 전」·「5분 전」 같은 상대 표기를 쓰지 마라.** 그 표기는 시:분을 믿게 만드는데
   * 이 값의 시:분은 뒤처져 있다 — 방금 쓴 기기가 「7시간 전」으로 보이고, 사용자는 그 줄을
   * 남의 기기가 아니라고 판단한다. 표기는 `sessionDayLabel` 하나로 모아 두었다.
   */
  lastSeenAt: string;
  /** 지금 이 화면을 띄운 기기인가. 액세스 토큰에 실린 세션 id 로 서버가 가린다. */
  current: boolean;
  /** 끊은 시각. 살아 있으면 `null`. */
  revokedAt: string | null;
  /**
   * 끊긴 기기가 **늦어도 언제까지** 쓸 수 있는지.
   *
   * 🔴 **살아 있는 세션이면 `null` 이다. 그때 시각을 지어내지 마라** — 끊기 전에는 한계가
   * 없다(계속 갱신한다). ⚠️ 끊긴 뒤에도 이 값은 **상한**이지 정확한 시각이 아니다.
   */
  accessibleUntilAtMost: string | null;
  /**
   * 최근 접속 기록, 최신이 앞. 최대 10건이다.
   *
   * ⚠️ 하루 한두 번만 기록하므로 사실상 **「최근 열흘 중 쓴 날」**이다. 15분마다 찍힌 목록이
   * 아니다 — 그래서 시각이 아니라 날짜로 읽어야 한다(`lastSeenAt` 과 같은 제약).
   */
  recentAccesses: SessionAccess[];
}

/** `DELETE /auth/sessions/{sessionId}` 의 200 응답. */
export interface RevokeSessionResult {
  sessionId: string;
  revokedAt: string;
  /** ⚠️ 상한이지 정확한 시각이 아니다. 화면은 「늦어도 …까지」로 적는다. */
  accessibleUntilAtMost: string;
  /**
   * 🔴 **참이면 지금 이 기기를 끊은 것이다.** 저장된 토큰을 버리고 로그인 화면으로 가야
   * 한다 — 그러지 않으면 이미 발급된 액세스 토큰으로 **15분을 더 돌아다닌다.**
   */
  current: boolean;
}

/**
 * 액세스 토큰 수명. **끊기가 실제로 듣기까지 걸리는 최대 시간이다.**
 *
 * 🔴 **서버의 `AccessTokenTTL` 과 같은 값이어야 한다**(§`jayeon-was/internal/auth/token.go`).
 * 어긋나면 「지금 끊으면 언제까지 쓸 수 있는가」를 미리 알려 주는 확인 문구만 조용히 틀린다.
 *
 * ⚠️ **이 상수는 확인 문구(아직 끊기 전이라 서버 값이 없는 순간)에만 쓴다.** 끊은 뒤의
 * 표기는 반드시 응답의 `accessibleUntilAtMost` 를 쓴다 — 서버가 수명을 바꾸는 날 앱이
 * 거짓말을 하지 않으려면 화면에 남는 숫자는 서버가 준 것이어야 한다.
 */
export const ACCESS_TOKEN_TTL_MS = 15 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function readAccesses(value: unknown): SessionAccess[] {
  if (!Array.isArray(value)) return [];
  const out: SessionAccess[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.at !== 'string') continue;
    out.push({ at: item.at, deviceLabel: typeof item.deviceLabel === 'string' ? item.deviceLabel : '' });
  }
  return out;
}

/**
 * 응답 한 줄을 확인해 받는다.
 *
 * 🔴 **모양이 다른 줄을 조용히 버리지 않는다.** 기기 목록에서 한 줄이 사라지는 것은 화면이
 * 비는 것보다 나쁘다 — 사용자는 **남은 줄만 보고** 「낯선 기기는 없구나」로 읽고 닫는다.
 * 그래서 하나라도 읽을 수 없으면 목록 전체를 실패로 만들고, 화면이 그 사실을 말한다.
 *
 * `current`·`revokedAt` 을 특히 엄하게 보는 이유는 둘 다 **행동을 바꾸는 값**이라서다.
 * `current` 가 빠지면 「이 기기」 표시가 사라져 자기 기기를 남의 기기로 알고 끊는다.
 */
function readSession(value: unknown): UserSession {
  if (!isRecord(value)) throw new ContractError('기기 목록의 한 줄이 객체가 아니다');
  const { sessionId, deviceLabel, userAgent, createdAt, lastSeenAt, current, revokedAt, accessibleUntilAtMost } = value;
  if (typeof sessionId !== 'string' || !sessionId) throw new ContractError('기기 목록에 sessionId 가 없다');
  if (typeof deviceLabel !== 'string') throw new ContractError('기기 목록에 deviceLabel 이 없다');
  if (typeof lastSeenAt !== 'string') throw new ContractError('기기 목록에 lastSeenAt 이 없다');
  if (typeof current !== 'boolean') throw new ContractError('기기 목록에 current 가 없다');
  if (revokedAt !== null && typeof revokedAt !== 'string') throw new ContractError('기기 목록의 revokedAt 이 문자열도 null 도 아니다');
  if (accessibleUntilAtMost !== null && typeof accessibleUntilAtMost !== 'string') throw new ContractError('기기 목록의 accessibleUntilAtMost 가 문자열도 null 도 아니다');
  return {
    sessionId,
    deviceLabel,
    userAgent: typeof userAgent === 'string' ? userAgent : '',
    createdAt: typeof createdAt === 'string' ? createdAt : '',
    lastSeenAt,
    current,
    revokedAt,
    accessibleUntilAtMost,
    recentAccesses: readAccesses(value.recentAccesses),
  };
}

function readRevokeResult(value: unknown): RevokeSessionResult {
  if (!isRecord(value)) throw new ContractError('끊기 응답이 객체가 아니다');
  const { sessionId, revokedAt, accessibleUntilAtMost, current } = value;
  if (typeof sessionId !== 'string' || !sessionId) throw new ContractError('끊기 응답에 sessionId 가 없다');
  if (typeof accessibleUntilAtMost !== 'string') throw new ContractError('끊기 응답에 accessibleUntilAtMost 가 없다');
  /*
   * 🔴 **`current` 가 없으면 실패로 만든다.** `undefined` 는 거짓이라 그대로 두면 「지금 이
   * 기기를 끊었다」가 조용히 「남의 기기를 끊었다」가 되고, 앱은 로그아웃하지 않은 채 남은
   * 액세스 토큰으로 15분을 더 돈다 — 잃어버린 기기에서 벌어지면 그게 이 기능의 실패다.
   */
  if (typeof current !== 'boolean') throw new ContractError('끊기 응답에 current 가 없다');
  return {
    sessionId,
    revokedAt: typeof revokedAt === 'string' ? revokedAt : '',
    accessibleUntilAtMost,
    current,
  };
}

export const sessionApi = {
  /** 로그인된 기기 목록. 최근 접속 순으로 최대 100건이다. */
  async list(): Promise<UserSession[]> {
    const body = await api.get<{ sessions?: unknown }>('/auth/sessions');
    if (!isRecord(body) || !Array.isArray(body.sessions)) throw new ContractError('기기 목록에 sessions 배열이 없다');
    return body.sessions.map(readSession);
  },
  /**
   * 기기 하나 끊기. **멱등이다** — 이미 끊은 기기를 다시 끊어도 200 이고 처음 끊은 시각을
   * 그대로 돌려준다.
   */
  async revoke(sessionId: string): Promise<RevokeSessionResult> {
    return readRevokeResult(await api.delete<unknown>(`/auth/sessions/${encodeURIComponent(sessionId)}`));
  },
};

/**
 * 「그런 기기가 없다」. 서버는 **남의 세션·없는 세션·형식이 틀린 id 를 모두 이 코드로** 준다
 * (§`jayeon-was/internal/auth/session_handler.go` — 403 을 주면 그 id 가 실제로 있다는 사실을
 * 알려 주는 것과 같아서다).
 */
export const CODE_SESSION_NOT_FOUND = 'SESSION_NOT_FOUND';

/**
 * 실패 한 건을 화면에 띄울 한 줄로 옮긴다.
 *
 * 연결 실패·계약 위반·서버 문구를 가르는 일은 `readApiErrorMessage` 가 이미 한다
 * (→ `lib/api-errors.ts`). 여기서 하나만 가로챈다.
 *
 * ⚠️ **`SESSION_NOT_FOUND` 는 서버 문구를 쓰지 않는다** — 그 관례(서버 문구를 그대로 쓴다)를
 * 일부러 어기는 유일한 자리다. 서버의 「기기를 찾을 수 없어요」는 사실이지만 **다음에 할 일을
 * 말하지 않는데**, 이 코드가 실제로 오는 경우는 대개 「이미 끊긴 기기를 한 번 더 끊었다」나
 * 「다른 기기에서 비밀번호를 바꿔 목록이 낡았다」다. 그때 「찾을 수 없다」만 남으면 사용자는
 * **끊기가 실패했다고 믿고 계속 누른다** — 잃어버린 기기를 앞에 두고 가장 하면 안 되는 오해다.
 */
export function sessionErrorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code === CODE_SESSION_NOT_FOUND) {
    return '이미 끊겼거나 목록에서 사라진 기기예요. 목록을 다시 불러와 확인해 주세요.';
  }
  return readApiErrorMessage(error, {}, fallback);
}

/* ------------------------------------------------------------------ */
/* 표기 — 날짜는 날짜로, 시각은 시각으로                                  */
/* ------------------------------------------------------------------ */

const pad = (value: number) => String(value).padStart(2, '0');

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 두 시각이 **현지 달력에서** 며칠 떨어져 있는가(시:분은 버린다). */
function dayGap(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * 마지막 접속·접속 기록에 쓰는 표기. **날짜까지만 적는다.**
 *
 * 🔴 시:분을 적지 않는 것이 이 함수의 존재 이유다(→ `UserSession.lastSeenAt` 주석).
 * 서버가 하루 한 번만 기록하므로 시:분은 뒤처져 있고, 그 값을 그대로 적으면 방금 쓴 기기가
 * 아침에 마지막으로 쓴 것처럼 보인다.
 *
 * 「오늘」·「어제」는 **날짜 단위의 사실**이라 이 제약 안에 있다 — 잃어버린 기기를 찾는
 * 사람이 가장 먼저 세는 것이 그 둘이라 이름으로 적고, 그보다 오래된 것은 날짜로 적는다.
 * 읽을 수 없는 값은 빈 문자열이다(`Invalid Date` 를 그리면 앱이 고장 난 것으로 읽힌다).
 */
export function sessionDayLabel(iso: string | null | undefined, now: Date = new Date()): string {
  const date = parse(iso);
  if (!date) return '';
  const gap = dayGap(date, now);
  if (gap === 0) return '오늘';
  if (gap === 1) return '어제';
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

/**
 * 한계 시각(`accessibleUntilAtMost`)에 쓰는 표기. **여기서는 시:분을 적는다.**
 *
 * 앞의 날짜 표기와 반대인 이유는 값의 출처가 다르기 때문이다 — 이 값은 뒤처진 기록이 아니라
 * **서버가 끊은 시각에 수명을 더해 계산한 값**이라 시:분이 정확하다. 「15분 뒤」처럼 적지
 * 않는 것은 그 표기가 화면을 열어 둔 채 시간이 흐르면 어긋나기 때문이다.
 *
 * 날이 넘어가면 날짜를 앞에 붙인다. 밤 11시 55분에 끊으면 한계는 다음 날 0시 10분인데,
 * 「오전 12:10까지」만 적으면 **이미 지난 시각**으로 읽혀 사용자가 안심한다.
 */
export function sessionClockLabel(iso: string | null | undefined, now: Date = new Date()): string {
  const date = parse(iso);
  if (!date) return '';
  const hour = date.getHours();
  const clock = `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${pad(date.getMinutes())}`;
  const gap = dayGap(now, date);
  if (gap === 0) return clock;
  if (gap === 1) return `내일 ${clock}`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${clock}`;
}

/**
 * 끊긴 기기 한 줄에 적을 말.
 *
 * 한계가 지났으면 **지났다고 말한다.** 화면을 열어 둔 채 시간이 흐른 경우인데, 그때까지
 * 「늦어도 …까지 쓸 수 있어요」가 남아 있으면 이미 끊긴 기기를 아직 살아 있다고 말하는 셈이다.
 * 🔴 읽을 수 없는 값이면 시각을 지어내지 않고 **시각 없이** 말한다.
 */
export function revokedText(session: Pick<UserSession, 'accessibleUntilAtMost'>, now: Date = new Date()): string {
  const until = parse(session.accessibleUntilAtMost);
  if (!until) return '끊었어요.';
  if (until.getTime() <= now.getTime()) return '끊었어요. 이제 이 기기에서는 다시 로그인해야 열려요.';
  return `끊었어요. 이미 열려 있던 화면은 늦어도 ${sessionClockLabel(session.accessibleUntilAtMost, now)}까지 남아 있을 수 있어요.`;
}
