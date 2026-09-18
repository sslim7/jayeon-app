import { Notice } from '@/components/sms-ui';
import type { CallAudioPlayerProps } from './call-audio-player-types';

/**
 * 녹음 재생 — **네이티브 폴백.**
 *
 * 이 화면은 실제로 웹뷰(웹 빌드)로 뜨고 재생기도 거기서 열린다(→ `call-audio-player.web.tsx`).
 * 네이티브로 직접 열리는 경로에서는 재생할 방법이 없으므로 **그 사실만 말한다** — 재생
 * 라이브러리를 쓰이지 않는 경로를 위해 들이지 않는다.
 */
export function CallAudioPlayer({ url: _url, label: _label }: CallAudioPlayerProps) {
  return <Notice message="이 화면에서는 녹음을 재생할 수 없습니다. 앱의 통화분석 화면에서 들어 주세요." />;
}
