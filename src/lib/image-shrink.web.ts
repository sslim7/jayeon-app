/**
 * 첨부 이미지 축소 — **웹(브라우저와 네이티브 껍데기의 웹뷰).**
 *
 * 템플릿 편집 화면은 껍데기 안에서도 배포된 웹이 그린다(→ `components/web-shell.tsx`).
 * 그러니까 **운영에서 실제로 도는 축소기는 이 파일이다.** 네이티브 짝(`image-shrink.ts`)은
 * 껍데기를 끈 검증 빌드에서만 불린다.
 *
 * 무엇을 몇 번 시도할지는 여기서 정하지 않는다 — `image-shrink-plan.ts` 가 준 계획을 그대로
 * 실행할 뿐이다. 판단을 여기 두면 네이티브 짝과 갈라지고, 실기기 없이는 확인할 수 없게 된다.
 */
import { scaledSize, shrinkPlan, shrunkFileName } from './image-shrink-plan';
import type { ShrinkImage } from './image-shrink-types';

/**
 * base64 를 `Blob` 으로. **data URL 을 `<img>` 에 그대로 물리지 않는다** — 20MB 사진이면
 * 27MB 짜리 문자열이 DOM 속성으로 한 번 더 복사되고, 웹뷰가 그 자리에서 죽는 기종이 있다.
 */
function toBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/**
 * 디코딩. `createImageBitmap` 이 아니라 `<img>` 를 쓴다.
 *
 * 🔴 **EXIF 회전 때문이다.** 아이폰으로 세로로 찍은 사진은 바이트로는 가로이고 「돌려서 봐라」는
 * 표시만 붙어 있다. 브라우저의 `<img>` 는 그 표시를 지켜 `naturalWidth/Height` 까지 돌려 놓지만,
 * `createImageBitmap` 의 기본 동작은 브라우저마다 갈린다 — 그쪽을 쓰면 **어떤 폰에서만 사진이
 * 옆으로 누워 발송된다.**
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    // 디코딩 실패는 축소 실패와 다른 일이다 — 「더 작은 이미지를 고르세요」가 아니라 「읽지 못했어요」.
    image.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
    image.src = url;
  });
}

/** 캔버스가 내놓은 `Blob` 을 다시 base64 로. 업로드 API 가 base64 를 받는다. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
    reader.readAsDataURL(blob);
  });
}

export const shrinkImage: ShrinkImage = async (file, target) => {
  const plan = shrinkPlan(file.mimeType, target);
  // 목표가 0 이하라 어떤 인코딩도 만족시킬 수 없는 경우. 헛돌지 않고 바로 알린다.
  if (!plan.length) throw new Error('SHRINK_FAILED');

  const url = URL.createObjectURL(toBlob(file.dataBase64, file.mimeType));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('IMAGE_DECODE_FAILED');

    for (const attempt of plan) {
      const size = scaledSize(image.naturalWidth, image.naturalHeight, attempt.maxEdge);
      // 크기를 바꾸면 캔버스 내용이 지워진다. 그래도 매 시도마다 다시 칠하는 이유는 아래.
      canvas.width = size.width;
      canvas.height = size.height;
      if (attempt.flatten) {
        // 🔴 **그리기 전에** 흰색으로 밑칠한다. 캔버스의 빈 화소는 `rgba(0,0,0,0)` 이고,
        //    JPEG 은 알파를 버리므로 투명했던 곳이 **검게** 남는다. 도장이나 로고를 붙인
        //    사용자는 문자를 보내고 나서야 그것을 본다. 나중에 칠하면 사진을 덮는다.
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size.width, size.height);
      } else {
        // PNG 는 투명도를 그대로 살린다. 앞 시도의 찌꺼기만 지운다.
        ctx.clearRect(0, 0, size.width, size.height);
      }
      ctx.drawImage(image, 0, 0, size.width, size.height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, attempt.mimeType, attempt.quality);
      });
      // 인코더가 형식을 거절하면 `null` 이 온다. 다음 시도로 넘어간다.
      if (!blob) continue;
      if (blob.size > target) continue;
      return {
        fileName: shrunkFileName(file.fileName, attempt.mimeType),
        mimeType: attempt.mimeType,
        size: blob.size,
        dataBase64: await toBase64(blob),
      };
    }
    // 마지막 시도까지 목표를 못 맞췄다. 여기서 문구를 고르지 않는다 — 부르는 쪽의 몫이다.
    throw new Error('SHRINK_FAILED');
  } finally {
    // 놓으면 브라우저가 20MB 를 붙들고 있는다. 던지고 나가는 길에도 반드시 지난다.
    URL.revokeObjectURL(url);
  }
};
