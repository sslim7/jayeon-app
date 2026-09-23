/**
 * 문자 첨부 이미지가 **붙일 수 있는 것인지** 판정하는 순수 규칙.
 *
 * 웹의 `<input type="file">` 과 네이티브의 문서 선택기가 같은 답을 써야 한다 — 한쪽만
 * 느슨하면 그쪽에서 고른 파일이 서버에서 거절당하고, 사용자는 왜 자기 폰에서만 안 되는지
 * 알 수 없다. `lib/call-file.ts` 가 녹음 파일에 대해 하는 일을 첨부 이미지에 대해 한다.
 *
 * 🔴 **이 파일에는 플랫폼 코드가 없다.** `expo-*` 도 DOM 도 import 하지 않는다. 그래서
 * 웹 짝·네이티브 짝·호출부가 모두 이것 하나를 보고, 실기기 없이 검사할 수 있다
 * (→ `tests/attachment-file.test.cjs`).
 */

import type { PickedFile } from '@/components/file-picker-types';

/**
 * 파일 하나의 상한. 서버 MMS 제약에서 온 값이라 양쪽이 같아야 한다.
 *
 * ⚠️ **이것은 「저장」 한도지 「발송」 한도가 아니다.** 통신망으로 실제로 나가는 크기는 단말이
 * SIM 에서 읽는 `MMS_CONFIG_MAX_MESSAGE_SIZE` 가 정하고, 그 값을 읽지 못하면 300 KiB 로
 * 떨어진다(→ `modules/nature-sms/.../MmsPdu.kt`). 여기를 통과했다고 통신사가 받아 준다는
 * 뜻은 아니다 — 그 숫자를 첨부 시점에 알 수 있게 되면 `deviceBudget` 으로 함께 걸러야 한다.
 */
export const ATTACHMENT_MAX_BYTES = 700 * 1024;
/** 한 메시지에 붙일 수 있는 장수. */
export const ATTACHMENT_MAX_COUNT = 3;
/** 붙인 것 전부를 더한 상한. 위와 마찬가지로 저장 한도다. */
export const ATTACHMENT_TOTAL_MAX_BYTES = 1400 * 1024;

/**
 * **줄이기 전에 일단 받아 줄 원본 상한.** 🔴 이것은 「한도」가 아니라 「여기까지는 받아서
 * 줄여 본다」는 뜻이다 — 선택기는 이 값으로 거르고, 실제 한도(`ATTACHMENT_MAX_BYTES`)는
 * 줄인 뒤에 본다.
 *
 * 폰으로 찍은 사진은 2~5MB 다. 선택기를 `ATTACHMENT_MAX_BYTES` 로 잠가 두면 사용자는
 * **매번 직접 줄여서** 가져와야 하고, 그 방법을 아는 사람은 많지 않다. 20MB 는 요즘 폰의
 * 고화소 사진이 넉넉히 들어오는 크기이고, 그보다 큰 것은 사진이 아닐 가능성이 높아
 * (스캔 원본·연사 합성 등) 줄이려고 메모리에 올리기 전에 거절한다.
 */
export const ATTACHMENT_PICK_MAX_BYTES = 20 * 1024 * 1024;

/**
 * 선택기에 거는 필터. 확장자를 함께 적어야 일부 안드로이드 웹뷰에서 목록이 비지 않는다
 * (→ `lib/call-file.ts` 의 `AUDIO_ACCEPT` 와 같은 이유).
 */
export const ATTACHMENT_ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png';

/** 바이트를 화면에 적는 KB 로. 문구가 갈라지지 않게 한 곳에서만 계산한다. */
const kb = (bytes: number) => Math.floor(bytes / 1024);
/** 1 MB 를 넘는 값은 KB 로 적으면 읽히지 않는다(「20480 KB」). 그때만 MB 로 바꾼다. */
const humanSize = (bytes: number) => bytes >= 1024 * 1024 ? `${Math.floor(bytes / (1024 * 1024))} MB` : `${kb(bytes)} KB`;

/**
 * 화면에 적는 안내.
 *
 * 🔴 **크기를 사용자 숙제로 말하지 않는다.** 「파일당 700 KB」라고 적으면, 폰 사진이 2~5MB
 * 라는 것을 아는 사용자는 붙이기를 포기하고 모르는 사용자는 거절당한 뒤에야 알게 된다.
 * 큰 사진은 우리가 줄인다(→ `lib/image-shrink-plan.ts`). 숫자는 줄여도 안 될 때만 말한다.
 */
export const ATTACHMENT_HINT = `JPG·PNG 최대 ${ATTACHMENT_MAX_COUNT}장. 큰 사진은 자동으로 줄여서 첨부합니다. 이미지를 첨부하면 MMS로 발송합니다.`;

