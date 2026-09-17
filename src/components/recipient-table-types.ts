import type { Recipient } from '@/types/sms';
export type RecipientTableProps = {
  items: Recipient[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onHistory: (recipient: Recipient) => void;
  disabled?: boolean;
  includeSentFilter?: { selected: boolean; disabled?: boolean; onPress: () => void };
  onEdit?: (recipient: Recipient) => void;
  onRemove?: (recipient: Recipient) => void;
  /** 예약(READY 캠페인)에 들어 있는 수신자 id. 이름 앞 예약 표시 판정에만 쓴다. */
  reservedIds?: ReadonlySet<string>;
  /** 좁은 화면의 발송 목록: 선택 수를 (M/N)로 줄이고 간단뷰를 한 줄 행으로, 남은 높이를 채워 그 안에서 스크롤한다(웹). */
  dense?: boolean;
};
