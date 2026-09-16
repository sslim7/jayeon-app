import { Pressable, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, radii } from '@/constants/theme';

type Panel = 'register' | 'templates' | 'history';

const items: { panel: Panel; label: string; icon: string; frozenDisables: boolean }[] = [
  // 사람 + 더하기
  { panel: 'register', label: '수신자 등록', icon: 'M3 20v-1a6 6 0 0 1 12 0v1M19 8v6M16 11h6', frozenDisables: true },
  // 접힌 모서리 문서
  { panel: 'templates', label: '템플릿', icon: 'M6 3h8l4 4v14H6V3Zm8 0v4h4M9 12h6M9 16h6', frozenDisables: true },
  // 시계
  { panel: 'history', label: '발송 이력', icon: 'M12 7v5l3 2', frozenDisables: false },
];

/** 좁은 화면에서 글자 버튼 대신 헤더에 올리는 아이콘 버튼. 동작과 비활성 규칙은 글자 버튼과 같다. */
export function SmsHeaderActions({ frozen, onOpen }: { frozen: boolean; onOpen: (panel: Panel) => void }) {
  return <>
    {items.map((item) => {
      const disabled = item.frozenDisables && frozen;
      return <Pressable key={item.panel} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onOpen(item.panel)} style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}>
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden={true}>
          {item.panel === 'register' ? <Circle cx={9} cy={8} r={3.5} /> : null}
          {item.panel === 'history' ? <Circle cx={12} cy={12} r={9} /> : null}
          <Path d={item.icon} />
        </Svg>
      </Pressable>;
    })}
  </>;
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, borderRadius: radii.button, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.inkFill },
  disabled: { opacity: 0.5 },
});