/*
  ── 사용자가 보는 문구 ───────────────────────────────────────────

  🔴 **문구를 플랫폼마다 따로 쓰지 않는다.** 같은 파일을 거절하면서 폰과 브라우저가 다른
  말을 하면, 고장 신고를 받을 때 기종부터 물어야 한다.
*/

/** 형식이 아닐 때. 호출부와 네이티브 선택기가 같이 쓴다. */
export const ATTACHMENT_TYPE_MESSAGE = 'JPG 또는 PNG 이미지를 선택해 주세요.';
/** 고르기는 했는데 바이트를 읽지 못했을 때. */
export const ATTACHMENT_READ_MESSAGE = '파일을 읽지 못했어요. 다시 선택해 주세요.';
/** 장수·합계에 걸렸을 때. */
export const ATTACHMENT_QUOTA_MESSAGE = `첨부는 최대 ${ATTACHMENT_MAX_COUNT}개, 합계 ${kb(ATTACHMENT_TOTAL_MAX_BYTES)} KB까지 가능해요.`;
/**
 * 줄여 봤는데도 한도를 못 맞췄을 때.
 *
 * ⚠️ 「너무 커요」에서 끝내면 사용자는 **무엇을 하면 되는지** 모른다. 우리가 이미 줄여 본
 * 뒤이므로 남은 선택지는 하나뿐이고, 그것을 말해 준다.
 */
export const ATTACHMENT_SHRINK_FAILED_MESSAGE = '이미지를 줄여도 한도를 넘어요. 더 작은 이미지를 선택해 주세요.';
/**
 * 줄이는 동안 화면에 세워 두는 말.
 *
 * 🔴 5MB 사진 한 장을 줄이는 데 폰에서 1초 이상 걸린다. 그동안 아무 말이 없으면 사용자는
 * 버튼이 안 먹은 줄 알고 다시 누르거나 화면을 떠난다.
 */
export const ATTACHMENT_SHRINKING_MESSAGE = '이미지 줄이는 중…';
/**
 * 선택 화면 자체가 열리지 않을 때 — **네이티브에서만 나온다.**
 * 안드로이드에 문서 선택을 받아 줄 앱이 없으면 `getDocumentAsync` 가 바로 던진다. 이때
 * 「파일을 읽지 못했어요」라고 하면 파일을 고른 적도 없는 사용자가 다시 고르려 든다.
 */
export const ATTACHMENT_PICKER_MESSAGE = '이 기기에서 파일 선택 화면을 열지 못했어요. 파일을 다루는 앱이 설치되어 있는지 확인해 주세요.';

/**
 * 한 파일이 클 때. 상한은 호출부가 정하므로 인자로 받는다.
 * 선택기는 이제 `ATTACHMENT_PICK_MAX_BYTES`(20MB) 를 넘겨주므로 MB 로도 나온다.
 */
export function oversizeMessage(maxBytes: number): string {
  return `파일은 ${humanSize(maxBytes)}까지 추가할 수 있어요.`;
}

/*
  ── 판정 ────────────────────────────────────────────────────────
*/

/**
 * 확장자 → 보낼 MIME.
 *
 * 🔴 **선택기가 알려 주는 MIME 을 그대로 믿지 않는다.** 안드로이드 문서 제공자는 같은
 * JPG 에 `image/jpg` 를 주기도 하고 아무것도 주지 않기도 한다. 그대로 넘기면 호출부의
 * `image/jpeg` 검사에 걸려 **멀쩡한 사진이 거절된다.** 확장자는 사용자가 보는 값이고
 * 흔들리지 않으므로 그쪽을 정본으로 삼는다.
 */
const BY_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

/** 서버가 받는 MIME 전부. 확장자를 모를 때 선택기 값을 여기에 비춰 본다. */
const ALLOWED = new Set(['image/jpeg', 'image/png']);

/** 올릴 때 쓸 MIME 인지. 호출부가 마지막 관문으로 쓴다. */
export function isAllowedImage(mimeType: string): boolean {
  return ALLOWED.has(mimeType);
}

/** 올릴 때 쓸 MIME. 판정할 수 없으면 `UNSUPPORTED_TYPE` 으로 거절한다. */
export function imageContentType(name: string, given?: string | null): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1]?.toLowerCase();
  const byExtension = extension ? BY_EXTENSION[extension] : undefined;
  if (byExtension) return byExtension;
  const declared = (given ?? '').trim().toLowerCase().split(';')[0];
  if (ALLOWED.has(declared)) return declared;
  throw new Error('UNSUPPORTED_TYPE');
}

/**
 * 크기 규칙. **웹 짝과 같은 기준이다** — `size > maxBytes` 하나뿐이고, 0바이트를 따로
 * 막지 않는다. 여기서 한 줄이라도 더 막으면 그 순간 양쪽이 갈라진다.
 */
