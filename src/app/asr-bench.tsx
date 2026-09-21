/**
 * `/asr-bench` — 받아쓰기 시험 라우트.
 *
 * 화면 알맹이는 `components/asr-bench(.web).tsx` 에 있고 여기서는 이름으로만 부른다.
 * 🔴 **라우트 파일에 직접 쓰면 안 된다** — 라우트는 웹 번들에도 들어가므로 여기서
 * `whisper.rn` 을 import 하면 웹이 깨진다(→ `components/asr-bench.web.tsx`).
 */
import { useMemo } from 'react';

import { useScreenHeader } from '@/components/app-navigation';
import { AsrBench } from '@/components/asr-bench';
import { ENV } from '@/config/env';
import { useShellExit } from '@/hooks/use-shell-exit';

export default function AsrBenchScreen() {
  const close = useShellExit('/sms/new');
  /**
   * 🔧 **껍데기에서는 이 화면이 스스로 나갈 길을 세운다.** 껍데기 모드에는 ☰ 서랍이 없어서
   * (목적지가 전부 웹뷰 안이다 → `components/app-navigation.tsx`) 머리를 올리지 않으면
   * **나갈 버튼이 하나도 없는 화면**이 된다.
   *
   * ⚠️ 껍데기가 아니면 `null` 이다 — 그때 이 화면은 서랍의 메뉴 항목이라 왼쪽이 ☰ 여야
   * 맞다. 「‹ 뒤로」로 바꿔 버리면 메뉴에서 들어온 사람이 메뉴를 잃는다.
   */
  useScreenHeader(useMemo(() => (ENV.webShell ? { title: '받아쓰기 시험', onBack: close } : null), [close]));
  return <AsrBench />;
}
