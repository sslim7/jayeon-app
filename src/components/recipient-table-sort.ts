import type { Recipient } from '@/types/sms';

export type RecipientSortDirection = 'asc' | 'desc';
/** 고정 열은 이름·전화번호·그룹·발송건수, 사용자 정의 열은 `custom:이름`으로 구분한다. */
export type RecipientSort = { key: string; direction: RecipientSortDirection };
export const DEFAULT_RECIPIENT_SORT: RecipientSort = { key: 'name', direction: 'asc' };
export const CUSTOM_SORT_PREFIX = 'custom:';
export const customSortKey = (field: string) => `${CUSTOM_SORT_PREFIX}${field}`;

/** 한글·숫자가 섞인 값을 사람이 읽는 순서로 비교한다. */
const compareText = (a: string, b: string) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' });

function cellText(item: Recipient, key: string): string {
  if (key === 'phone') return (item.phone ?? '').replace(/[^0-9]/g, '');
  if (key === 'group') return (item.groupId ?? '').trim();
  if (key.startsWith(CUSTOM_SORT_PREFIX)) {
    const field = key.slice(CUSTOM_SORT_PREFIX.length);
    return (item.customFields?.find((entry) => entry.name === field)?.value ?? '').trim();
  }
  return (item.name ?? '').trim();
}

/** 빈 칸으로 보이는 값(0건 포함)은 방향과 무관하게 맨 뒤로 보낸다. */
function isEmptyCell(item: Recipient, key: string): boolean {
  return key === 'sent' ? !item.sentCount : !cellText(item, key);
}

function compareAscending(a: Recipient, b: Recipient, key: string): number {
  if (key !== 'sent') return compareText(cellText(a, key), cellText(b, key));
  // 발송건수가 같으면 최근 발송일로 가른다.
  if ((a.sentCount || 0) !== (b.sentCount || 0)) return (a.sentCount || 0) - (b.sentCount || 0);
  const left = a.latestSentAt ?? '';
  const right = b.latestSentAt ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 동률은 이름 오름차순 → id 순으로 갈라 순서가 흔들리지 않게 한다. */
export function compareRecipients(a: Recipient, b: Recipient, sort: RecipientSort): number {
  const emptyA = isEmptyCell(a, sort.key);
  const emptyB = isEmptyCell(b, sort.key);
  if (emptyA !== emptyB) return emptyA ? 1 : -1;
  if (!emptyA) {
    const result = compareAscending(a, b, sort.key);
    if (result) return sort.direction === 'desc' ? -result : result;
  }
  return compareText((a.name ?? '').trim(), (b.name ?? '').trim()) || compareText(a.id, b.id);
}

export function sortRecipients(items: Recipient[], sort: RecipientSort): Recipient[] {
  return [...items].sort((a, b) => compareRecipients(a, b, sort));
}

/** 같은 열은 방향만 뒤집고, 다른 열은 오름차순부터 시작한다. */
export function nextRecipientSort(sort: RecipientSort, key: string): RecipientSort {
  return { key, direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc' };
}

export const sortIndicator = (sort: RecipientSort, key: string) => (sort.key === key ? (sort.direction === 'asc' ? '▲' : '▼') : '');

export function sortHeaderLabel(label: string, sort: RecipientSort, key: string): string {
  if (sort.key !== key) return `${label}, 정렬되지 않음. 누르면 오름차순`;
  return sort.direction === 'asc' ? `${label}, 오름차순 정렬됨. 누르면 내림차순` : `${label}, 내림차순 정렬됨. 누르면 오름차순`;
}

export const ariaSort = (sort: RecipientSort, key: string) => (sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none') as 'ascending' | 'descending' | 'none';