export function checkAttachmentSize(size: number, maxBytes: number): void {
  if (size > maxBytes) throw new Error('FILE_TOO_LARGE');
}

/** 이미 붙인 것들 위에 하나 더 붙일 수 있는가. 호출부(장수·합계)가 쓴다. */
export function quotaExceeded(existing: { size: number }[], size: number): boolean {
  if (existing.length >= ATTACHMENT_MAX_COUNT) return true;
  return existing.reduce((sum, item) => sum + item.size, size) > ATTACHMENT_TOTAL_MAX_BYTES;
}

/** 던져진 코드를 사람이 읽을 한 줄로. 모르는 것은 「읽지 못했다」로 눌러 버린다. */
export function attachmentReason(error: unknown, maxBytes: number): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'FILE_TOO_LARGE') return oversizeMessage(maxBytes);
  if (code === 'UNSUPPORTED_TYPE') return ATTACHMENT_TYPE_MESSAGE;
  // 줄이기까지 해 보고 실패한 것. 「읽지 못했어요」로 눌리면 사용자는 같은 사진을 다시 고른다.
  if (code === 'SHRINK_FAILED') return ATTACHMENT_SHRINK_FAILED_MESSAGE;
  if (code === 'PICKER_UNAVAILABLE') return ATTACHMENT_PICKER_MESSAGE;
  return ATTACHMENT_READ_MESSAGE;
}

/*
  ── 네이티브 선택 흐름 ───────────────────────────────────────────
*/

/** 문서 선택기가 돌려주는 것 중 우리가 보는 부분(→ `expo-document-picker` 의 `DocumentPickerAsset`). */
export type NativePickedAsset = { uri: string; name: string; size?: number; mimeType?: string | null };

/**
 * 파일을 실제로 만지는 두 가지. **주입받는다** — 그래야 이 흐름을 실기기 없이 검사할 수 있다.
 * `open` 은 선택기를, `readBase64` 는 고른 파일의 바이트를 맡는다.
 */
export type NativePickDeps = {
  open: (types: string[]) => Promise<{ canceled: boolean; assets?: NativePickedAsset[] | null }>;
  readBase64: (uri: string) => Promise<string>;
};

/**
 * `accept` 문자열에서 선택기에 넘길 MIME 만 뽑는다.
 * 확장자 항목(`.jpg`)은 웹 `<input>` 전용이라 여기서는 버린다 — 문서 선택기는 MIME 만 읽는다.
 */
export function acceptTypes(accept: string): string[] {
  const types = accept.split(',').map((item) => item.trim().toLowerCase()).filter((item) => item.includes('/'));
  return types.length ? types : ['image/*'];
}

/** base64 문자열이 나타내는 실제 바이트 수. 끝의 `=` 는 채움이라 빼고 센다. */
export function base64Size(encoded: string): number {
  const body = encoded.trim();
  if (!body) return 0;
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.floor((body.length * 3) / 4) - padding;
}

/**
 * 네이티브에서 첨부 하나를 고른다.
 *
 * 🔴 **취소는 오류가 아니다** — `null` 을 돌려주고 화면은 아무 말도 하지 않는다. 사용자가
 * 스스로 뒤로 간 것을 실패라고 알리면, 다음에는 버튼을 누르기 전에 망설이게 된다.
 *
 * 크기는 두 번 본다. 선택기가 알려 준 값이 있으면 **읽기 전에** 걸러 상한을 넘는 사진을
 * 통째로 메모리에 올리지 않고, 값을 주지 않는 문서 제공자를 위해 읽은 뒤 실제 길이로 다시 본다.
 * 여기서 쓰는 `maxBytes` 는 호출부가 주는 값이고, 첨부 흐름은 **줄이기 전 원본 상한**
 * (`ATTACHMENT_PICK_MAX_BYTES`) 을 넘긴다 — 진짜 한도는 줄인 뒤에 본다.
 */
export async function pickNativeAttachment(
  deps: NativePickDeps, { accept, maxBytes }: { accept: string; maxBytes: number },
): Promise<PickedFile | null> {
  let picked;
  try {
    picked = await deps.open(acceptTypes(accept));
  } catch {
    throw new Error('PICKER_UNAVAILABLE');
  }
  if (picked.canceled) return null;
  const asset = picked.assets?.[0];
  // 취소가 아닌데 고른 것도 없다 — 알릴 내용이 없으므로 취소와 같게 둔다.
  if (!asset) return null;
  const mimeType = imageContentType(asset.name, asset.mimeType);
  if (typeof asset.size === 'number' && Number.isFinite(asset.size)) checkAttachmentSize(asset.size, maxBytes);
  const dataBase64 = await deps.readBase64(asset.uri);
  const size = base64Size(dataBase64);
  checkAttachmentSize(size, maxBytes);
  return { fileName: asset.name, mimeType, dataBase64, size };
}
