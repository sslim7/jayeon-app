/**
 * 첨부 이미지 축소 — **네이티브.**
 *
 * 운영에서 도는 것은 웹 짝(`image-shrink.web.ts`)이다. 템플릿 편집 화면이 껍데기 안의 웹이기
 * 때문이다. 이 파일은 **껍데기를 끈 검증 빌드**가 쓰는 길이고, 그래도 만들어 둔다 — 한쪽만
 * 없으면 그쪽에서 고른 5MB 사진이 줄지 않은 채 서버로 가서 거절당한다
 * (→ `lib/attachment-file.ts` 머리말의 「양쪽이 같은 규칙을 본다」).
 *
 * 무엇을 몇 번 시도할지는 `image-shrink-plan.ts` 가 정한다. 여기는 손만 맡는다.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { base64Size } from './attachment-file';
import { scaledSize, shrinkPlan, shrunkFileName } from './image-shrink-plan';
import type { ShrinkImage } from './image-shrink-types';

/**
 * ⚠️ **투명한 PNG 를 JPEG 으로 바꾸는 마지막 단계에서 웹과 결과가 갈린다.**
 * 웹은 캔버스에 흰색을 깔고 그리지만(`attempt.flatten`), `expo-image-manipulator` 에는
 * 밑칠 수단이 없다 — 흰 배경을 깔 수 있는 `extent` 는 **웹 전용**이고 안드로이드·iOS 구현에는
 * 아예 없다. 그래서 이 길로 온 투명 PNG 는 투명했던 곳이 **검게** 나온다.
 *
 * 그럼에도 JPEG 단계를 남겨 둔 이유: 여기까지 오는 PNG 는 대개 폰 스크린샷(=불투명)이고,
 * 형식을 안 바꾸면 큰 PNG 는 **아예 붙지 않는다.** 한 장도 못 붙이는 쪽이 더 나쁘다.
 * 네이티브 화면을 실제로 운영에 쓰게 되면 밑칠을 할 수 있는 수단부터 찾아야 한다.
 */
export const shrinkImage: ShrinkImage = async (file, target) => {
  const plan = shrinkPlan(file.mimeType, target);
  if (!plan.length) throw new Error('SHRINK_FAILED');

  // 한 번만 디코딩하고 그 결과를 시도마다 다시 쓴다. 매번 base64 를 다시 읽으면
  // 5MB 사진에서 디코딩 비용만 아홉 배가 된다.
  let source;
  try {
    source = await ImageManipulator.manipulate(`data:${file.mimeType};base64,${file.dataBase64}`).renderAsync();
  } catch {
    // 디코딩 실패는 축소 실패와 다른 일이다 — 화면이 하는 말도 달라야 한다.
    throw new Error('IMAGE_DECODE_FAILED');
  }

  for (const attempt of plan) {
    const size = scaledSize(source.width, source.height, attempt.maxEdge);
    const ref = await ImageManipulator.manipulate(source).resize(size).renderAsync();
    // ⚠️ `saveAsync` 는 시도마다 캐시에 파일을 하나씩 남긴다. 지울 손잡이가 없는 대신
    //    OS 가 캐시 디렉터리를 회수한다. base64 없이 결과 바이트를 받을 방법이 없다.
    const saved = await ref.saveAsync({
      base64: true,
      compress: attempt.quality,
      format: attempt.mimeType === 'image/png' ? SaveFormat.PNG : SaveFormat.JPEG,
    });
    if (!saved.base64) continue;
    const bytes = base64Size(saved.base64);
    if (bytes > target) continue;
    return {
      fileName: shrunkFileName(file.fileName, attempt.mimeType),
      mimeType: attempt.mimeType,
      size: bytes,
      dataBase64: saved.base64,
    };
  }
  // 마지막 시도까지 목표를 못 맞췄다. 문구는 부르는 쪽이 고른다.
  throw new Error('SHRINK_FAILED');
};
