/**
 * 폰에서 받아쓰는 화면 — **웹 자리채움.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이 파일이 웹 번들을 지킨다.** 네이티브 쪽은 `whisper.rn` 과 `NatureCallAudio` 를  │
 * │ 부르는 모듈을 import 한다. 웹 번들에 그것이 딸려 들어가면 **로그인 이후 화면 전부가**  │
 * │ 깨진다 — 이 앱의 주 무대가 그 웹이다(→ `components/asr-bench.web.tsx` 의 같은 이유). │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 라우트 자체는 양쪽에 둔다. 웹 주소로 이 화면을 열었을 때 **「앱에서만 됩니다」를 말해
 * 주어야** 하기 때문이다 — 라우트를 네이티브에만 두면 같은 상황이 not-found 로 보이고,
 * 그러면 사용자는 링크가 깨진 줄 안다.
 *
 * ⚠️ 여기서는 **네이티브 모듈을 한 줄도 import 하지 않는다.** 타입만 가져오는 것도 안 된다 —
 * 값 import 로 바뀌는 순간 번들러가 따라 들어간다.
 */
import { router } from 'expo-router';

import { Notice, SmsButton, SmsPage } from '@/components/sms-ui';

export function CallAsrRun(_props: {
  callId: string;
  model?: string;
  sourceUri?: string;
  sourceName?: string;
  sourceBytes?: number;
}) {
  return <SmsPage title="폰에서 받아쓰기">
    <Notice message="폰에서 받아쓰기는 앱에서만 됩니다. 이 통화는 앱의 통화분석 화면에서 이어 주세요." />
    <SmsButton label="통화 목록으로" secondary onPress={() => router.replace('/calls')} />
  </SmsPage>;
}
