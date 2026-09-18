import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { CallAudioPlayer } from '@/components/call-audio-player';
import { Loading, Notice, s } from '@/components/sms-ui';
import { callApi } from '@/lib/call-api';
import { callAudio } from '@/lib/call-audio';
import { formatPhone } from '@/lib/phone';
import { formatDuration } from '@/lib/call-progress';
import type { CallRecord } from '@/types/calls';

/**
 * 녹음 듣기 패널.
 *
 * 목록에서 ▶ 를 누르면 아래에서 올라온다(등록 시트와 같은 `BottomSheet`).
 *
 * **주소는 여기서 구한다.** 목록 응답에는 녹음 주소가 없다 — 서버가 상세를 읽을 때마다 서명
 * 주소를 새로 발급하고, 목록 30건마다 서명을 만들지 않기로 했기 때문이다
 * (§`internal/calls/model.go`). 그래서 패널이 열릴 때 그 통화의 상세를 한 번 물어본다.
 *
 * 🔴 **들을 수 없는 통화에는 재생기를 그리지 않는다** — 소리 나지 않는 재생기 대신 이유 한 줄을
 * 세운다. 사용자가 자기 기기를 의심하게 만들지 않기 위해서다.
 */
export function CallPlayback({ item, onClose }: { item: CallRecord; onClose: () => void }) {
  const [record, setRecord] = useState<CallRecord>(item);
  const [asking, setAsking] = useState(!item.audio_url);
  useEffect(() => {
    // 이미 주소를 들고 있으면(기기 기록 등) 더 물을 것이 없다.
    if (item.audio_url) return;
    let live = true;
    callApi.get(item.call_id)
      .then((found) => { if (live && found) setRecord(found); })
      // 물어보지 못했으면 지금 아는 것(주소 없음)으로 답한다. 실패 이유를 또 설명하지 않는다.
      .catch(() => {})
      .finally(() => { if (live) setAsking(false); });
    return () => { live = false; };
  }, [item]);
  const audio = callAudio(record);
  return <BottomSheet title="녹음 듣기" visible onClose={onClose}>
    <Text style={s.body}>{item.contact.name} · {formatPhone(item.contact.phone)}</Text>
    <Text style={s.meta}>{new Date(item.call.recorded_at).toLocaleString('ko-KR')}{item.call.duration ? ` · ${formatDuration(item.call.duration * 1000)}` : ''}</Text>
    {asking ? <Loading /> : audio.url !== null ? <CallAudioPlayer url={audio.url} label={`${item.contact.name} 통화 녹음`} /> : <Notice message={audio.reason} />}
  </BottomSheet>;
}
