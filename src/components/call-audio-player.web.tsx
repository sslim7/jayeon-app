import { colors, radii } from '@/constants/theme';
import type { CallAudioPlayerProps } from './call-audio-player-types';

/**
 * 녹음 재생 — **웹(웹뷰 포함).**
 *
 * 브라우저 기본 재생기(`<audio controls>`)를 그대로 쓴다. 재생·탐색·속도·볼륨이 이미 들어
 * 있고 낭독기도 아는 조작이라, 이 한 자리를 위해 재생 라이브러리를 들일 이유가 없다
 * (통화일시 입력이 `<input type="datetime-local">` 을 쓰는 것과 같은 이유다).
 */
export function CallAudioPlayer({ url, label }: CallAudioPlayerProps) {
  return <audio controls preload="none" src={url} aria-label={label} style={{ width: '100%', borderRadius: radii.button, backgroundColor: colors.card }} />;
}
