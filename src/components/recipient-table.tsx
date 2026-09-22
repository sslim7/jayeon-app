import { RecipientTableToolbar } from './recipient-table-toolbar';
import { ReservedMark } from './reserved-mark';
import { useEffect, useRef, useState } from 'react';
import { formatPhone } from '@/lib/phone';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { colors, fonts, text } from '@/constants/theme';
import { recipientSentSummary, useRecipientTableColumns } from './recipient-table-columns';
import { customSortKey, sortHeaderLabel, sortIndicator, type RecipientSort } from './recipient-table-sort';
import type { RecipientTableProps } from './recipient-table-types';

/**
 * 네이티브 표. 열 순서는 웹과 같게 맞춰 두었다 — 이름 → 전화번호 → 사용자 정의 → 그룹 → 발송건수.
 *
 * ⚠️ **끌어서 순서를 바꾸거나 너비를 조절하는 조작은 일부러 넣지 않았다. 결함이 아니다.**
 * 이 앱은 인증 뒤 화면을 배포된 웹으로 띄우는 껍데기라(→ `lib/shell-routes.ts`) 이 표는 껍데기를
 * 끈 검증 빌드에서만 그려진다. 게다가 여기 고정 열은 `Animated` 로 가로 스크롤을 따라 움직이게
 * 만든 구조라, 열을 옮길 수 있게 하려면 그 보정 계산을 전부 다시 짜야 한다 — 아무도 보지 않는
 * 화면에 그 값을 치를 이유가 없다. 조작은 웹 표에만 있다(→ `recipient-table.web.tsx`).
 */
