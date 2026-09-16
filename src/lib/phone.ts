// 입력 구분자는 제거하지만 국내 010 휴대전화의 앞자리와 길이는 엄격히 확인한다.
export function normalizePhone(value: string): string {
  const phone = value.trim().replace(/[\s-]/g, '');
  if (!/^010\d{8}$/.test(phone)) {
    throw new Error('전화번호는 010으로 시작하는 숫자 11자리여야 해요. (예: 010-1234-5678)');
  }
  return phone;
}

// 기존 국가번호 형식은 읽을 때만 호환한다. 새 입력의 010 검증을 우회하지 않는다.
export function canonicalStoredPhone(value: string): string {
  const phone = value.trim().replace(/[\s-]/g, '');
  return /^\+8210\d{8}$/.test(phone) ? `0${phone.slice(3)}` : phone;
}

export function formatPhone(value: string): string {
  const phone = canonicalStoredPhone(value);
  return /^010\d{8}$/.test(phone) ? `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}` : phone;
}

export function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const point = char.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
