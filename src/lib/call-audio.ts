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

/**
 * 원본 녹음 보관 기간. 서버 버킷 수명주기가 이 기간이 지난 원본을 지운다
 * (§`jayeon-was/main.go` 의 `CALL_AUDIO_RETENTION_DAYS` 기본값). **전사문과 분석은 남는다** —
 * 녹음이 사라졌다고 실패가 아니다.
 */
export const AUDIO_RETENTION_DAYS = 366;
export const AUDIO_EXPIRED_REASON = `보관 기간(${AUDIO_RETENTION_DAYS}일)이 지나 원본 녹음이 삭제되었습니다.`;
export const AUDIO_PENDING_REASON = '녹음이 아직 준비되지 않았습니다.';
export const AUDIO_DEVICE_REASON = '기기에서 분석한 옛 통화라 서버에 원본 녹음이 없습니다.';
const DAY_MS = 86_400_000;

/** 들을 수 있으면 주소, 아니면 이유. `url` 하나로 갈라 보도록 성공 쪽에도 자리를 비워 둔다. */
export type CallAudioState = { url: string; reason?: undefined } | { url: null; reason: string };

/**
 * 목록에서 ▶ 를 열어도 되나.
 *
 * 🔴 **목록 응답에는 녹음 주소가 없다.** 서버는 상세를 읽을 때마다 15분짜리 서명 주소를
 * 새로 발급하고, 목록 30건마다 서명을 만들지 않기로 했다(§`internal/calls/model.go`).
 * 목록이 받는 것은 `has_audio` 하나뿐이고, 그것이 여기서 쓰는 유일한 근거다.
 */
export function audioReady(item: CallRecord): boolean {
  return item.has_audio === true;
}

/** 보관 기간이 지났나. 통화일시만으로 답할 수 있는 유일한 질문이다. */
export function audioExpired(item: CallRecord, now: number = Date.now()): boolean {
  const recorded = Date.parse(item.call.recorded_at);
  return Number.isFinite(recorded) && now - recorded > AUDIO_RETENTION_DAYS * DAY_MS;
}

/**
 * 재생 패널이 쓰는 판정. **상세 응답을 받은 뒤**에 부른다.
 *
 * 순서에 이유가 있다. 주소가 있으면 더 물을 것이 없고, 없을 때 「왜 없는지」는 셋 중
 * 하나다 — 기기에서 분석한 옛 통화라 애초에 서버에 원본이 없거나, 보관 기간이 지나 지워졌거나,
 * 아직 처리 중이라 준비되지 않았거나.
 */
export function callAudio(item: CallRecord, now: number = Date.now()): CallAudioState {
  if (item.audio_url) return { url: item.audio_url };
  if (item.ai?.processed_on_device) return { url: null, reason: AUDIO_DEVICE_REASON };
  if (audioExpired(item, now)) return { url: null, reason: AUDIO_EXPIRED_REASON };
  return { url: null, reason: AUDIO_PENDING_REASON };
}
