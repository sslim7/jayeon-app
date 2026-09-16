import { RecipientTableToolbar } from './recipient-table-toolbar';
import { useEffect, useRef, useState } from 'react';
import { formatPhone } from '@/lib/phone';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, text } from '@/constants/theme';
import { recipientSentSummary, useRecipientTableColumns } from './recipient-table-columns';
import type { RecipientTableProps } from './recipient-table-types';

export function RecipientTable({ items, selectedIds, onSelectionChange, onHistory, disabled, onEdit, onRemove, includeSentFilter }: RecipientTableProps) {
  const { allInfo, compact, viewportWidth, setAllInfo, fields } = useRecipientTableColumns(items);
  const actions = !!onRemove;
  const [scrollX] = useState(() => new Animated.Value(0));
  const horizontalRef = useRef<ScrollView>(null);
  const tableWidth = compact ? Math.max(240, viewportWidth - 48) : 680 + fields.length * 140 + (actions ? 160 : 0);
  const columns = compact ? { check: { width: 28 }, name: { width: tableWidth * 0.17 }, phone: { width: tableWidth * 0.25 }, group: { width: tableWidth * 0.14 }, date: { width: tableWidth * 0.44 - 28 - (actions ? 44 : 0) }, cell: { padding: 4, fontSize: text.base } } : { check: styles.check, name: styles.name, phone: styles.phone, group: styles.group, date: styles.date, cell: styles.cell };
  // 열 구성이 바뀌면 기존 가로 위치를 초기화해 고정 열의 보정값과 실제 위치를 맞춘다.
  useEffect(() => {
    horizontalRef.current?.scrollTo({ x: 0, animated: false });
    scrollX.setValue(0);
  }, [tableWidth, scrollX]);
  const fixedStyle = { width: columns.check.width + columns.name.width, transform: [{ translateX: scrollX }] };
  const ids = items.map((item) => item.id);
  const count = ids.filter((id) => selectedIds.includes(id)).length;
  const all = items.length > 0 && count === items.length;
  const mixed = count > 0 && !all;
  return <View>
    <RecipientTableToolbar total={items.length} selectedCount={selectedIds.length} allInfo={allInfo} onViewChange={setAllInfo} includeSentFilter={includeSentFilter} />
    <Animated.ScrollView ref={horizontalRef} horizontal style={styles.table} removeClippedSubviews={false} scrollEventThrottle={16} onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}>
    <ScrollView style={{ width: tableWidth, maxHeight: 432 }} stickyHeaderIndices={[0]} nestedScrollEnabled removeClippedSubviews={false}>
      <View style={[styles.row, { backgroundColor: colors.bg }]}>
        <Animated.View style={[styles.fixedColumns, fixedStyle, { backgroundColor: colors.bg }]}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel="전체 선택" aria-checked={mixed ? 'mixed' : all} accessibilityState={{ checked: mixed ? 'mixed' : all }} disabled={disabled || !items.length} style={[styles.check, columns.check]} onPress={() => onSelectionChange(all ? selectedIds.filter((id) => !ids.includes(id)) : [...new Set([...selectedIds, ...ids])])}><Text>{all ? '☑' : mixed ? '▣' : '☐'}</Text></Pressable>
        <Text style={[styles.cell, columns.cell, columns.name]}>이름</Text>
        </Animated.View><Text style={[styles.cell, columns.cell, columns.phone]}>전화번호</Text><Text style={[styles.cell, columns.cell, columns.group]}>그룹</Text><Text style={[styles.cell, columns.cell, columns.date]}>발송건수</Text>
        {fields.map((name) => <Text key={name} style={[styles.cell, { width: 140 }]}>{name}</Text>)}
        {actions ? <Text style={[styles.cell, { width: compact ? 44 : 160 }]}>관리</Text> : null}
      </View>
      {items.map((item) => <View key={item.id} style={[styles.row, { backgroundColor: selectedIds.includes(item.id) ? colors.sageRow : colors.card }]}>
        <Animated.View style={[styles.fixedColumns, fixedStyle]}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: selectedIds.includes(item.id) ? colors.sageRow : colors.card }]} />
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.name} · ${formatPhone(item.phone)}${item.groupId ? ` · ${item.groupId}` : ''}`} accessibilityState={{ checked: selectedIds.includes(item.id) }} disabled={disabled} style={[styles.check, columns.check]} onPress={() => onSelectionChange(selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id])}><Text>{selectedIds.includes(item.id) ? '☑' : '☐'}</Text></Pressable>
        {onEdit && !actions ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 수정`} disabled={disabled} onPress={() => onEdit(item)} style={columns.name}><Text style={[styles.cell, columns.cell, { color: colors.greenText, textDecorationLine: 'underline' }]}>{item.name}</Text></Pressable> : <Text style={[styles.cell, columns.cell, columns.name]}>{item.name}</Text>}
        </Animated.View><Text style={[styles.cell, columns.cell, columns.phone]}>{formatPhone(item.phone)}</Text><Text style={[styles.cell, columns.cell, columns.group]}>{item.groupId || '—'}</Text>
        {item.sentCount ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 발송 이력 보기`} style={columns.date} onPress={() => onHistory(item)}><Text style={[styles.cell, columns.cell, { color: colors.greenText, textDecorationLine: 'underline' }]}>{recipientSentSummary(item)}</Text></Pressable> : <View style={columns.date} />}
        {fields.map((name) => <Text key={name} style={[styles.cell, { width: 140 }]}>{item.customFields?.find((field) => field.name === name)?.value || '—'}</Text>)}
        {actions ? <View style={{ width: compact ? 44 : 160, flexDirection: compact ? 'column' : 'row', gap: 4 }}>
          {onEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 수정`} disabled={disabled} onPress={() => onEdit(item)} style={{ padding: 4 }}><Text style={{ ...fonts.body, fontSize: text.base, color: colors.greenText }}>수정</Text></Pressable> : null}
          {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 삭제`} disabled={disabled} onPress={() => onRemove(item)} style={{ padding: 4 }}><Text style={{ ...fonts.body, fontSize: text.base, color: colors.red }}>삭제</Text></Pressable> : null}
        </View> : null}
      </View>)}
      {!items.length ? <Text style={styles.cell}>조건에 맞는 수신자가 없습니다.</Text> : null}
    </ScrollView>
  </Animated.ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  table: { borderWidth: 1, borderColor: colors.borderPill, flexGrow: 0 },
  fixedColumns: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', zIndex: 2, backgroundColor: colors.card, borderRightWidth: 1, borderRightColor: colors.borderPill },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.border },
  cell: { ...fonts.body, fontSize: text.md, color: colors.ink, padding: 12 },
  check: { width: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRightWidth: 1, borderRightColor: colors.border },
  name: { width: 110 }, phone: { width: 155 }, group: { width: 115 }, date: { width: 252 },
});
