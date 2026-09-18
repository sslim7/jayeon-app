/**
 * 「이 통화의 녹음을 지금 들을 수 있나」 한 곳.
 *
 * 목록의 재생 버튼과 재생 패널이 같은 답을 써야 한다 — 버튼은 눌리는데 패널이 「없다」고 하면
 * 사용자는 무엇이 고장 났는지 알 수 없다. 그래서 판정을 여기 하나에 둔다.
 *
 * 🔴 **들을 수 없으면 이유를 돌려준다.** 재생기를 그려 두고 아무 소리도 나지 않게 두는 것이
 * 가장 나쁘다 — 사용자는 자기 기기를 의심하게 된다.
 */
import type { CallRecord } from '@/types/calls';

/** 녹음 보관 기간. 서버가 이 기간이 지난 녹음을 지운다. */
export const AUDIO_RETENTION_DAYS = 365;
const DAY_MS = 86_400_000;

/** 들을 수 있으면 주소, 아니면 이유. `url` 하나로 갈라 보도록 성공 쪽에도 자리를 비워 둔다. */
export type CallAudioState = { url: string; reason?: undefined } | { url: null; reason: string };

export function callAudio(item: CallRecord, now: number = Date.now()): CallAudioState {
  const recorded = Date.parse(item.call.recorded_at);
  if (Number.isFinite(recorded) && now - recorded > AUDIO_RETENTION_DAYS * DAY_MS) {
    return { url: null, reason: `보관 기간(${AUDIO_RETENTION_DAYS}일)이 지나 녹음이 삭제되었습니다.` };
  }
  // 서버 업로드가 붙기 전에는 여기서 끝난다. 없는 기능을 약속하지 않고 현재 상태만 말한다.
  if (!item.audio_url) return { url: null, reason: '녹음이 아직 준비되지 않았습니다.' };
  return { url: item.audio_url };
}
