/**
 * 실패를 **사람이 읽을 수 있는 한 줄**로 옮기는 자리.
 *
 * # 왜 화면마다 두지 않는가
 *
 * 로그인과 비밀번호 변경은 고를 문구만 다르고 **갈래는 똑같다**: 연결이 안 됐는가, 서버가
 * 우리 계약대로 말했는가, 그 코드에 우리가 준비한 문구가 있는가. 이 갈래를 화면마다 다시
 * 쓰면 한쪽만 고쳐져서 같은 실패가 화면마다 다르게 보이게 된다.
 *
 * # 왜 `lib/api.ts` 가 아니라 여기인가
 *
 * `api.ts` 는 서버 계약과 1:1 로 맞춰 둔 파일이라 건드리지 않는다. 그리고 문구를 고르는 일은
 * 전송의 일이 아니라 **화면의 일**이다 — 스토어도 api 도 문구를 정하지 않고, 실패를 그대로
 * 던진다. 그 실패를 말로 옮기는 마지막 한 단계만 여기 모아 둔다.
 */

import { ApiError, ApiTimeoutError } from '@/lib/api';
import type { ApiErrorCode } from '@/types/api';

/**
 * 서버가 200 을 줬지만 계약과 다른 모양이 왔다.
 *
 * 상태 코드가 온 실패(`ApiError`)도 연결 실패도 아니라서 둘 중 어느 쪽으로도 말할 수 없다.
 * 이 갈래가 없으면 「로그인은 성공했는데 토큰이 없는」 응답이 그대로 저장돼, **그 뒤의 모든
 * 요청이 401 로 떨어지는** 훨씬 알아보기 어려운 고장으로 나타난다.
 */
export class ContractError extends Error {
  constructor(public readonly what: string) {
    super(`서버 응답이 계약과 달라요: ${what}`);
    this.name = 'ContractError';
  }
}

/** 연결 자체가 안 됐을 때. 자격 문제와 **반드시 다르게** 말해야 하는 자리다. */
const UNREACHABLE = '지금 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요';
const TIMED_OUT = '서버가 제때 응답하지 않았어요. 네트워크를 확인하고 다시 시도해 주세요';
const BROKEN_CONTRACT = '서버 응답을 이해하지 못했어요. 잠시 후 다시 시도해 주세요';

/**
 * 실패 하나를 화면에 띄울 문구로 옮긴다.
 *
 * 순서에 이유가 있다.
 *
 * 1. **연결이 안 된 실패를 먼저 걸러낸다.** 타임아웃·네트워크 오류를 「이메일 또는 비밀번호가
 *    맞지 않아요」로 말하면, 서버가 꺼져 있는 동안 사람은 맞는 비밀번호를 계속 다시 친다.
 *    지금 이 앱에서는 이게 가정이 아니다 — **인증 엔드포인트가 아직 WAS 에 없어서** 모든
 *    호출이 404 로 떨어진다.
 *
 * 2. **`code` 가 없는 본문은 우리 서버가 쓴 것이 아니다.** WAS 는 실패를 언제나
 *    `{ code, message, details }` 로 준다. 반대로 앞단(nginx·CDN)이 내려준 HTML 오류
 *    페이지는 `api.ts` 가 `{ message: 본문 앞 200자 }` 로 접어서 넘긴다(→ `lib/api.ts`) —
 *    그대로 믿고 띄우면 **HTML 조각이 사용자 화면에 그대로 뜬다.** 그래서 `code` 를 우리
 *    봉투인지 아닌지의 표식으로 쓴다.
 *
 * 3. **그 다음에야 `message` 를 그대로 쓴다.** 서버가 한국어 문구를 주기로 했으므로, 화면이
 *    코드마다 번역을 또 만들면 **같은 실패에 두 벌의 문구가 생긴다** — 서버가 문구를 고친
 *    날에도 앱은 옛 문구를 말하고, 어느 쪽이 맞는지 아무도 모른다. `defaults` 는 서버가
 *    `message` 를 빠뜨렸을 때만 쓰는 예비다.
 */
export function readApiErrorMessage(
  error: unknown,
  defaults: Partial<Record<ApiErrorCode, string>>,
  fallback: string,
): string {
  if (error instanceof ApiTimeoutError) return TIMED_OUT;
  if (error instanceof ContractError) return BROKEN_CONTRACT;

  // `fetch` 자체가 던진 것(연결 거부 · DNS · CORS). 상태 코드가 아예 없다.
  if (!(error instanceof ApiError)) return UNREACHABLE;

  if (error.status === 429) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요';

  const code = error.code;
  if (code === null) {
    /*
     * 우리 봉투가 아니다. 404 는 **엔드포인트가 없다**는 뜻이고(지금이 정확히 그 상황이다),
     * 5xx 는 서버가 요청을 처리하지 못했다는 뜻이다 — 둘 다 사용자가 입력을 고쳐서 풀 수
     * 있는 문제가 아니므로 「연결할 수 없어요」 계열로 말한다.
     */
    if (error.status === 404 || error.status >= 500) return UNREACHABLE;
    return fallback;
  }

  const serverMessage = error.serverMessage;
  if (serverMessage) return serverMessage;

  return defaults[code as ApiErrorCode] ?? fallback;
}
