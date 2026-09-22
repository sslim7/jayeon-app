/**
 * 수신자 표의 열 순서·너비 규칙.
 *
 * 🔴 **판단은 전부 여기서 하고 화면은 결과만 그린다.** 「저장된 배치와 지금 열 목록을 어떻게
 * 맞출 것인가」는 사용자 정의 열이 생기고 사라질 때마다 조용히 틀어지는 종류의 계산이라,
 * 화면 안에 두면 어디서 틀어졌는지 눈으로 볼 수 없다(→ `tests/recipient-columns.test.cjs`).
 *
 * 열 식별자는 정렬 키를 그대로 쓴다(→ `components/recipient-table-sort.ts`). 두 벌을 만들면
 * 정렬은 되는데 순서는 안 바뀌는 열이 생긴다.
 */

import { CUSTOM_SORT_PREFIX, customSortKey } from '@/components/recipient-table-sort';

/**
 * 사용자가 옮기고 늘릴 수 있는 고정 열.
 *
 * 🔴 **`name` 은 빠져 있다.** 사용자가 이름 열은 그대로 두라고 했고, 실제로도 이름 열은
 * 체크박스 열과 함께 `position: sticky` 로 왼쪽에 붙어 있다 — 순서를 바꾸면 가로 스크롤에서
 * 고정이 깨지고, 그 증상은 좁은 화면에서만 드러난다. 체크박스 열(맨 앞)과 관리 열(맨 뒤)도
 * 같은 이유로 제외한다.
 */
export const MOVABLE_RECIPIENT_COLUMNS = ['phone', 'group', 'sent'] as const;

/** 사용자 정의 열도 이동·크기 조정 대상이다. 고정 열 목록에 없다고 막으면 안 된다. */
export const isMovableRecipientColumn = (id: string): boolean =>
  (MOVABLE_RECIPIENT_COLUMNS as readonly string[]).includes(id) || id.startsWith(CUSTOM_SORT_PREFIX);

/**
 * 기본 순서: 전화번호 → 사용자 정의 열 → 그룹 → 발송건수.
 *
 * ⚠️ **그룹·발송건수가 맨 뒤인 것이 요구사항의 핵심이다.** 사람이 표를 훑을 때 먼저 찾는 것은
 * 이름과 전화번호이고, 그룹·발송건수는 확인용이라 뒤에 있어야 사용자 정의 열이 가려지지 않는다.
 */
export const defaultRecipientColumnOrder = (fields: string[]): string[] => [
  'phone',
  ...fields.map(customSortKey),
  'group',
  'sent',
];

export const DEFAULT_RECIPIENT_COLUMN_WIDTHS: Record<string, number> = { phone: 140, group: 95, sent: 210 };
/** 사용자 정의 열은 내용을 알 수 없어 기본값 하나로 시작한다. */
export const DEFAULT_CUSTOM_COLUMN_WIDTH = 120;
/** 60px 아래로는 제목 글자도 안 들어가고, 600px 위로는 다른 열이 화면 밖으로 밀린다. */
export const MIN_RECIPIENT_COLUMN_WIDTH = 60;
export const MAX_RECIPIENT_COLUMN_WIDTH = 600;

export const defaultRecipientColumnWidth = (id: string): number =>
  DEFAULT_RECIPIENT_COLUMN_WIDTHS[id] ?? DEFAULT_CUSTOM_COLUMN_WIDTH;

export const clampRecipientColumnWidth = (width: number): number =>
  Math.round(Math.min(MAX_RECIPIENT_COLUMN_WIDTH, Math.max(MIN_RECIPIENT_COLUMN_WIDTH, width)));

/** 저장되는 모양. `version` 은 나중에 규칙이 바뀌었을 때 옛 값을 알아보고 버리기 위한 것이다. */
export type RecipientColumnLayout = { version: 1; order: string[]; widths: Record<string, number> };

/**
 * 저장된 값이 지금 규칙에 맞는지 본다.
 *
 * 🔴 **모양이 조금이라도 어긋나면 거짓을 돌려 기본값으로 가게 한다.** 저장소에는 옛 버전이
 * 남기고 간 값이나 사람이 손댄 값이 들어 있을 수 있는데, 그걸 믿고 그리면 표가 통째로 안
 * 그려진다 — 열 배치 때문에 목록을 못 보는 것은 배치를 잃는 것보다 훨씬 나쁘다.
 */
