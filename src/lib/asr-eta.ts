/**
 * 「앞으로 얼마나 더 기다리나」 — **남은 시간 추정.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이 값은 진행 막대에 넣지 않는다.** 막대는 끝난 청크만으로 그린다(→ `docs/call-  │
 * │ analysis.md`). 시간으로 막대를 메우면 그 막대는 우리가 센 적 없는 숫자가 되고, 추정이  │
 * │ 빗나간 만큼 막대가 거짓말을 한다. 추정은 **별도의 줄**로만 나간다.                    │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * # 두 단계로 정확해진다
 *
 * ① **첫 청크가 끝나기 전**에는 아는 것이 판정 벤치뿐이다 — `estimateAsrMs` 로 어림한다.
 *    실기기에서 예상 7분 8초 / 실제 7분 18초(오차 2.3%)였다(→ `asr-capability-types.ts`).
 * ② **청크가 하나라도 끝나면 실측이 이긴다.** 벤치는 30초 창 하나를 잰 값이고, 실측은 이
 *    폰이 지금 이 파일을 받아쓰는 속도 그 자체다.
 *
 * ⚠️ **전체 평균을 쓰지 않는다.** 폰은 뜨거워지면서 느려진다 — 앞 청크까지 섞은 평균은
 * 끝까지 낙관적으로 빗나가고, 「3분 남음」이 3분 뒤에 「4분 남음」이 된다. 최근 몇 개만 보면
 * 추정이 발열을 따라 내려간다.
 *
 * 🔴 **멈춰 있던 시간은 소요 시간이 아니다.** 앱이 화면 밖으로 나가면 whisper 는 CPU 를 받지
 * 못해 그 자리에 얼어붙는다. 그 시간을 청크 소요로 세면 「청크당 4분」 같은 값이 나오고 추정이
 * 통째로 무너진다. 그래서 백그라운드가 낀 청크는 **표본에서 뺀다.**
 *
 * 네이티브 import 가 없다. 그래야 `node --test` 로 추정 규칙 자체를 확인할 수 있다.
 */
import { estimateAsrMs } from './asr-capability-types';
import { ASR_CHUNK_MS, type AsrLocalProgress } from './asr-local-types';

/**
 * 몇 개를 평균 낼 것인가.
 *
 * ⚠️ 1 이면 청크 하나의 요동(다른 앱이 잠깐 CPU 를 가져간 것 따위)이 그대로 튄다. 크게
 * 잡으면 발열을 못 따라간다. 3 은 28분 통화 15청크에서 「최근 6분」쯤을 보는 크기다.
 */
export const ASR_ETA_WINDOW = 3;

/**
 * 끝난 청크 하나의 실측. 🔴 **끝난 것만** 들어간다 — 돌다 만 청크의 시간은 표본이 아니다.
 *
 * ⚠️ **한 실행의 첫 표본에는 모델 적재 17.8초가 섞여 있다**(실측). 그래서 첫 추정은
 * 비관적으로 나오고, 두세 청크가 지나면 창 밖으로 밀려나며 제자리를 찾는다. 이 값을 따로
 * 빼지 않는 이유는 두 가지다: ① 사용자는 그 17.8초도 실제로 기다렸다 ② 빼려면 엔진이
 * 「세션이 열렸다」를 따로 알려 줘야 하는데, 지금 실기기에 진행 중인 작업이 있어 엔진을
 * 건드리지 않는다. 비관적으로 틀렸다가 맞아 가는 쪽이 반대보다 낫다.
 */
export type AsrEtaSample = {
  /** 청크 번호(0부터). 같은 청크가 두 번 들어오지 않게 하는 열쇠다. */
  index: number;
  /** 이 청크가 담은 **오디오** 길이(ms). ⚠️ 마지막 청크는 120초보다 짧다. */
  audioMs: number;
  /** 실제로 흐른 시간(ms). */
  elapsedMs: number;
  /** 시작~끝 사이에 앱이 화면 밖으로 나갔나. 참이면 표본에서 뺀다. */
  paused: boolean;
};

/** 지금 도는 청크의 표시. 화면이 청크 하나를 재는 데 필요한 전부다. */
export type AsrEtaMark = {
  index: number;
  /** 이 청크를 처음 본 시각. */
  startedAt: number;
  /** 이 청크가 도는 동안 앱이 화면 밖으로 나갔나. */
  paused: boolean;
};

export type AsrEta = {
  /** 앞으로 더 걸릴 시간(ms). */
  remainingMs: number;
  /**
   * 무엇으로 구했나. 🔴 화면이 이 값을 보고 문장을 고른다 — 어림값과 실측을 같은 말로
   * 적으면 벤치 한 번으로 찍은 숫자가 실측처럼 읽힌다.
   */
  source: 'measured' | 'estimate';
};

export type AsrEtaInput = {
  /** 끝난 청크들의 실측. 시간 순서대로다. */
  samples: readonly AsrEtaSample[];
  /** 아직 받아쓰지 않은 오디오 길이(ms). */
  remainingMs: number;
  /** 저장된 판정의 벤치 인코더 시간(ms). 잰 적이 없으면 `null`. */
  encodeMs: number | null;
};

