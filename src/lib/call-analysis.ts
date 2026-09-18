/**
 * 업로드 직전 **모양 맞추기.**
 *
 * 🔧 이 파일에는 기기 추론이 들어 있었다 — 프롬프트, 구간 나누기, 줄 단위 출력 파서,
 * 요약 통합. 분석이 서버로 옮겨간 지금 그것들은 부르는 곳이 없어 전부 걷었다
 * (`git show HEAD:src/lib/call-analysis.ts` 로 볼 수 있다).
 *
 * 남은 하나는 여전히 필요하다: 기기 분석이 만들어 두고 **끝내 올리지 못한 결과**를 마저
 * 올릴 때(→ `call-runtime.ts`), 서버 계약에 맞는 모양인지 여기서 확인한다. 서버의 400 은
 * 다시 보내도 같은 답이 오는 영구 실패라 **보내기 전에** 걸러야 한다.
 */
import type { TranscriptSegment } from '@/types/calls';

const byteLength = (v: string) => unescape(encodeURIComponent(v)).length;

/**
 * 서버 계약(공백 세그먼트 금지, start 비감소, end 상한, 개수·용량 상한)을 맞춘다.
 * 고칠 수 있는 것은 고치고, 고칠 수 없는 것은 코드로 거절한다(→ `lib/call-errors.ts`).
 */
export function sanitizeTranscript(input: { text: string; segments: TranscriptSegment[] }): { text: string; segments: TranscriptSegment[] } {
  if (!input || !Array.isArray(input.segments)) throw new Error('UNKNOWN');
  const segments: TranscriptSegment[] = [];
  let last = 0;
  for (const segment of input.segments) {
    // 공백만 있는 세그먼트는 서버가 거부한다. 내용이 없으니 그냥 버린다.
    if (!segment || typeof segment.text !== 'string' || !segment.text.trim()) continue;
    if (byteLength(segment.text) > 64000) throw new Error('CALL_TOO_LARGE');
    const start = Math.min(Math.max(Number.isFinite(segment.start) ? segment.start : last, last), 86400);
    const end = Math.min(Math.max(Number.isFinite(segment.end) ? segment.end : start, start), 86400);
    const speaker = typeof segment.speaker === 'string' && segment.speaker.trim() && byteLength(segment.speaker) <= 100 ? segment.speaker : undefined;
    segments.push({ start, end, text: segment.text, ...(speaker ? { speaker } : {}) });
    last = start;
  }
  if (!segments.length) throw new Error('EMPTY_TRANSCRIPT');
  if (segments.length > 20000) throw new Error('CALL_TOO_LARGE');
  const text = typeof input.text === 'string' && input.text.trim() ? input.text : segments.map(s => s.text).join(' ');
  if (byteLength(text) > 4 * 1024 * 1024) throw new Error('CALL_TOO_LARGE');
  return { text, segments };
}
