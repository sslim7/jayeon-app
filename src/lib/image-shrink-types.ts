/** 웹·네이티브 축소기가 같은 모양을 쓰도록 한 곳에 둔다(→ `image-shrink.web.ts`). */
import type { PickedFile } from '@/components/file-picker-types';

/**
 * 고른 이미지를 `target` 바이트 이하로 줄인다.
 *
 * 계획은 양쪽 모두 `image-shrink-plan.ts` 에서 받아 **그대로** 실행한다 — 한쪽이 자기 판단을
 * 끼워 넣으면 웹에서 붙던 사진이 앱에서만 뭉개지거나 거절당하고, 그 차이를 재현할 방법이 없다.
 *
 * 🔴 실패는 **`SHRINK_FAILED`** 하나로만 던진다(→ `attachmentReason`). 마지막 시도까지
 * 목표를 못 맞췄다는 뜻이고, 화면은 「더 작은 이미지를 선택해 주세요」라고 말한다. 디코딩이
 * 아예 안 된 것처럼 **다른 원인은 다른 코드로** 던져야 「읽지 못했어요」로 갈라진다.
 */
export type ShrinkImage = (file: PickedFile, target: number) => Promise<PickedFile>;
