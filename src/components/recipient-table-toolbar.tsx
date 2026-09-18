import { StyleSheet, Text, View } from 'react-native';

import { Choice } from '@/components/sms-ui';
import { ViewToggle } from '@/components/view-toggle';
import { colors, fonts, text } from '@/constants/theme';
import type { RecipientTableProps } from './recipient-table-types';

/** 조회 수와 전체 선택 수는 구분하고, 두 플랫폼에서 같은 보기 조작을 제공한다. */
export function RecipientTableToolbar({ total, selectedCount, allInfo, onViewChange, includeSentFilter, dense = false }: {
  dense?: boolean;
  total: number;
  selectedCount: number;
  allInfo: boolean;
  onViewChange: (allInfo: boolean) => void;
  includeSentFilter?: RecipientTableProps['includeSentFilter'];
}) {
  return <View style={[styles.toolbar, dense && styles.denseToolbar]}>
    <View style={styles.counts} accessibilityLiveRegion="polite">
      {dense ? <Text accessibilityLabel={`전체 ${total}명 중 ${selectedCount}명 선택`} style={styles.count}>({selectedCount}/{total})</Text> : <>
        <Text style={styles.count}>전체 {total}명</Text>
        <Text style={styles.count}>선택 {selectedCount}명</Text>
      </>}
    </View>
    <View style={styles.controls}>
      {includeSentFilter ? <Choice plain label="기발신자포함" selected={includeSentFilter.selected} disabled={includeSentFilter.disabled} onPress={includeSentFilter.onPress} /> : null}
      {/* 통화분석 목록도 같은 전환을 쓴다(→ `components/view-toggle.tsx`). */}
      <ViewToggle allInfo={allInfo} onChange={onViewChange} dense={dense} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  count: { ...fonts.body, fontSize: text.lg, color: colors.ink },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' },
  denseToolbar: { flexWrap: 'nowrap', marginBottom: 8 },
});
