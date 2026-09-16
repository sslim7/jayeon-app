import { Pressable, Text } from 'react-native';
import { s } from '@/components/sms-ui';
export function SelectionHeader({ visibleIds, selectedIds, onChange, disabled }: { visibleIds: string[]; selectedIds: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const count = visibleIds.filter((id) => selectedIds.includes(id)).length;
  const all = visibleIds.length > 0 && count === visibleIds.length;
  const mixed = count > 0 && !all;
  return <Pressable accessibilityRole="checkbox" accessibilityLabel="전체 선택" aria-checked={mixed ? 'mixed' : all} accessibilityState={{ checked: mixed ? 'mixed' : all, disabled: disabled || !visibleIds.length }} disabled={disabled || !visibleIds.length} style={s.choice} onPress={() => onChange(all ? selectedIds.filter((id) => !visibleIds.includes(id)) : [...new Set([...selectedIds, ...visibleIds])])}>
    <Text style={s.body}>{all ? '☑' : mixed ? '▣' : '☐'} 전체 선택 · 현재 목록 {visibleIds.length}명</Text>
  </Pressable>;
}
