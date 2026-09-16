/** 입력과 표시는 단말의 현지 시각, API 전송은 시간대가 있는 ISO 시각으로 통일한다. */
export function externalSendLocalTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function parseExternalSendTime(value: string, now = new Date()): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!parts) throw new Error('발송일시는 YYYY-MM-DD HH:mm 형식으로 입력해 주세요.');
  const [year, month, day, hour, minute] = parts.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (year < 1000 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) throw new Error('실제 존재하는 발송일시를 입력해 주세요.');
  if (date.getTime() > now.getTime()) throw new Error('미래의 발송일시는 등록할 수 없어요.');
  return date.toISOString();
}