export function isRecipientColumnLayout(value: unknown): value is RecipientColumnLayout {
  if (!value || typeof value !== 'object') return false;
  const layout = value as Partial<RecipientColumnLayout>;
  if (layout.version !== 1) return false;
  if (!Array.isArray(layout.order) || !layout.order.every((id) => typeof id === 'string' && !!id)) return false;
  if (!layout.widths || typeof layout.widths !== 'object' || Array.isArray(layout.widths)) return false;
  // NaN·음수·Infinity 는 그대로 `width` 에 들어가면 열이 사라지거나 표가 화면 밖으로 나간다.
  return Object.values(layout.widths).every((width) => typeof width === 'number' && Number.isFinite(width) && width > 0);
}

/**
 * 지금 있는 열과 저장된 배치를 맞춰 실제로 그릴 순서·너비를 낸다.
 *
 * 규칙 둘이 핵심이다.
 * - 저장된 순서에 있지만 **지금 없는 열은 버린다** — 사용자 정의 열은 삭제될 수 있다.
 * - 🔴 저장된 순서에 **없는 새 열은 버리지 않고 끼워 넣는다.** 사용자 정의 열은 나중에 생기는데,
 *   모르는 열이라고 빼 버리면 한 번 배치를 저장한 사람에게는 새 열이 영영 보이지 않는다.
 *   끼울 자리는 기본 순서에서의 이웃을 따라가, 새 열이 엉뚱하게 맨 뒤로 몰리지 않게 한다.
 */
export function resolveRecipientColumns(
  fields: string[],
  layout: RecipientColumnLayout | null,
): { order: string[]; widths: Record<string, number> } {
  const base = defaultRecipientColumnOrder(fields);
  const known = new Set(base);
  // 중복 식별자도 함께 걸러 낸다 — 같은 열을 두 번 그리면 React 가 key 중복으로 한쪽을 버린다.
  const order = layout ? layout.order.filter((id, index) => known.has(id) && layout.order.indexOf(id) === index) : [];
  base.forEach((id, index) => {
    if (order.includes(id)) return;
    // 기본 순서에서 이 열 앞에 있으면서 이미 자리를 잡은 열 바로 뒤. 없으면 맨 앞.
    let at = 0;
    for (let before = index - 1; before >= 0; before--) {
      const found = order.indexOf(base[before]);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    order.splice(at, 0, id);
  });
  const widths: Record<string, number> = {};
  for (const id of order) {
    const saved = layout?.widths[id];
    // 저장값도 clamp 한다. 저장 당시의 한계가 지금과 다를 수 있다.
    widths[id] = typeof saved === 'number' && Number.isFinite(saved) ? clampRecipientColumnWidth(saved) : defaultRecipientColumnWidth(id);
  }
  return { order, widths };
}

/** 열 하나를 `toIndex` 로 옮긴다. 범위를 벗어난 값은 양 끝으로 붙인다(키보드 ←/→ 가 끝에서 멈추게). */
export function moveRecipientColumn(order: string[], id: string, toIndex: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(Math.min(next.length, Math.max(0, toIndex)), 0, id);
  return next;
}

export function resizeRecipientColumn(widths: Record<string, number>, id: string, width: number): Record<string, number> {
  if (!Number.isFinite(width)) return widths;
  return { ...widths, [id]: clampRecipientColumnWidth(width) };
}

/** 사용자 정의 열 식별자에서 원래 열 이름을 되찾는다(제목·본문 모두 이 이름으로 값을 찾는다). */
export const recipientCustomFieldName = (id: string): string =>
  id.startsWith(CUSTOM_SORT_PREFIX) ? id.slice(CUSTOM_SORT_PREFIX.length) : '';

/**
 * 이 배치를 저장할 칸의 이름.
 *
 * 🔴 **계정마다 칸이 다르다.** 한 브라우저를 여러 계정으로 번갈아 쓰는 사무실에서 칸을 하나로
 * 두면, 앞사람이 잡아 둔 열 배치가 다음 사람 화면에 그대로 뜬다 — 받은 사람은 왜 그런지 모른 채
 * 매번 다시 맞춘다. 식별자를 16진수로 펴는 것은 저장소 키에 못 쓰는 문자를 피하기 위해서다
 * (`sms-draft.ts` 와 같은 방식).
 *
 * ⚠️ 부르는 쪽은 **userId 가 있을 때만** 이 함수를 쓴다. 빈 문자열이나 `anonymous` 같은 값으로
 * 칸을 만들면 나중에 그 칸이 누구 것인지 알 수 없다.
 */
export const recipientColumnStoreKey = (userId: string): string =>
  `jayeon.recipients.columns.${Array.from(userId)
    .map((c) => c.codePointAt(0)!.toString(16))
    .join('_')}`;
