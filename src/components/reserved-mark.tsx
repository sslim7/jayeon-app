import { Platform, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '@/constants/theme';

/** 이름 앞에 붙는 예약 표시. 그 사람이 아직 보내지 않은 캠페인(예약)에 들어 있을 때만 보인다. */
export function ReservedMark({ size = 14 }: { size?: number }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="예약됨"
      // 웹은 마우스를 올렸을 때도 뜻을 알 수 있게 같은 문구를 툴팁으로 준다.
      ref={(node) => { if (Platform.OS === 'web' && node) (node as unknown as HTMLElement).setAttribute('title', '예약됨'); }}
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.greenText} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Rect x={3} y={5} width={18} height={16} rx={2.5} />
        <Path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4" />
      </Svg>
    </View>
  );
}
