/**
 * `/asr-bench` — 받아쓰기 시험 라우트.
 *
 * 화면 알맹이는 `components/asr-bench(.web).tsx` 에 있고 여기서는 이름으로만 부른다.
 * 🔴 **라우트 파일에 직접 쓰면 안 된다** — 라우트는 웹 번들에도 들어가므로 여기서
 * `whisper.rn` 을 import 하면 웹이 깨진다(→ `components/asr-bench.web.tsx`).
 */
import { AsrBench } from '@/components/asr-bench';

export default function AsrBenchScreen() {
  return <AsrBench />;
}
