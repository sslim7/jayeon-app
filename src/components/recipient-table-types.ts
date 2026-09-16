import type { Recipient } from '@/types/sms';
export type RecipientTableProps = {
  items: Recipient[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onHistory: (recipient: Recipient) => void;
  disabled?: boolean;
  onEdit?: (recipient: Recipient) => void;
  onRemove?: (recipient: Recipient) => void;
};
