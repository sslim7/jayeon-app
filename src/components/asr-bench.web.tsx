/**
 * 받아쓰기 시험 — **웹 자리채움.**
 *
 * 🔴 **이 파일이 웹 번들을 지킨다.** 네이티브 쪽(`asr-bench.tsx`)은 `whisper.rn` 과
 * `NatureCallAudio` 를 import 하는데, 웹 번들에 그것이 딸려 들어가면 **로그인 이후 화면
 * 전부가 웹인 이 앱의 주 무대가 통째로 깨진다.** 라우트(`app/asr-bench.tsx`)가 이 컴포넌트를
 * 이름으로만 부르고, Metro 가 플랫폼에 따라 둘 중 하나를 고른다 — `call-put.ts` /
 * `call-put.web.ts` 와 같은 관례다.
 *
 * ⚠️ 그래서 여기서는 **네이티브 모듈을 한 줄도 import 하지 않는다.** 타입만 가져오는 것도
 * 안 된다 — 값 import 로 바뀌는 순간 번들러가 따라 들어간다.
 */
import { Notice, SmsPage } from '@/components/sms-ui';

export function AsrBench() {
  return <SmsPage title="받아쓰기 시험">
    <Notice message="받아쓰기 측정은 폰에서만 할 수 있습니다. 안드로이드 앱에서 ☰ 메뉴의 「받아쓰기 시험」을 열어 주세요." />
  </SmsPage>;
}
