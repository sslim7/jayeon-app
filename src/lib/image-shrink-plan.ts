/**
 * 첨부 이미지를 **얼마나, 어떤 순서로 줄일 것인가**를 정하는 순수 규칙.
 *
 * 폰으로 찍은 사진은 2~5MB 다. MMS 로 나가는 이미지는 결국 폰 화면에서 보는 것이라 긴 변
 * 1280px · JPEG 품질 0.8 이면 보통 150~300KB 이고 눈으로 차이를 못 느낀다. 그래서 한도에
 * 걸린 사진을 사용자에게 돌려보내는 대신 **우리가 줄여서 붙인다.**
 *
 * 🔴 **이 파일에는 플랫폼 코드가 없다.** 캔버스도 `expo-*` 도 import 하지 않는다. 줄이는
 * 「판단」과 줄이는 「손」을 갈라 두어야 판단을 실기기 없이 고정할 수 있다
 * (→ `tests/image-shrink.test.cjs`). 손은 `image-shrink.web.ts` / `image-shrink.ts` 다.
 */

/** 한 번의 시도. 플랫폼 구현이 이대로 실행한다. */
export type ShrinkAttempt = {
  /** 긴 변을 여기까지 줄인다(비율 유지). 원본이 이미 작으면 키우지 않는다. */
  maxEdge: number;
  /** 인코딩 품질 0~1. PNG 인코더는 이 값을 **무시한다**(아래 `shrinkPlan` 주석 참고). */
  quality: number;
  /** 내보낼 형식. */
  mimeType: 'image/jpeg' | 'image/png';
  /**
   * JPEG 로 내보내기 전에 흰색으로 밑칠을 해야 하는가.
   *
   * 🔴 **JPEG 에는 투명도가 없다.** 투명한 PNG 를 그대로 JPEG 으로 인코딩하면 투명했던 곳이
   * **검게** 나온다(캔버스의 빈 화소는 `rgba(0,0,0,0)` 이고, 알파를 버리면 검정만 남는다).
   * 도장 이미지나 로고를 붙인 사용자는 문자를 보내고 나서야 그것을 알게 된다.
   */
  flatten: boolean;
};

/**
 * 이번 한 장이 들어가야 할 **목표 바이트**.
 *
 * 셋 중 가장 작은 값이다 — 파일당 한도, 합계에서 남은 몫, 그리고 (알 때만) 단말이 실제로
 * 실어 보낼 수 있는 크기. 하나라도 넘기면 붙이거나 보낼 때 거절당하므로 최솟값을 따른다.
 *
 * ⚠️ **남은 몫이 없으면 `null` 이다 — `0` 이 아니다.** 0 을 돌려주면 「0바이트까지 줄여
 * 보라」는 뜻이 되어 부르는 쪽이 성공할 수 없는 인코딩을 아홉 번 돌린 뒤에야 실패한다.
 * 「더 붙일 수 없다」는 줄이기 전에 알아야 하는 사실이고, 사용자에게 할 말도 다르다
 * (「더 작은 이미지를 고르세요」가 아니라 「합계 한도에 걸렸어요」).
 */
export function shrinkTargetBytes({
  perFile, totalLimit, usedBytes, deviceBudget,
}: {
  /** 파일 하나의 상한(→ `ATTACHMENT_MAX_BYTES`). */
  perFile: number;
  /** 붙인 것 전부를 더한 상한(→ `ATTACHMENT_TOTAL_MAX_BYTES`). */
  totalLimit: number;
  /** 이미 붙어 있는 것들의 합. */
  usedBytes: number;
  /**
   * 단말 쪽 사정으로 좁아지는 한도. **모르면 넘기지 않는다** — 모르는 것을 숫자로
   * 지어내면 멀쩡한 사진을 필요 이상으로 뭉갠다(`Infinity` 도 「모른다」로 다뤄진다:
   * 아래 `Number.isFinite`).
   *
   * ⚠️ **껍데기 다리의 폭(`bridgeAttachmentBudget`)은 여기로 넣지 않는다.** 붙이는 시점에
   * 그 폭으로 깎으면 모든 첨부가 같은 크기로 줄어들어, 기기마다 다른 실제 발송 한도를
   * 실험으로 찾을 수 없게 된다. 다리 폭은 **발송 직전에** 본다
   * (→ `lib/sms-runner.ts` 의 `bridgeOversizeMessage`).
   */
  deviceBudget?: number | null;
}): number | null {
  const remaining = totalLimit - usedBytes;
  if (remaining <= 0) return null;
  let target = Math.min(perFile, remaining);
  // 0 이하인 예산은 「모른다」와 구분이 안 되므로 없는 것으로 본다.
  if (typeof deviceBudget === 'number' && Number.isFinite(deviceBudget) && deviceBudget > 0) {
    target = Math.min(target, deviceBudget);
  }
  return target > 0 ? target : null;
}