export function RecipientTable({ items, selectedIds, onSelectionChange, onHistory, disabled, onEdit, onRemove, includeSentFilter, reservedIds }: RecipientTableProps) {
  const { allInfo, compact, viewportWidth, setAllInfo, fields, rows, sort, toggleSort } = useRecipientTableColumns(items);
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
  const ids = rows.map((item) => item.id);
  const count = ids.filter((id) => selectedIds.includes(id)).length;
  const all = rows.length > 0 && count === rows.length;
  const mixed = count > 0 && !all;
  return <View>
    <RecipientTableToolbar total={items.length} selectedCount={selectedIds.length} allInfo={allInfo} onViewChange={setAllInfo} includeSentFilter={includeSentFilter} />
    <Animated.ScrollView ref={horizontalRef} horizontal style={styles.table} removeClippedSubviews={false} scrollEventThrottle={16} onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}>
    <View style={{ width: tableWidth }}>
      <View style={[styles.row, { backgroundColor: colors.bg }]}>
        <Animated.View style={[styles.fixedColumns, fixedStyle, { backgroundColor: colors.bg }]}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel="전체 선택" aria-checked={mixed ? 'mixed' : all} accessibilityState={{ checked: mixed ? 'mixed' : all }} disabled={disabled || !rows.length} style={[styles.check, columns.check]} onPress={() => onSelectionChange(all ? selectedIds.filter((id) => !ids.includes(id)) : [...new Set([...selectedIds, ...ids])])}><Text>{all ? '☑' : mixed ? '▣' : '☐'}</Text></Pressable>
        <SortHeading label="이름" sortKey="name" sort={sort} onToggle={toggleSort} style={columns.name} cellStyle={[styles.cell, columns.cell]} />
        </Animated.View><SortHeading label="전화번호" sortKey="phone" sort={sort} onToggle={toggleSort} style={columns.phone} cellStyle={[styles.cell, columns.cell]} />
        {fields.map((name) => <SortHeading key={name} label={name} sortKey={customSortKey(name)} sort={sort} onToggle={toggleSort} style={{ width: 140 }} cellStyle={styles.cell} />)}
        <SortHeading label="그룹" sortKey="group" sort={sort} onToggle={toggleSort} style={columns.group} cellStyle={[styles.cell, columns.cell]} /><SortHeading label="발송건수" sortKey="sent" sort={sort} onToggle={toggleSort} style={columns.date} cellStyle={[styles.cell, columns.cell]} />
        {actions ? <Text style={[styles.cell, { width: compact ? 44 : 160 }]}>관리</Text> : null}
      </View>
      {rows.map((item) => <View key={item.id} style={[styles.row, { backgroundColor: selectedIds.includes(item.id) ? colors.sageRow : colors.card }]}>
        <Animated.View style={[styles.fixedColumns, fixedStyle]}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: selectedIds.includes(item.id) ? colors.sageRow : colors.card }]} />
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.name} · ${formatPhone(item.phone)}${item.groupId ? ` · ${item.groupId}` : ''}`} accessibilityState={{ checked: selectedIds.includes(item.id) }} disabled={disabled} style={[styles.check, columns.check]} onPress={() => onSelectionChange(selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id])}><Text>{selectedIds.includes(item.id) ? '☑' : '☐'}</Text></Pressable>
        {/* 예약 표시는 이름 칸 안에서 이름 왼쪽에 붙인다. */}
        <View style={[columns.name, styles.nameCell]}>
          {reservedIds?.has(item.id) ? <ReservedMark size={13} /> : null}
          {onEdit && !actions ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 수정`} disabled={disabled} onPress={() => onEdit(item)} style={styles.nameFill}><Text numberOfLines={1} style={[styles.cell, columns.cell, { color: colors.greenText, textDecorationLine: 'underline' }]}>{item.name}</Text></Pressable> : <Text numberOfLines={1} style={[styles.cell, columns.cell, styles.nameFill]}>{item.name}</Text>}
        </View>
        </Animated.View><Text style={[styles.cell, columns.cell, columns.phone]}>{formatPhone(item.phone)}</Text>
        {fields.map((name) => <Text key={name} style={[styles.cell, { width: 140 }]}>{item.customFields?.find((field) => field.name === name)?.value || '—'}</Text>)}
        <Text style={[styles.cell, columns.cell, columns.group]}>{item.groupId || '—'}</Text>
        {item.sentCount ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 발송 이력 보기`} style={columns.date} onPress={() => onHistory(item)}><Text style={[styles.cell, columns.cell, { color: colors.greenText, textDecorationLine: 'underline' }]}>{recipientSentSummary(item)}</Text></Pressable> : <View style={columns.date} />}
        {actions ? <View style={{ width: compact ? 44 : 160, flexDirection: compact ? 'column' : 'row', gap: 4 }}>
          {onEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 수정`} disabled={disabled} onPress={() => onEdit(item)} style={{ padding: 4 }}><Text style={{ ...fonts.body, fontSize: text.base, color: colors.greenText }}>수정</Text></Pressable> : null}
          {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 삭제`} disabled={disabled} onPress={() => onRemove(item)} style={{ padding: 4 }}><Text style={{ ...fonts.body, fontSize: text.base, color: colors.red }}>삭제</Text></Pressable> : null}
        </View> : null}
      </View>)}
      {!rows.length ? <Text style={styles.cell}>조건에 맞는 수신자가 없습니다.</Text> : null}
    </View>
  </Animated.ScrollView>
  </View>;
}
/** 제목을 눌러 그 열로 정렬한다(누를 때마다 오름/내림 토글). */
function SortHeading({ label, sortKey, sort, onToggle, style, cellStyle }: { label: string; sortKey: string; sort: RecipientSort; onToggle: (key: string) => void; style: StyleProp<ViewStyle>; cellStyle: StyleProp<TextStyle> }) {
  const arrow = sortIndicator(sort, sortKey);
  return <Pressable accessibilityRole="button" accessibilityLabel={sortHeaderLabel(label, sort, sortKey)} onPress={() => onToggle(sortKey)} style={[styles.heading, style]}>
    <Text numberOfLines={1} style={[cellStyle, styles.headingText]}>{label}</Text>
    {arrow ? <Text aria-hidden style={styles.arrow}>{arrow}</Text> : null}
  </Pressable>;
}
const styles = StyleSheet.create({
  table: { borderWidth: 1, borderColor: colors.borderPill, flexGrow: 0 },
  fixedColumns: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', zIndex: 2, backgroundColor: colors.card, borderRightWidth: 1, borderRightColor: colors.borderPill },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.border },
  cell: { ...fonts.body, fontSize: text.md, color: colors.ink, padding: 12 },
  check: { width: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRightWidth: 1, borderRightColor: colors.border },
  heading: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  nameCell: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  nameFill: { flexShrink: 1, minWidth: 0 },
  headingText: { flexShrink: 1 },
  arrow: { ...fonts.body, fontSize: text.sm, color: colors.greenText, paddingRight: 4 },
  name: { width: 110 }, phone: { width: 155 }, group: { width: 115 }, date: { width: 252 },
});
