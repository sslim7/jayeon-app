/**
 * 설정의 「로컬 받아쓰기」 줄에 찍을 **한 줄 상태.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **여기서 벤치를 돌리지 않는다.** 판정은 모델 적재만 18초다(→ `lib/asr-capability`). │
 * │ 설정 화면을 열 때마다 그것이 돌면 설정이 「가끔 20초 멈추는 화면」이 된다. 그래서 이     │
 * │ 훅은 **이미 저장된 판정과 파일 상태만** 읽는다 — 재는 일은 `/asr-setup` 의 버튼뿐이다. │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 **웹에서는 `supported` 가 거짓이다.** whisper 는 네이티브에서만 돈다. 눌러도 아무것도
 * 할 수 없는 줄을 세우면 사용자는 그걸 고장으로 읽으므로, 부르는 쪽은 이 값으로 **줄 자체를
 * 감춘다**(→ `app/settings.tsx`).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { APP_VERSION } from '@/constants/app-meta';
import { isFreshCapability, loadAsrCapability, socVerdict } from '@/lib/asr-capability';
import { ASR_MODELS, modelStatus, type AsrModelId } from '@/lib/asr-models';
import { callAudioNativeAvailable, socInfo } from '@/lib/call-native';

export type AsrSummary = {
  /** 이 줄을 세워도 되나. 웹이거나 네이티브 모듈이 없는 옛 껍데기면 거짓이다. */
  supported: boolean;
  /** 줄 오른쪽의 상태 배지. 아직 못 읽었으면 빈 문자열 — **모르면서 값을 지어내지 않는다.** */
  value: string;
};

/**
 * 지금 상태를 한 줄로.
 *
 * ⚠️ 순서가 곧 판단이다. **모델이 없으면 판정을 보지 않는다** — 옛 판정이 「사용 가능」으로
 * 남아 있어도 모델을 지운 뒤에는 쓸 수 없으므로, 그 줄은 거짓이 된다.
 */
async function summaryText(): Promise<string> {
  // 🔴 안드로이드에서 퀄컴이 **아닌 것이 확실하면** 모델을 보기 전에 결론이 난다.
  // iOS 는 Metal 경로라 이 판단이 아예 해당하지 않는다(→ `lib/asr-capability-types.ts`).
  /*
   * 🔴 **「지원 안 함」이라고만 적지 않는다.** 앱이 이 기기를 거부하는 것처럼 읽히는데,
   * 실제로는 **이 칩에 받아쓰기가 쓰는 NPU 가 없는 것**이다. 원인을 적어야 사용자가
   * 「내 폰이 고장인가」와 「원래 안 되는 폰인가」를 가를 수 있다.
   *
   * ⚠️ 아래 마지막 줄의 「지원 안 함」과 **원인이 다르다** — 저쪽은 NPU 유무를 떠나
   * 실제로 재 봤더니 너무 느린 경우다. 두 말을 같게 적으면 사용자는 재 볼 수 있는 폰인지
   * 아닌지 알 수 없다.
   */
  if (Platform.OS === 'android' && socVerdict(socInfo()) === 'other') return 'NPU 없는 폰';

  const installed: AsrModelId[] = [];
  for (const model of ASR_MODELS) {
    if ((await modelStatus(model)).installed) installed.push(model.id);
  }
  if (!installed.length) return '모델 없음';

  // 깔려 있는 것 중 **쓸 수 있다고 이미 잰** 것이 있으면 그것을 말한다.
  for (const id of installed) {
    const saved = await loadAsrCapability(id);
    if (isFreshCapability(saved, id, APP_VERSION) && saved?.ok) return `사용 가능 · ${id}`;
  }
  // 깔려는 있는데 잰 값이 하나도 없다. 「안 된다」가 아니라 **아직 모른다**는 뜻이다.
  for (const id of installed) {
    const saved = await loadAsrCapability(id);
    if (!isFreshCapability(saved, id, APP_VERSION)) return `검사 필요 · ${id}`;
  }
  // 깔린 모델 전부를 재 봤고 전부 불가였다. **재 본 결과**라는 것이 위의 「NPU 없는 폰」과
  // 다른 점이다 — 이 기기는 NPU 가 있을 수도 있는데 그래도 느렸다는 뜻이다.
  return '너무 느림';
}

export function useAsrSummary(): AsrSummary {
  /*
   * 렌더 중에 읽는다. 네이티브 모듈의 유무는 앱이 켜진 뒤로 바뀌지 않는 값이라, 효과로
   * 미루면 줄이 한 번 보였다 사라지는 깜빡임만 만든다(→ `app/settings.tsx` 의 껍데기 버전).
   */
  const supported = Platform.OS !== 'web' && callAudioNativeAvailable();
  const [value, setValue] = useState('');

  /*
   * 🔴 **화면에 들어올 때마다 다시 읽는다.** 한 번만 읽으면 배지가 거짓말을 한다 —
   * 설정 화면은 스택에 남은 채로 `/asr-setup` 에 다녀오므로, 거기서 모델을 내려받고
   * 돌아와도 다시 그려지지 않아 **「모델 없음」이 그대로 남는다.** 실기기에서 실제로
   * 그렇게 보였다: 모델은 폰에 있는데 설정 줄만 없다고 말하고 있었다.
   *
   * 여기서 하는 일은 파일 조회와 저장본 읽기뿐이라(벤치 아님) 들어올 때마다 해도 싸다.
   */
  useFocusEffect(useCallback(() => {
    if (!supported) return;
    let alive = true;
    // 다음 틱으로 미룬다. 효과 안에서 곧바로 상태를 바꾸면 렌더 중 갱신으로 잡힌다(react-compiler 규칙).
    void Promise.resolve().then(async () => {
      // 🔴 실패해도 조용히 빈 값으로 둔다. 설정 화면이 받아쓰기 때문에 깨지면 안 된다.
      const text = await summaryText().catch(() => '');
      if (alive) setValue(text);
    });
    return () => { alive = false; };
  }, [supported]));

  return { supported, value };
}
