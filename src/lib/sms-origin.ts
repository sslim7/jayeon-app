/**
 * 문자 화면이 **어디서 왔는가**, 그리고 닫으면 **어디로 돌아가 무슨 말을 하는가**.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **발송 상세(`app/sms/[id].tsx`)는 두 흐름에서 열린다** — 「문자 보내기」에서 문자를  │
 * │ 준비해 들어오기도 하고, 「예약 문자 보내기」에서 예약 한 건을 눌러 들어오기도 한다.     │
 * │ 그런데 닫고 나갈 때 **스택 기록(`router.back()`)으로 돌아갈 곳을 추측하면 틀린다.**     │
 * │ 문자 작성 화면은 상세로 갈 때 `replace` 로 자기 자리를 내주므로, 뒤로 한 칸은 문자      │
 * │ 보내기가 아니라 **그 밑에 깔려 있던 아무 화면**이다.                                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 실기기에서 나온 증상이 정확히 그것이었다. 「문자 보내기」에서 2명을 골라 발송을 중단하고
 * 닫았는데 「예약 문자 보내기」가 떴고, 거기 남아 있던 「2명의 예약을 취소했어요」가 그대로
 * 보였다 — **돌아간 곳도 틀렸고, 화면이 사용자에게 없던 일을 말했다.**
 *
 * 그래서 추측을 그만두고 **출처를 주소에 실어 들고 다닌다.** 돌아갈 곳과 그곳에서 할 말을
 * 한 자리에서 정하고(`smsExit`), 화면은 그 결과를 쓰기만 한다. 판정이 화면 안에 있으면
 * `node --test` 가 닿지 않아, 「문자 보내기에서 왔는데 예약 이야기를 한다」를 사람이 실기기로
 * 다시 겪어야만 알 수 있다(→ `tests/sms-origin.test.cjs`).
 */

/**
 * 문자 화면에 들어온 입구.
 *
 * - `send`     「문자 보내기」(`/sms/new`) — 수신자를 고르고 문자를 준비해서 왔다
 * - `reserved` 「예약 문자 보내기」(`/sms/reserved`) — 예약해 둔 한 건을 눌러서 왔다
 * - `history`  「발송 이력」(`/sms`) — 지난 발송을 열어서 왔다
 */
export type SmsOrigin = 'send' | 'reserved' | 'history';

/**
 * 무엇을 닫고 나왔는가. 돌아간 화면이 할 말이 여기서 갈린다 — **작성을 그만둔 것과 이미
 * 만들어진 문자를 닫은 것은 남는 것이 다르다.**
 *
 * - `compose` 문자 작성 화면을 그만뒀다. 아직 아무것도 만들지 않았다.
 * - `detail`  발송 상세를 닫았다. 문자는 이미 만들어져 그대로 남는다.
 */
export type SmsLeave = 'compose' | 'detail';

/** 출처가 곧 돌아갈 화면이다. 🔴 값은 `src/app/` 아래 실제 라우트와 같아야 한다. */
export const SMS_ORIGIN_ROUTE = {
  send: '/sms/new',
  reserved: '/sms/reserved',
  history: '/sms',
} as const;

export type SmsOriginRoute = (typeof SMS_ORIGIN_ROUTE)[SmsOrigin];

/** 출처를 싣는 주소 파라미터 이름. 실어 주는 쪽과 읽는 쪽이 같은 글자를 보게 한 자리에 둔다. */
export const SMS_ORIGIN_PARAM = 'from';
/** 「닫고 돌아왔다」는 흔적을 싣는 파라미터 이름. 돌아간 화면이 이걸 보고 한 줄을 세운다. */
export const SMS_LEAVE_PARAM = 'closed';

const ORIGINS: SmsOrigin[] = ['send', 'reserved', 'history'];
const LEAVES: SmsLeave[] = ['compose', 'detail'];

