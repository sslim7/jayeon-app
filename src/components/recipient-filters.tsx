import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { colors, fonts, inputFontSize, radii, text } from '@/constants/theme';

/** 그룹과 이름·번호 검색을 좁은 화면에서도 한 줄로 제공한다. */
export function RecipientFilters({ groups, group, onGroupChange, query, onQueryChange }: {
  groups: string[];
  group: string;
  onGroupChange: (group: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const trigger = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  useEffect(() => {
    // 🔴 `window` 의 존재가 아니라 **`addEventListener` 의 존재**를 본다. React Native 에도
    // `window` 는 있고(`global.window = global`) 그 함수만 없어서, 존재로 가르면 네이티브에서
    // 「undefined is not a function」이 난다(→ `components/app-navigation.tsx` 의 같은 함정).
    if (!anchor || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setAnchor(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [anchor]);
  const open = () => trigger.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
    setAnchor({ left: Math.max(8, Math.min(x, width - 208)), top: y + measuredHeight + 4, width: Math.max(200, measuredWidth) });
  });
  return <View style={styles.row}>
    <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={group || '모든그룹'} aria-haspopup="menu" accessibilityState={{ expanded: !!anchor }} aria-expanded={!!anchor} onPress={open} style={styles.trigger}>
      <Text numberOfLines={1} style={styles.group}>{group || '모든그룹'}</Text><Text aria-hidden style={styles.arrow}>▼</Text>
    </Pressable>
    <TextInput accessibilityLabel="이름,전화번호 뒷자리 4자" placeholder="이름,전화번호 뒷자리 4자" placeholderTextColor={colors.muted} value={query} onChangeText={onQueryChange} style={styles.input} />
    {anchor ? <Modal transparent visible animationType="none" onRequestClose={() => setAnchor(null)}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="그룹 선택 닫기" style={StyleSheet.absoluteFill} onPress={() => setAnchor(null)} />
        <View accessibilityRole="menu" style={[styles.menu, { left: anchor.left, top: Math.min(anchor.top, Math.max(8, height - 160)), width: Math.min(anchor.width, width - 16), maxHeight: Math.max(120, Math.min(280, height - anchor.top - 12)) }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            {['', ...groups].map((value) => <Pressable key={value} accessibilityRole="menuitem" accessibilityLabel={value || '모든그룹'} accessibilityState={{ selected: group === value }} onPress={() => { onGroupChange(value); setAnchor(null); }} style={[styles.option, group === value && styles.selected]}>
              <Text style={styles.optionText}>{value || '모든그룹'}</Text>
            </Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal> : null}
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  trigger: { width: 128, maxWidth: '40%', minWidth: 0, height: 46, paddingHorizontal: 12, flexDirection: 'row', gap: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.borderPill, borderRadius: radii.button, backgroundColor: colors.card },
  group: { ...fonts.body, color: colors.ink, fontSize: text.md, flex: 1, minWidth: 0 },
  arrow: { fontSize: text.sm, color: colors.mid },
  input: { ...fonts.body, flex: 1, minWidth: 0, height: 46, paddingHorizontal: 12, fontSize: inputFontSize(text.md), color: colors.ink, borderWidth: 1, borderColor: colors.borderPill, borderRadius: radii.button, backgroundColor: colors.card },
  overlay: { flex: 1 },
  menu: { position: 'absolute', borderWidth: 1, borderColor: colors.borderPill, borderRadius: radii.button, backgroundColor: colors.card, overflow: 'hidden' },
  option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  selected: { backgroundColor: colors.sageRow },
  optionText: { ...fonts.body, color: colors.ink, fontSize: text.md },
});
