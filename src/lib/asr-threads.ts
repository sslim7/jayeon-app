/**
 * 받아쓰기에 쓸 스레드 수.
 *
 * # 왜 전체 코어를 쓰지 않나
 *
 * 안드로이드 폰은 big.LITTLE 이다(갤럭시 S25 = 2 + 6, S21 = 1 + 3 + 4). 작은 코어까지 끌어
 * 쓰면 한 배치가 **가장 느린 코어를 기다리느라** 오히려 느려지고, 전부 태우면 몇 분 만에
 * 열로 클럭이 내려간다 — 28분 통화 받아쓰기는 그 스로틀 구간이 곧 전체 속도다.
 * whisper.cpp 가 권하는 기본값도 「성능 코어 수」이고, 그 값은 요즘 기기에서 대체로
 * **코어 수의 절반**이다.
 *
 * 코어 수를 알 수 없으면(구버전 네이티브 껍데기) **2로 둔다.** 모르는 기기에서 갑자기 더
 * 태우는 쪽보다 보수적인 값이 안전하다.
 *
 * ⚠️ **이 값이 이번 측정의 변수 중 하나다.** `docs/on-device-asr.md` 3절이 지적한 대로, 예전
 * 폰 받아쓰기 실패가 모델 크기가 아니라 **1스레드 CPU** 라는 나쁜 설정 탓이었을 가능성이
 * 있다. 그래서 시험 화면은 이 기본값을 쓰되 **몇으로 돌았는지 반드시 표시한다** — 숫자 없이
 * 「느렸다」만 남으면 그 실패를 또 잘못 해석하게 된다.
 *
 * ⚠️ NPU(Hexagon) 경로에서는 인코더가 DSP 로 넘어가므로 스레드 수의 영향이 줄어든다.
 * 그래도 디코더와 mel 추출은 CPU 라 0 이 되지는 않는다.
 */
export const MAX_ASR_THREADS = 6;

export function asrThreads(cores: number | null | undefined): number {
  if (typeof cores !== 'number' || !Number.isFinite(cores) || cores < 1) return 2;
  return Math.max(2, Math.min(MAX_ASR_THREADS, Math.floor(cores / 2)));
}
