import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import type { Recipient } from '@/types/sms';
import {
  moveRecipientColumn,
  resizeRecipientColumn,
  resolveRecipientColumns,
  type RecipientColumnLayout,
} from '@/lib/recipient-columns';
import {
  clearRecipientColumnLayout,
  readRecipientColumnLayout,
  writeRecipientColumnLayout,
} from '@/lib/recipient-columns-store';
import { useUserStore } from '@/store/user-store';
import { DEFAULT_RECIPIENT_SORT, nextRecipientSort, sortRecipients, type RecipientSort } from './recipient-table-sort';
/** 이 폭 미만을 폰 화면으로 본다. */
export const COMPACT_MAX_WIDTH = 768;
/** 간단보기의 빈 열 목록. 매번 새 배열을 만들면 배치 계산이 렌더마다 다시 돈다. */
const NO_FIELDS: string[] = [];
export function useRecipientTableColumns(items: Recipient[]) {
  const { width: viewportWidth } = useWindowDimensions();
  const [preference, setPreference] = useState<boolean | null>(null);
  const [sort, setSort] = useState<RecipientSort>(DEFAULT_RECIPIENT_SORT);
  const userId = useUserStore((state) => state.profile?.userId);
  /**
   * 🔴 **저장된 배치를 「누구 것인지」와 함께 들고 있는다.** 계정이 바뀌면 이 값의 주인이 달라지고,
   * 그 순간부터 아래 `layout` 은 렌더 중에 곧바로 null 이 된다 — 앞 계정의 열 배치가 **한 프레임도**
   * 남지 않는다. 계정이 바뀐 뒤 효과에서 지우는 방식이면 그 한 프레임이 실제로 보인다.
   */
  const [owned, setOwned] = useState<{ userId: string; layout: RecipientColumnLayout | null } | null>(null);
  const layout = owned && owned.userId === userId ? owned.layout : null;
  const allInfo = preference ?? viewportWidth >= COMPACT_MAX_WIDTH;
  const all = useMemo(() => [...new Set(items.flatMap((item) => (item.customFields ?? []).map((field) => field.name)))], [items]);
  const fields = allInfo ? all : NO_FIELDS;
  // 목록 정렬은 여기 한 곳에서만 하고, 선택 상태는 건드리지 않는다(표시 순서만 변경).
  const rows = useMemo(() => sortRecipients(items, sort), [items, sort]);
  /**
   * ⚠️ 저장된 배치는 **효과에서 비동기로** 읽는다. 첫 렌더는 기본 배치로 그려지고 곧 저장값으로
   * 바뀌는데, 그 한 번의 깜빡임을 없애겠다고 렌더 중에 저장소를 읽으면 네이티브에서는 아예
   * 읽을 수 없고(비동기) 웹에서는 매 렌더마다 동기 저장소 접근이 끼어든다.
   *
   * 🔴 **`userId` 가 바뀌면 다시 읽는다.** 그리고 늦게 도착한 응답은 `alive` 로 버린다 — A 계정
   * 배치를 읽는 도중 B 로 갈아타면 그 응답은 B 화면에 A 배치를 얹는다(→ 같은 방식:
   * `components/external-send-registration.tsx`). 읽은 값에 주인을 함께 적어 두는 것도 같은 이유다.
   *
   * ⚠️ `userId` 가 아직 없으면(프로필 로딩 전·로그아웃) **읽지도 쓰지도 않는다.** 주인 없는 칸에
   * 쌓인 배치는 나중에 누구 것인지 알 수 없다.
   */
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void readRecipientColumnLayout(userId).then((stored) => {
      if (alive) setOwned({ userId, layout: stored });
    });
    return () => {
      alive = false;
    };
  }, [userId]);
  const { order, widths } = useMemo(() => resolveRecipientColumns(fields, layout), [fields, layout]);
  /**
   * 🔴 저장은 **누를 때의 계정**으로 한다. 오래된 클로저에 갇힌 userId 로 쓰면 방금 나간 계정의
   * 칸에 저장된다 — 그 값은 다음에 그 계정으로 들어온 사람 화면에서야 드러난다.
   */
  const account = useRef(userId);
  useEffect(() => {
    account.current = userId;
  }, [userId]);
  const save = useCallback((next: RecipientColumnLayout) => {
    const owner = account.current;
    if (!owner) return;
    setOwned({ userId: owner, layout: next });
    void writeRecipientColumnLayout(owner, next);
  }, []);
  return {
    allInfo,
    compact: viewportWidth < COMPACT_MAX_WIDTH && !allInfo,
    viewportWidth,
    setAllInfo: setPreference,
    fields,
    rows,
    sort,
    toggleSort: (key: string) => setSort((sorted) => nextRecipientSort(sorted, key)),
    columnOrder: order,
    columnWidths: widths,
    /** 저장된 배치가 있는가 — 「열 초기화」를 보일지 정하는 데만 쓴다. */
    customized: !!layout,
    moveColumn: (id: string, toIndex: number) => save({ version: 1, order: moveRecipientColumn(order, id, toIndex), widths }),
    resizeColumn: (id: string, width: number) => save({ version: 1, order, widths: resizeRecipientColumn(widths, id, width) }),
    resetColumns: () => {
      const owner = account.current;
      setOwned(owner ? { userId: owner, layout: null } : null);
      if (owner) void clearRecipientColumnLayout(owner);
    },
  };
}
export function recipientSentSummary(item: Recipient, short = false) {
  if (!item.sentCount) return '';
  // 한 줄 목록에서는 날짜를 월/일만 남긴다(전체 시각은 이력 시트에서 확인).
  if (short) {
    const date = item.latestSentAt ? new Date(item.latestSentAt) : null;
    return `${item.sentCount}건${date ? `·${date.getMonth() + 1}/${date.getDate()}` : ''}`;
  }
  return `${item.sentCount}건${item.latestSentAt ? ` (${new Date(item.latestSentAt).toLocaleString('ko-KR')})` : ''}`;
}
