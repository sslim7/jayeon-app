/**
 * 통화일시의 순수 계산 — 화면과 테스트가 함께 쓴다.
 *
 * 입력과 표시는 **기기 현지 시간**(`YYYY-MM-DD HH:mm`), 저장·전송은 ISO 다. 두 형식이 섞이면
 * 시간대만큼 어긋난 통화가 조용히 저장되므로 변환은 이 파일 밖에서 하지 않는다.
 */

/** 기기 시계 오차 여유. `call-upload.ts` 의 `CLOCK_SKEW_MS`, 서버 계약과 같은 값이어야 한다. */
export const CALL_CLOCK_SKEW_MS = 5 * 60_000;

/** 현지 시각을 화면 형식으로 적는다. */
export function callLocalTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 화면 형식을 현지 시각으로 읽어 ISO 로 돌려준다. 형식·실재·미래를 모두 여기서 막는다 —
 * 같은 검사를 화면마다 다시 적으면 한쪽만 느슨해진다.
 */
export function parseCallTime(value: string, now = new Date()): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!parts) throw new Error('통화일시를 2026-09-17 14:20 형식으로 입력해 주세요.');
  const [year, month, day, hour, minute] = parts.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  // 2026-02-31 같은 값은 Date 가 조용히 다음 달로 넘긴다. 되돌려 적어 보고 다르면 거절한다.
  if (year < 1000 || callLocalTime(date) !== value.trim()) throw new Error('유효한 통화일시를 입력해 주세요.');
  // 기기 시계 오차 5분까지만 인정한다. 그 이상은 서버가 거부하므로 여기서 이유를 밝혀 막는다.
  if (date.getTime() > now.getTime() + CALL_CLOCK_SKEW_MS) throw new Error('미래의 통화일시는 입력할 수 없습니다. 통화일시와 기기 시계를 확인해 주세요.');
  return date.toISOString();
}

/**
 * 고른 파일의 시각으로 통화일시 기본값을 만든다.
 *
 * 값이 없거나 미래(기기 시각 + 여유)면 **빈 문자열**이다 — 틀린 값을 미리 채워 두면 사용자가
 * 그대로 보내지만, 비어 있으면 스스로 고른다. 파일 시각은 복사·전달 과정에서 바뀌므로
 * 어차피 실제 통화 시각이라는 보장이 없다(화면의 안내 문구가 그 점을 말한다).
 */
export function defaultCallTime(fileTime: number | null | undefined, now = new Date()): string {
  // 파일 시각을 읽을 수 없거나 미래면 현재 시각을 넣는다. 빈 칸으로 두면 통화일시를 손으로
  // 다 적어야 하는데, 방금 끝난 통화를 바로 분석하는 경우가 흔해 현재 시각이 더 가깝다.
  const usable = typeof fileTime === 'number' && Number.isFinite(fileTime) && fileTime > 0 && fileTime <= now.getTime() + CALL_CLOCK_SKEW_MS;
  return callLocalTime(usable ? new Date(fileTime) : now);
}

/**
 * 화면 값 ↔ `<input type="datetime-local">` 값(`YYYY-MM-DDTHH:mm`) 변환.
 *
 * 브라우저가 돌려주는 값에는 초가 붙을 수 있고(`14:20:00`), 비어 있을 수도 있다.
 * 읽을 수 없는 값은 빈 문자열로 떨어뜨려 저장 직전 검사에서 다시 걸리게 둔다.
 */
export function toDateTimeInput(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value.trim()) ? value.trim().replace(' ', 'T') : '';
}

export function fromDateTimeInput(value: string): string {
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value.trim());
  return parts ? `${parts[1]} ${parts[2]}` : '';
}

/**
 * 목록 한 줄에 적는 통화일시 — `26.09.18 오후 2:31`.
 *
 * 🔴 **`toLocaleString('ko-KR')` 을 쓰지 않는다.** 같은 옵션(`dateStyle: 'short'`)이라도
 * 엔진에 따라 `26. 9. 18.` 처럼 점 뒤에 공백이 붙거나 붙지 않고 월·일의 자리수도 들쭉날쭉해
 * 줄마다 첫 칸의 폭이 달라진다. 한 줄 목록에서 일시는 **세로로 자리가 맞아야** 훑을 수
 * 있으므로 자리수를 직접 채운다(연도는 두 자리 — 같은 해의 통화가 대부분이라 앞 두 자리는
 * 이름이 설 자리를 뺏을 뿐이다).
 *
 * 읽을 수 없는 시각은 빈 문자열이다. `Invalid Date` 를 그대로 그리면 서버 값이 깨진 것을
 * 사용자가 「앱이 고장 났다」로 읽는다.
 */
export function callBriefTime(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  const hour = date.getHours();
  return `${pad(date.getFullYear() % 100)}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${pad(date.getMinutes())}`;
}
