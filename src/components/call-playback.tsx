import { Text } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { CallAudioPlayer } from '@/components/call-audio-player';
import { Notice, s } from '@/components/sms-ui';
import { callAudio } from '@/lib/call-audio';
import { formatPhone } from '@/lib/phone';
import type { CallRecord } from '@/types/calls';

/**
 * 녹음 듣기 패널.
 *
 * 목록에서 ▶ 를 누르면 아래에서 올라온다(등록 시트와 같은 `BottomSheet`). 🔴 **들을 수 없는
 * 통화에는 재생기를 그리지 않는다** — 소리 나지 않는 재생기 대신 이유 한 줄을 세운다.
 */
export function CallPlayback({ item, onClose }: { item: CallRecord; onClose: () => void }) {
  const audio = callAudio(item);
  return <BottomSheet title="녹음 듣기" visible onClose={onClose}>
    <Text style={s.body}>{item.contact.name} · {formatPhone(item.contact.phone)}</Text>
    <Text style={s.meta}>{new Date(item.call.recorded_at).toLocaleString('ko-KR')}</Text>
    {audio.url !== null ? <CallAudioPlayer url={audio.url} label={`${item.contact.name} 통화 녹음`} /> : <Notice message={audio.reason} />}
  </BottomSheet>;
}
