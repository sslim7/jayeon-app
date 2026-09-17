/**
 * 추론에 쓸 스레드 수.
 *
 * # 왜 전체 코어를 쓰지 않나
 *
 * 요즘 안드로이드 폰은 big.LITTLE 이다(갤럭시 S21 = 1 + 3 + 4). 작은 코어까지 끌어 쓰면 한
 * 배치가 **가장 느린 코어를 기다리느라** 오히려 느려지고, 전부 태우면 몇 분 만에 열로 클럭이
 * 내려간다 — 통화 분석은 20분 넘게 도는 작업이라 그 구간이 곧 전체 속도다. llama.cpp 가
 * 권하는 기본값도 「성능 코어 수」이고, 그 값은 요즘 기기에서 대체로 **코어 수의 절반**이다.
 *
 * 그래서 `코어 ÷ 2` 를 쓰되 2 아래로 내려가지 않게 하고 4 에서 끊는다. 상한은 발열·배터리를
 * 위해 둔 값이다(8코어 S21 에서 4 — 기존 고정값 2의 두 배).
 *
 * 코어 수를 알 수 없으면(구버전 네이티브 껍데기) **2로 둔다.** 모르는 기기에서 갑자기 더
 * 태우는 쪽보다 지금까지 돌던 값이 안전하다.
 */
export const MAX_INFERENCE_THREADS = 4;
export function inferenceThreads(cores: number | null | undefined): number {
  if (typeof cores !== 'number' || !Number.isFinite(cores) || cores < 1) return 2;
  return Math.max(2, Math.min(MAX_INFERENCE_THREADS, Math.floor(cores / 2)));
}
