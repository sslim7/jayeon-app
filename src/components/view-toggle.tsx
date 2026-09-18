import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors, radii } from '@/constants/theme';

/**
 * 「간단뷰 / 전체정보뷰」 전환.
 *
 * 수신자 표와 통화분석 목록이 **같은 아이콘·같은 이름**을 쓴다. 표마다 따로 그리면 한쪽만
 * 손보게 되고, 사용자는 화면마다 다른 그림을 다시 배워야 한다.
 */
export function ViewToggle({ allInfo, onChange, dense = false }: { allInfo: boolean; onChange: (allInfo: boolean) => void; dense?: boolean }) {
  return <View style={styles.views}>
    {[false, true].map((full) => {
      const label = full ? '전체정보뷰' : '간단뷰';
      const selected = allInfo === full;
      return <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} aria-pressed={selected} ref={(node) => { if (Platform.OS === 'web' && node) (node as unknown as HTMLElement).setAttribute('title', label); }} onPress={() => onChange(full)} style={[styles.button, dense && styles.denseButton, selected && styles.selected]}>
        <Svg width={dense ? 20 : 22} height={dense ? 20 : 22} viewBox="0 0 24 24" fill="none" stroke={selected ? colors.greenText : colors.mid} strokeWidth={1.7} aria-hidden={true}>
          <Rect x={3} y={4} width={18} height={16} rx={2} />
          <Path d={full ? 'M3 9h18M3 14h18M9 4v16M15 4v16' : 'M3 9h18M3 14h18M10 4v16'} />
        </Svg>
      </Pressable>;
    })}
  </View>;
}
const styles = StyleSheet.create({
  views: { flexDirection: 'row', gap: 4 },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderPill, borderRadius: radii.button, backgroundColor: colors.card },
  denseButton: { width: 40, height: 40 },
  selected: { backgroundColor: colors.sageRow, borderColor: colors.greenText },
});