/**
 * 아직 남은 **오디오** 길이(ms).
 *
 * ⚠️ 끝난 청크(`doneMs`)뿐 아니라 **지금 청크 안의 진행률까지** 반영한다. 그 값은 whisper 가
 * 준 것이지 우리가 지어낸 것이 아니므로 써도 된다 — 이걸 빼면 남은 시간이 청크가 끝날 때까지
 * 2분 동안 꼼짝하지 않고, 사용자는 계산이 멈춘 줄 안다.
 */
export function asrRemainingMs(progress: Pick<AsrLocalProgress, 'doneMs' | 'totalMs' | 'chunkPercent'>): number {
  const left = Math.max(0, progress.totalMs - progress.doneMs);
  if (!Number.isFinite(left) || left <= 0) return 0;
  if (progress.chunkPercent === null) return left;
  // 지금 청크도 마지막이면 120초보다 짧다. 남은 길이로 자른다.
  const chunkMs = Math.min(ASR_CHUNK_MS, left);
  const ratio = Math.max(0, Math.min(100, progress.chunkPercent)) / 100;
  return Math.max(0, left - chunkMs * ratio);
}

/**
 * 청크 번호가 하나 넘어갔다면 방금 끝난 청크를 표본으로 만든다. 아직이면 `null`.
 *
 * 🔴 **번호가 정확히 하나 늘었을 때만** 표본이 된다. 「처음부터 다시」로 0 으로 돌아갔거나
 * 두 칸 이상 건너뛴 경우에는 그 사이에 무슨 일이 있었는지 알 수 없다.
 */
export function asrEtaSample(
  mark: AsrEtaMark,
  next: Pick<AsrLocalProgress, 'chunkIndex' | 'totalMs'>,
  now: number,
): AsrEtaSample | null {
  if (next.chunkIndex !== mark.index + 1) return null;
  // ⚠️ 마지막 청크는 남은 만큼만이다. 120초로 세면 그 청크만 유난히 「빠른」 표본이 된다.
  const audioMs = Math.min(ASR_CHUNK_MS, Math.max(0, next.totalMs - mark.index * ASR_CHUNK_MS));
  const elapsedMs = now - mark.startedAt;
  if (!(audioMs > 0) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
  return { index: mark.index, audioMs, elapsedMs, paused: mark.paused };
}

/** 표본으로 쓸 수 있는 것들. 백그라운드가 낀 것과 숫자가 성한 것만 남는다. */
function usableSamples(samples: readonly AsrEtaSample[]): AsrEtaSample[] {
  return samples.filter((sample) =>
    !sample.paused
    && Number.isFinite(sample.audioMs) && sample.audioMs > 0
    && Number.isFinite(sample.elapsedMs) && sample.elapsedMs > 0);
}

/**
 * 남은 시간. **모르면 `null`** — 화면은 그때 줄을 만들지 않는다.
 *
 * 🔴 「계산 중…」 같은 자리채움을 내주지 않는다. 자리채움은 값이 곧 온다는 약속인데, 판정도
 * 없고 끝난 청크도 없으면 그 값은 **끝내 오지 않을 수도 있다.**
 */
export function asrEta(input: AsrEtaInput): AsrEta | null {
  const remaining = input.remainingMs;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;

  // ① 실측이 있으면 실측이 이긴다. ⚠️ 최근 것만 본다 — 발열로 느려진 지금을 따라가야 한다.
  const recent = usableSamples(input.samples).slice(-ASR_ETA_WINDOW);
  if (recent.length > 0) {
    const audioMs = recent.reduce((sum, sample) => sum + sample.audioMs, 0);
    const elapsedMs = recent.reduce((sum, sample) => sum + sample.elapsedMs, 0);
    // 「청크당 몇 초」가 아니라 「오디오 1ms 당 몇 ms」다. 그래야 길이가 다른 마지막 청크가
    // 표본에 들어와도, 남은 쪽의 마지막 청크가 짧아도 둘 다 제대로 셈에 든다.
    if (audioMs > 0 && elapsedMs > 0) {
      return { remainingMs: Math.round(remaining * (elapsedMs / audioMs)), source: 'measured' };
    }
  }

  // ② 아직 하나도 못 끝냈다. 저장된 판정의 벤치로 어림한다.
  //    ⚠️ 「전체 예상 − 진행분」이 아니라 **남은 길이를 그대로** 넣는다. `estimateAsrMs` 는
  //    길이에 비례하므로 값은 같고, 뺄셈이 음수로 내려갈 여지가 없다.
  if (input.encodeMs !== null && Number.isFinite(input.encodeMs) && input.encodeMs > 0) {
    const estimated = estimateAsrMs(input.encodeMs, remaining);
    if (estimated > 0) return { remainingMs: estimated, source: 'estimate' };
  }

  // 잰 적도 없고 끝낸 것도 없다. 🔴 지어내지 않는다.
  return null;
}
