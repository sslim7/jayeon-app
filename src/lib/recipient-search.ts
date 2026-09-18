/**
 * 수신자 검색 한 곳.
 *
 * # 왜 한 곳인가
 *
 * 이름으로 거르는 입력이 네 화면(문자 보내기·수신자 관리·통화분석 목록·통화분석 수신자 선택)에
 * 있다. 화면마다 `name.toLowerCase().includes(...)` 를 적어 두면 「뒷자리로도 찾게」 같은 규칙이
 * 바뀔 때 한 화면만 빠뜨리기 쉽고, **빠뜨려도 아무것도 깨지지 않아서** 아무도 모른다.
 *
 * # 규칙
 *
 * - 빈 검색어 → 전체.
 * - 이름에 검색어가 그대로 들어 있으면 → 통과(부분 일치, 대소문자 무시).
 * - 숫자만 친 검색어 → 이름과 전화번호 **둘 다** 본다(이름에 숫자가 든 사람이 있다).
 * - 글자와 숫자가 섞인 검색어 → 글자는 이름, 숫자는 번호를 가리킨다고 본다(「김영 7649」 →
 *   이름에 "김영" 이 있고 번호에 "7649" 가 있는 사람). 숫자만 떼어 번호를 맞히면 이름과
 *   상관없는 사람이 올라오므로 그렇게 하지 않는다.
 * - 하이픈·공백·괄호·`+82` 같은 표기 차이는 양쪽 모두 걷어 내고 숫자만 비교한다.
 */

import { canonicalStoredPhone } from '@/lib/phone';

/**
 * 표기를 걷고 숫자만 남긴다.
 *
 * `canonicalStoredPhone` 은 **완성된** 번호만 다루므로(`+8210` + 8자리) 검색어처럼 잘린 입력에는
 * 쓸 수 없다. 그래서 같은 규칙(국가번호 `+82` → `0`)만 느슨하게 옮겨 적는다.
 */
function searchDigits(value: string): string {
  const compact = value.replace(/[\s\-().]/g, '');
  const local = compact.startsWith('+82') ? `0${compact.slice(3)}` : compact;
  return local.replace(/\D/g, '');
}

/** 저장된 번호는 완성형이므로 기존 정규화를 그대로 통과시킨 뒤 숫자만 남긴다. */
function phoneDigits(value: string): string {
  return searchDigits(canonicalStoredPhone(value));
}

export function matchesRecipientQuery(query: string, target: { name?: string | null; phone?: string | null }): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const name = (target.name ?? '').toLowerCase();
  if (name.includes(trimmed.toLowerCase())) return true;
  const digits = searchDigits(trimmed);
  if (!digits) return false;
  // 숫자를 뺀 나머지가 이름 쪽 단서다. 남아 있으면 이름이 먼저 맞아야 번호를 본다.
  const letters = trimmed.replace(/[\d\s\-+().]/g, '').toLowerCase();
  if (letters && !name.includes(letters)) return false;
  return phoneDigits(target.phone ?? '').includes(digits);
}