/**
 * 첨부 말고 그 메시지에 함께 실리는 것들의 몫 — **넉넉히 8KB.**
 *
 * ⚠️ **경계에 딱 맞추면 안 된다.** 이 다리를 건너는 것은 첨부만이 아니다: 본문(최대 2000자,
 * 한글이면 UTF-8 로 글자당 3바이트), 수신자 이름·전화번호, 파일 이름, JSON 의 따옴표와
 * 키까지 같은 문자열에 들어간다. 여유를 1KB 로 조이면 **이름이 긴 수신자 한 명에게만**
 * 실패하고, 같은 캠페인의 다른 사람에게는 멀쩡히 나간다 — 그 증상으로 원인을 되짚는 것은
 * 사실상 불가능하다. 8KB 를 양보해 그 부류의 사고를 통째로 없앤다.
 */
const BRIDGE_ENVELOPE_BYTES = 8 * 1024;

/**
 * 껍데기 다리(웹뷰 → 네이티브 메시지)에서 **첨부가 실제로 쓸 수 있는 바이트.**
 *
 * 🔴 **이 값을 세지 않으면 사고가 조용히 난다.** 첨부는 base64 로 그 다리를 건너는데,
 * 껍데기는 원문이 자기 상한을 넘으면 **메시지를 통째로 버린다**(→ `components/web-shell.tsx`).
 * 버려진 발송 요청은 웹에서 150초 뒤에야 거절되고, 그동안 서버의 수신자는 `SENDING` 으로
 * 잠긴 채 남는다 — 화면에는 「발송 중 · 확인 필요」만 뜨고 `errorCode` 도 `transport` 도
 * 비어 있어, 로그만 봐서는 폰이 무엇을 했는지조차 알 수 없다. 실제로 그렇게 3회 연속
 * 실패했다(2026-09-23).
 *
 * ⚠️ **이 값으로 첨부를 미리 깎지 않는다.** 붙이는 시점에 깎아 버리면 어느 폰이 어디까지
 * 보낼 수 있는지 알아낼 길이 사라진다 — 지금은 기기별 실제 한도를 실험으로 찾는 중이라,
 * 크게 올려 보고 **발송 직전에 분명하게 실패시키는** 쪽을 택했다(→ `lib/sms-runner.ts`).
 * 갇히지만 않으면 실패는 정보다.
 *
 * 환산은 두 단계다 — 포장(JSON 껍데기·본문·이름)을 먼저 빼고, 남은 폭을 base64 이전의
 * 원본 바이트로 되돌린다(base64 는 3바이트를 4글자로 적으므로 ×3/4).
 */
export function bridgeAttachmentBudget(messageMaxBytes: number): number {
  if (!Number.isFinite(messageMaxBytes)) return messageMaxBytes > 0 ? Number.POSITIVE_INFINITY : 0;
  const usable = messageMaxBytes - BRIDGE_ENVELOPE_BYTES;
  return usable > 0 ? Math.floor((usable * 3) / 4) : 0;
}

/** 이미 목표 이하면 아무것도 하지 않는다. */
export function needsShrink(sizeBytes: number, target: number): boolean {
  // 🔴 **이미 작은 이미지를 다시 인코딩하지 않는다.** JPEG 재인코딩은 손실이 누적될 뿐
  //    크기를 확실히 줄여 주지도 않는다(품질을 올려 잡으면 오히려 커진다). 잃기만 한다.
  return sizeBytes > target;
}

