/**
 * 등록 시트의 「로컬 받아쓰기」 한 칸 — **네이티브.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **웹에는 이 칸이 아예 없다**(→ `call-asr-option.web.tsx`). whisper 는 네이티브     │
 * │ 전용이라, 웹에서 이 칸을 세우면 누를 수는 있는데 아무 일도 일어나지 않는 체크박스가      │
 * │ 된다. 가려 두는 것으로는 부족하다 — 이 파일이 import 하는 것들이 웹 번들에 딸려        │
 * │ 들어가면 로그인 이후 화면 전부가 깨진다(→ `components/asr-bench.web.tsx` 의 같은 이유).│
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **여기서 벤치를 돌리지 않는다.** 판정은 모델 적재만 17.8초다. 「+」를 눌렀을 때 시트가
 * 20초 멈추면 사용자가 겪는 일은 「받아쓰기가 빨라졌다」가 아니라 「등록이 느려졌다」이다.
 * 이미 잰 값만 읽고, 재는 일은 `/asr-setup` 으로 보낸다(판단은 `lib/asr-choice.ts`).
 */
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Choice, Notice, SmsButton } from '@/components/sms-ui';
import { spacing } from '@/constants/theme';
import { APP_VERSION } from '@/constants/app-meta';
import { isFreshCapability, loadAsrCapability } from '@/lib/asr-capability';
import { asrChoice, ASR_SETUP_PATH, type AsrModelFacts } from '@/lib/asr-choice';
import { ASR_MODELS, modelStatus, type AsrModelId } from '@/lib/asr-models';
import { callAudioNativeAvailable, socInfo } from '@/lib/call-native';

export type CallAsrOptionProps = {
  /** 켜져 있으면 쓸 모델, 꺼져 있으면 `null`. 🔴 **상태는 시트가 들고 있다** — 등록할 때 쓴다. */
  modelId: AsrModelId | null;
  onChange: (next: AsrModelId | null) => void;
  /** 올리는 중에는 못 바꾼다. 도중에 바뀌면 이미 보낸 `complete` 와 어긋난다. */
  disabled?: boolean;
};

/** 모델별 사실을 파일에서 읽어 온다. 벤치는 돌리지 않는다 — 전부 파일 조회다. */
async function readFacts(): Promise<AsrModelFacts[]> {
  const facts: AsrModelFacts[] = [];
  for (const model of ASR_MODELS) {
    const installed = (await modelStatus(model)).installed;
    // 🔴 모델이 없으면 판정을 보지 않는다. 옛 판정이 「사용 가능」으로 남아 있어도
    // 모델을 지운 뒤에는 거짓이다.
    const capability = installed ? await loadAsrCapability(model.id) : null;
    facts.push({ id: model.id, installed, capability, fresh: isFreshCapability(capability, model.id, APP_VERSION) });
  }
  return facts;
}

export function CallAsrOption({ modelId, onChange, disabled = false }: CallAsrOptionProps) {
  const [facts, setFacts] = useState<AsrModelFacts[] | null>(null);
  /** 눌러 봤는데 안 되더라. 그때만 이유를 크게 말한다 — 평소에는 한 줄로 족하다. */
  const [nudged, setNudged] = useState(false);
  /**
   * 사용자가 한 번이라도 손을 댔나. 🔴 **손댄 뒤에는 기본값을 다시 적용하지 않는다** —
   * 껐는데 판정이 늦게 도착해 저절로 다시 켜지면, 사용자는 끈 적 없는 상태를 보게 된다.
   */
  const touched = useRef(false);
  // 시트가 다시 그려질 때마다 효과가 도는 것을 막는다(부모가 화살표 함수를 그대로 넘긴다).
  const notify = useRef(onChange);
  useEffect(() => { notify.current = onChange; }, [onChange]);

  useEffect(() => {
    let alive = true;
    // 다음 틱으로 미룬다. 효과 안에서 곧바로 상태를 바꾸면 렌더 중 갱신으로 잡힌다(react-compiler 규칙).
    void Promise.resolve().then(async () => {
      // 🔴 실패해도 조용히 「모름」으로 둔다. 받아쓰기 때문에 통화 등록이 막히면 안 된다.
      const read = await readFacts().catch(() => [] as AsrModelFacts[]);
      if (alive) setFacts(read);
    });
    return () => { alive = false; };
  }, []);

  const choice = asrChoice({ platform: Platform.OS, nativeAvailable: callAudioNativeAvailable(), soc: socInfo(), facts });

  // 쓸 수 있으면 기본으로 켠다. 판정이 도착한 뒤에야 알 수 있어 여기서 한 번 올려 준다.
  useEffect(() => {
    if (!choice.checked || !choice.modelId || touched.current) return;
    notify.current(choice.modelId);
  }, [choice.checked, choice.modelId]);

  if (!choice.visible) return null;

  const on = modelId !== null;
  return <View style={styles.box}>
    <Choice
      plain
      label="로컬 받아쓰기 (폰에서 받아쓰기)"
      selected={on}
      // ⚠️ 못 쓰는 상태에서도 **누를 수는 있어야 한다.** 눌러도 아무 일이 없으면 사용자는
      // 앱이 고장 난 줄 알고 계속 누른다 — 누르면 이유를 말해 준다.
      disabled={disabled || choice.pending}
      onPress={() => {
        if (!choice.enabled) { setNudged(true); return; }
        touched.current = true;
        onChange(on ? null : choice.modelId);
      }}
    />
    <Notice message={choice.reason} />
    {/*
      🔴 켜 두면 **받아쓰기가 끝날 때까지 그 화면을 열어 두어야 한다.** iOS 는 백그라운드 앱에
      CPU 를 주지 않아 화면을 나가면 그 자리에서 멈춘다. 등록을 누르기 전에 말해 주지 않으면,
      사용자는 「등록했으니 됐다」고 생각하고 앱을 닫는다(→ `app/asr-run.tsx`).
    */}
    {on ? <Notice message="등록하면 받아쓰기 화면으로 넘어갑니다. 끝날 때까지 그 화면을 열어 두세요 — 앱을 나가면 멈춥니다." /> : null}
    {/* 녹음은 어느 쪽이든 올라간다. 「폰에서 하면 안 올라간다」는 오해가 가장 비싸다. */}
    {on ? <Notice message="녹음 파일은 다시 듣기 위해 어느 경우든 서버에 올라갑니다. 달라지는 것은 받아쓰기를 누가 하느냐뿐입니다." /> : null}
    {nudged && choice.setupPath ? <SmsButton secondary label="설정에서 준비하기" disabled={disabled} onPress={() => router.push(ASR_SETUP_PATH)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  // 체크박스와 그 이유는 **한 덩어리**로 읽혀야 한다. 시트의 기본 간격(16)으로 벌어지면
  // 이유 한 줄이 아래 칸(수신자 선택)에 붙은 설명처럼 보인다.
  box: { gap: spacing.xs },
});
