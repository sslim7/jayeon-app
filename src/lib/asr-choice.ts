/**
 * 「로컬 받아쓰기」 체크박스가 **어떤 모습이어야 하는가** — 순수한 판단.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **여기에는 네이티브 import 가 하나도 없다.** 체크박스는 웹 번들에도 실리는 등록      │
 * │ 시트 안에 있다. 이 판단을 화면에 흩어 두면 「웹에서는 안 보인다」 같은 규칙을            │
 * │ `node --test` 로 확인할 길이 사라진다.                                          │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **등록 시트에서 벤치를 돌리지 않는다.** 판정은 모델 적재만 17.8초다. 「+」를 눌렀을   │
 * │ 때 시트가 20초 멈추면, 사용자가 실제로 겪는 일은 「받아쓰기가 빨라졌다」가 아니라        │
 * │ 「통화 등록이 느려졌다」이다. 그래서 여기서는 **이미 잰 값만 읽고**, 재는 일은          │
 * │ `/asr-setup` 의 버튼 하나로 모은다(설정 화면도 같은 규칙이다 → `hooks/use-asr-summary`).│
 * └────────────────────────────────────────────────────────────────────────────┘
 */
import type { AsrModelId } from './asr-models';
import {
  asrCapabilityMessage, preBenchReason,
  type AsrCapability, type SocInfo,
} from './asr-capability-types';

/** 모델을 내려받고 기기를 재는 곳. 🔴 그 화면은 다른 파일이 만든다 — 여기서는 경로만 안다. */
export const ASR_SETUP_PATH = '/asr-setup';

/**
 * 모델 하나에 대해 지금 아는 사실.
 *
 * 🔴 **셋을 따로 든다.** 「깔려 있다」와 「재 봤다」와 「된다」는 서로 다른 말이고, 뭉치면
 * 모델을 지운 뒤에도 옛 판정으로 「사용 가능」이라고 말하게 된다.
 */
export type AsrModelFacts = {
  id: AsrModelId;
  installed: boolean;
  /** 저장된 판정. 없으면 `null`. */
  capability: AsrCapability | null;
  /** 그 판정을 지금 그대로 써도 되나(모델·앱 버전이 같은가 → `isFreshCapability`). */
  fresh: boolean;
};

/** 체크박스 하나의 모습. 화면은 이 값만 보고 그린다. */
export type AsrChoice = {
  /** 🔴 웹에서는 **아예 그리지 않는다.** whisper 는 네이티브 전용이다. */
  visible: boolean;
  /** 아직 파일과 저장본을 읽는 중. 보이되 누를 수 없다. */
  pending: boolean;
  enabled: boolean;
  /** 기본으로 켜 둘 것인가. 🔴 켤 수 있으면 켠다 — 통화 내용이 서버로 나가지 않는 쪽이다. */
  checked: boolean;
  /** 사용자가 읽을 한 줄. **왜 안 되는지, 그리고 무엇을 하면 되는지**를 말한다. */
  reason: string;
  /** 설정으로 보낼 것인가. 🔴 거기 가도 답이 안 바뀌는 이유일 때는 `null` 이다. */
  setupPath: string | null;
  /** 실제로 쓸 모델. 못 쓰면 `null`. */
  modelId: AsrModelId | null;
};

const CHECKING = '이 기기에서 받아쓸 수 있는지 확인하는 중이에요.';
/**
 * 🔴 **NPU 이야기를 먼저 한다.** 「느려요」만 남으면 사용자는 기다리면 되는 줄 알고 켜 보고,
 * 그다음에 28분을 기다린다. 못 쓰는 이유가 기기에 있다는 사실이 첫 문장이어야 한다.
 */
const NPU_ONLY = 'NPU 지원되는 폰만 로컬 받아쓰기 가능해요.';
const GET_MODEL = '설정에서 받아쓰기 모델을 내려받으면 쓸 수 있어요.';
/** ⚠️ 「안 된다」가 아니라 **아직 모른다**는 뜻이다. 그 차이를 문장으로 지킨다. */
const NEED_CHECK = '이 기기에서 되는지 아직 재 보지 않았어요. 설정에서 한 번 재 주세요.';

const OFF: AsrChoice = { visible: false, pending: false, enabled: false, checked: false, reason: '', setupPath: null, modelId: null };

function blocked(reason: string, setup: boolean): AsrChoice {
  return { visible: true, pending: false, enabled: false, checked: false, reason, setupPath: setup ? ASR_SETUP_PATH : null, modelId: null };
}

/**
 * 체크박스의 모습을 정한다.
 *
 * 🔴 **모르면 켜지 않는다.** 판정이 오기 전에 미리 켜 두면, 「불가」가 돌아오는 순간 체크가
 * 저절로 풀린다 — 사용자는 자기가 끈 적 없는 설정이 꺼진 것을 보게 된다.
 */
export function asrChoice(input: {
  platform: string;
  /** 네이티브 모듈이 실린 앱인가. 옛 껍데기에는 없다. */
  nativeAvailable: boolean;
  /** 해석하지 않은 AP 문자열. iOS 는 빈 값이고, 그때는 이 판단이 쓰이지 않는다. */
  soc: SocInfo | null;
  /** 모델별 사실. **아직 읽는 중이면 `null`** — 빈 배열(= 모델이 하나도 없다)과 다르다. */
  facts: readonly AsrModelFacts[] | null;
}): AsrChoice {
  if (input.platform === 'web') return OFF;
  if (!input.facts) return { ...OFF, visible: true, pending: true, reason: CHECKING };

  /*
   * 벤치 전에 이미 결론이 나는 것들은 판정 규칙에 그대로 맡긴다(웹·옛 껍데기·비퀄컴 AP·
   * 모델 없음). 🔴 규칙을 여기 다시 적으면 두 곳이 서로 다르게 판단하기 시작한다.
   */
  const installed = input.facts.filter((fact) => fact.installed);
  const early = preBenchReason({
    platform: input.platform,
    nativeAvailable: input.nativeAvailable,
    soc: input.soc,
    modelInstalled: installed.length > 0,
  });
  if (early === 'WEB') return OFF;
  if (early === 'NO_NATIVE') return blocked(asrCapabilityMessage('NO_NATIVE', null, input.soc), false);
  if (early === 'NOT_SNAPDRAGON') return blocked(`${NPU_ONLY} ${asrCapabilityMessage('NOT_SNAPDRAGON', null, input.soc)}`, false);
  if (early === 'MODEL_MISSING') return blocked(`${asrCapabilityMessage('MODEL_MISSING', null, input.soc)} ${GET_MODEL}`, true);

  // 깔린 모델 중 **쓸 수 있다고 이미 잰** 것이 있으면 그것으로 간다.
  const usable = installed.find((fact) => fact.fresh && fact.capability?.ok);
  if (usable?.capability) {
    return { visible: true, pending: false, enabled: true, checked: true, reason: usable.capability.message, setupPath: null, modelId: usable.id };
  }
  // 깔려는 있는데 잰 값이 없다. ⚠️ 여기서 재지 않는다 — 시트가 20초 멈춘다.
  if (installed.some((fact) => !fact.fresh || !fact.capability)) return blocked(NEED_CHECK, true);

  // 깔린 것을 전부 재 봤고 전부 불가였다. 그중 가장 설명이 되는 이유를 말한다.
  const measured = installed.find((fact) => fact.capability?.reason === 'SLOW') ?? installed[0];
  const message = measured?.capability?.message ?? asrCapabilityMessage('ERROR', null, input.soc);
  return blocked(measured?.capability?.reason === 'SLOW' ? `${NPU_ONLY} ${message}` : message, false);
}