/** 주소 파라미터는 배열로 올 수도, 아예 없을 수도 있다. 첫 값만 보고 나머지는 버린다. */
function first(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

/**
 * 주소에 실린 출처를 읽는다.
 *
 * ⚠️ **모르는 값은 `send` 다.** 링크로 바로 열거나 웹에서 새로고침하면 파라미터가 없는데,
 * 그때 화면이 나갈 길을 잃으면 안 된다. 문자 보내기는 이 앱의 첫 화면이라 어디서 시작해도
 * 말이 되는 유일한 자리다(→ `app/index.tsx`).
 */
export function readSmsOrigin(value: unknown): SmsOrigin {
  const found = first(value);
  return (ORIGINS as string[]).includes(found) ? (found as SmsOrigin) : 'send';
}

/** 「닫고 돌아왔다」 흔적을 읽는다. 없거나 모르는 값이면 `null` — 아무 말도 하지 않는다. */
export function readSmsLeave(value: unknown): SmsLeave | null {
  const found = first(value);
  return (LEAVES as string[]).includes(found) ? (found as SmsLeave) : null;
}

export interface SmsExit {
  /** 돌아갈 화면. */
  route: SmsOriginRoute;
  /** 그 화면을 열 주소. 흔적을 달고 가야 돌아간 화면이 아래 `notice` 를 되살릴 수 있다. */
  href: `${SmsOriginRoute}?${typeof SMS_LEAVE_PARAM}=${SmsLeave}`;
  /**
   * 돌아간 화면이 세울 한 줄. **그 흐름의 말로 적는다.**
   * 🔴 「예약을 취소했어요」는 예약 흐름에서 왔을 때만 맞는 말이다.
   */
  notice: string;
}

/**
 * 닫고 나면 어디로 가서 무슨 말을 할 것인가.
 *
 * 같은 값을 양쪽이 나눠 쓴다 — 나가는 화면은 `href` 로 이동하고, 도착한 화면은 자기 출처로
 * 같은 함수를 불러 `notice` 를 세운다. 문구를 주소에 실어 나르지 않는 이유는, 웹 주소창에
 * 한국어 문장이 그대로 서기 때문이기도 하고, **문구의 주인은 도착한 화면**이기 때문이다.
 *
 * @param count 작성을 그만둘 때 고려 중이던 수신자 수. 모르면 생략한다.
 */
export function smsExit(origin: SmsOrigin, leave: SmsLeave, count?: number): SmsExit {
  const route = SMS_ORIGIN_ROUTE[origin];
  return {
    route,
    href: `${route}?${SMS_LEAVE_PARAM}=${leave}`,
    notice: notice(origin, leave, count),
  };
}

function notice(origin: SmsOrigin, leave: SmsLeave, count?: number): string {
  if (origin === 'reserved') {
    // 🔴 실기기에서 「2명의 예약을 취소했어요」가 뜨던 자리. 예약함으로 돌아온 사람에게 가장
    // 먼저 알려야 할 것은 **예약이 그대로 있다**는 사실이다.
    return leave === 'compose'
      ? '예약 문자 보내기로 돌아왔어요. 예약은 그대로 있어요.'
      : '예약 문자 보내기로 돌아왔어요. 예약을 취소한 것이 아니에요.';
  }
  if (origin === 'history') {
    return leave === 'compose'
      ? '발송 이력으로 돌아왔어요. 문자는 보내지 않았어요.'
      : '발송 이력으로 돌아왔어요. 문자는 그대로 남아 있어요.';
  }
  if (leave === 'compose') {
    // 「그만뒀다」와 「안 보냈다」를 같이 적는다. 작성 화면을 닫은 사람이 가장 걱정하는 것이
    // 「혹시 나갔나」다.
    return count
      ? `${count}명에게 보내려던 문자를 그만뒀어요. 문자는 보내지 않았어요.`
      : '보내려던 문자를 그만뒀어요. 문자는 보내지 않았어요.';
  }
  // 상세를 닫아도 만들어진 캠페인은 남는다. 어디서 다시 찾는지까지 적어야 「사라졌나」를 묻지 않는다.
  return '문자 보내기로 돌아왔어요. 준비한 문자는 「발송 이력」에 남아 있어요.';
}
