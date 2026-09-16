import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { Choice } from '@/components/sms-ui';
import { colors, fonts, radii, text } from '@/constants/theme';
import type { RecipientTableProps } from './recipient-table-types';

/** 조회 수와 전체 선택 수는 구분하고, 두 플랫폼에서 같은 보기 조작을 제공한다. */
export function RecipientTableToolbar({ total, selectedCount, allInfo, onViewChange, includeSentFilter }: {
  total: number;
  selectedCount: number;
  allInfo: boolean;
  onViewChange: (allInfo: boolean) => void;
  includeSentFilter?: RecipientTableProps['includeSentFilter'];
}) {
  return <View style={styles.toolbar}>
    <View style={styles.counts} accessibilityLiveRegion="polite">
      <Text style={styles.count}>전체 {total}명</Text>
      <Text style={styles.count}>선택 {selectedCount}명</Text>
    </View>
    <View style={styles.controls}>
      {includeSentFilter ? <Choice plain label="기발신자포함" selected={includeSentFilter.selected} disabled={includeSentFilter.disabled} onPress={includeSentFilter.onPress} /> : null}
      <View style={styles.views}>
        {[false, true].map((full) => {
          const label = full ? '전체정보뷰' : '간단뷰';
          const selected = allInfo === full;
          return <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} aria-pressed={selected} ref={(node) => { if (Platform.OS === 'web' && node) (node as unknown as HTMLElement).setAttribute('title', label); }} onPress={() => onViewChange(full)} style={[styles.button, selected && styles.selected]}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={selected ? colors.greenText : colors.mid} strokeWidth={1.7} aria-hidden={true}>
              <Rect x={3} y={4} width={18} height={16} rx={2} />
              <Path d={full ? 'M3 9h18M3 14h18M9 4v16M15 4v16' : 'M3 9h18M3 14h18M10 4v16'} />
            </Svg>
          </Pressable>;
        })}
      </View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  count: { ...fonts.body, fontSize: text.lg, color: colors.ink },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' },
  views: { flexDirection: 'row', gap: 4 },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderPill, borderRadius: radii.button, backgroundColor: colors.card },
  selected: { backgroundColor: colors.sageRow, borderColor: colors.greenText },
});