/**
 * 시도 순서. **🔴 이 순서가 곧 품질 정책이다.**
 *
 * 먼저 긴 변을 1280 으로 맞추고 품질만 낮춘다 — 화면에서 보는 선명함은 해상도가 먼저 정하고,
 * 품질 0.55 짜리 1280px 사진이 품질 0.85 짜리 720px 사진보다 낫다. 그래도 목표를 못 맞추면
 * 그때 해상도를 960 → 720 으로 내리며 같은 품질 단계를 되풀이한다.
 *
 * ⚠️ 시도 하나가 폰에서 1초 가까이 걸린다(디코딩 + 축소 + 인코딩). 그래서 단계를 잘게
 * 쪼개지 않았다 — 아홉 번이 최악이고, 실제로는 대개 첫 번째나 두 번째에서 끝난다.
 */
const MAX_EDGES = [1280, 960, 720];
const QUALITIES = [0.85, 0.7, 0.55];

export function shrinkAttempts(target: number): ShrinkAttempt[] {
  // 목표가 0 이하면 어떤 인코딩도 만족시킬 수 없다. 빈 배열을 돌려 헛수고를 막는다
  // (부르는 쪽은 `shrinkTargetBytes` 의 `null` 에서 이미 걸렀어야 한다 — 이중 잠금이다).
  if (!(target > 0)) return [];
  return MAX_EDGES.flatMap((maxEdge) =>
    QUALITIES.map((quality) => ({ maxEdge, quality, mimeType: 'image/jpeg' as const, flatten: true })),
  );
}

/**
 * 원본 형식까지 감안한 전체 계획.
 *
 * 🔴 **PNG 는 PNG 로 먼저 줄여 본다.** 문자에 붙는 PNG 는 사진이 아니라 도장·로고·표처럼
 * 글자와 선이 많은 그림인 경우가 많고, 그런 그림을 JPEG 으로 바꾸면 선 둘레에 링잉이 생겨
 * 「글씨가 번졌다」는 말을 듣는다. 해상도만 낮춰도 목표에 들어가면 형식을 바꿀 이유가 없다.
 *
 * ⚠️ **PNG 단계에서는 품질을 돌리지 않는다.** PNG 는 무손실이라 인코더가 `quality` 를 그냥
 * 버린다(웹 `canvas.toBlob` 도, 네이티브 `saveAsync({ compress })` 도). 같은 값을 세 번
 * 만들어 놓고 세 번 비교하면 **1초짜리 인코딩을 두 번 헛돌린다.** 그래서 해상도 단계만 돈다.
 *
 * 그래도 못 맞추면 JPEG 으로 넘어간다 — 이때 `flatten` 이 켜져 투명한 곳을 흰색으로 채운다.
 */
export function shrinkPlan(mimeType: string, target: number): ShrinkAttempt[] {
  const jpeg = shrinkAttempts(target);
  if (mimeType !== 'image/png') return jpeg;
  const png = MAX_EDGES.map((maxEdge) => ({
    maxEdge, quality: 1, mimeType: 'image/png' as const, flatten: false,
  }));
  return jpeg.length ? [...png, ...jpeg] : [];
}

/**
 * 원본 크기를 목표 긴 변에 맞춘 결과 크기.
 *
 * ⚠️ **원본보다 키우지 않는다.** 작은 이미지를 1280 으로 늘리면 바이트만 늘고 보이는 것은
 * 그대로다 — 줄이러 왔다가 키워 놓는 꼴이 된다.
 */
export function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > 0)) return { width, height };
  const ratio = Math.min(1, maxEdge / longest);
  // 0 픽셀짜리 캔버스는 브라우저가 던진다. 반올림한 뒤 최소 1 을 보장한다.
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/**
 * 줄인 결과의 파일 이름.
 *
 * 🔴 **확장자를 형식에 맞춰 갈아 끼운다.** 첨부 흐름은 확장자를 MIME 의 정본으로 본다
 * (→ `lib/attachment-file.ts` 의 `imageContentType`). PNG 를 JPEG 으로 바꿔 놓고 이름을
 * `도장.png` 로 두면, 서버·미리보기·다음 번 판정이 모두 PNG 라고 믿는다.
 */
export function shrunkFileName(name: string, mimeType: string): string {
  const extension = mimeType === 'image/png' ? 'png' : 'jpg';
  const base = name.replace(/\.[A-Za-z0-9]+$/, '') || 'image';
  return `${base}.${extension}`;
}
