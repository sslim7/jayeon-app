import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, fonts, radii, spacing, text } from '@/constants/theme';

type Panel = 'register' | 'templates' | 'history';

const items: { panel: Panel; label: string; icon: string; frozenDisables: boolean }[] = [
  // 사람 + 더하기
  { panel: 'register', label: '수신자 등록', icon: 'M3 20v-1a6 6 0 0 1 12 0v1M19 8v6M16 11h6', frozenDisables: true },
  // 접힌 모서리 문서
  { panel: 'templates', label: '템플릿', icon: 'M6 3h8l4 4v14H6V3Zm8 0v4h4M9 12h6M9 16h6', frozenDisables: true },
  // 시계
  { panel: 'history', label: '발송 이력', icon: 'M12 7v5l3 2', frozenDisables: false },
];

/**
 * 좁은 화면에서 글자 버튼 대신 헤더에 올리는 아이콘 버튼. 동작과 비활성 규칙은 글자 버튼과 같다.
 *
 * 툴팁은 브라우저 기본(`title`)을 쓰지 않는다 — 1초 넘게 가만히 있어야 뜨고 기기·설정에 따라
 * 아예 뜨지 않아서 「아이콘 뜻을 모르겠다」는 문제를 풀지 못한다. 그래서 hover 즉시 뜨는
 * 말풍선을 직접 그린다. hover 가 없는 터치 기기에서는 이벤트 자체가 오지 않아 보이지 않는다.
 */
export function SmsHeaderActions({ frozen, onOpen }: { frozen: boolean; onOpen: (panel: Panel) => void }) {
  const [hovered, setHovered] = useState<Panel | null>(null);
  return <>
    {items.map((item) => {
      const disabled = item.frozenDisables && frozen;
      return <View key={item.panel} style={styles.slot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onHoverIn={() => setHovered(item.panel)}
          onHoverOut={() => setHovered((current) => (current === item.panel ? null : current))}
          onPress={() => { setHovered(null); onOpen(item.panel); }}
          style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden={true}>
            {item.panel === 'register' ? <Circle cx={9} cy={8} r={3.5} /> : null}
            {item.panel === 'history' ? <Circle cx={12} cy={12} r={9} /> : null}
            <Path d={item.icon} />
          </Svg>
        </Pressable>
        {/* 아이콘 아래 말풍선. 이미 읽어 주는 이름이라 보조기술에는 숨기고 마우스만 가리지 않게 한다. */}
        {hovered === item.panel ? <View pointerEvents="none" aria-hidden={true} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.tooltip}>
          <Text numberOfLines={1} style={styles.tooltipLabel}>{item.label}</Text>
        </View> : null}
      </View>;
    })}
  </>;
}

const styles = StyleSheet.create({
  slot: { alignItems: 'center' },
  button: { width: 40, height: 40, borderRadius: radii.button, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.inkFill },
  disabled: { opacity: 0.5 },
  tooltip: { position: 'absolute', top: 42, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.chipSm, backgroundColor: colors.ink, zIndex: 10 },
  tooltipLabel: { ...fonts.bodyMedium, fontSize: text.sm, color: colors.onInk },
});
