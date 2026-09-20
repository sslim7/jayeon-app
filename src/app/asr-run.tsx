/**
 * `/asr-run` — 폰 받아쓰기 진행 라우트.
 *
 * 화면 알맹이는 `components/call-asr-run(.web).tsx` 에 있고 여기서는 이름으로만 부른다.
 * 🔴 **라우트 파일에 직접 쓰면 안 된다** — 라우트는 웹 번들에도 들어가므로 여기서
 * `whisper.rn` 을 import 하면 웹이 깨진다(→ `components/call-asr-run.web.tsx`).
 *
 * ⚠️ 파라미터는 **문자열로만** 온다. 원본 크기를 숫자로 되돌리는 일은 여기서 한 번만 하고,
 * 화면은 이미 숫자인 값을 받는다 — 두 군데서 각자 `Number()` 를 부르면 한쪽만 `NaN` 처리를
 * 빠뜨린다.
 */
import { useLocalSearchParams } from 'expo-router';

import { CallAsrRun } from '@/components/call-asr-run';

export default function AsrRunScreen() {
  const { callId, model, uri, name, bytes } = useLocalSearchParams<{
    callId?: string; model?: string; uri?: string; name?: string; bytes?: string;
  }>();
  const size = Number(bytes);
  return <CallAsrRun
    callId={callId ?? ''}
    model={model}
    sourceUri={uri}
    sourceName={name}
    // 크기는 화면에 적는 값일 뿐이라 모를 때는 0 이다. 🔴 받아쓰기의 판단에는 쓰이지 않는다.
    sourceBytes={Number.isFinite(size) ? size : 0}
  />;
}
