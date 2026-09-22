import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Choice, s as smsUi } from '@/components/sms-ui';
import { ViewToggle } from '@/components/view-toggle';
import { colors, fonts, text } from '@/constants/theme';
import type { RecipientTableProps } from './recipient-table-types';

/** 조회 수와 전체 선택 수는 구분하고, 두 플랫폼에서 같은 보기 조작을 제공한다. */
export function RecipientTableToolbar({ total, selectedCount, allInfo, onViewChange, includeSentFilter, onResetColumns, dense = false }: {
  dense?: boolean;
  total: number;
  selectedCount: number;
  allInfo: boolean;
  onViewChange: (allInfo: boolean) => void;
  includeSentFilter?: RecipientTableProps['includeSentFilter'];
  /**
   * 🔴 열 배치를 되돌리는 길. **없으면 안 된다** — 열을 최소 폭까지 줄여 놓거나 순서를 뒤섞어
   * 놓고 되돌릴 방법이 없으면 사용자는 자기가 만든 화면에 갇힌다.
   *
   * 선택적인 것은 이 조작이 웹 표에만 있기 때문이다(→ `recipient-table.web.tsx`). 네이티브 표는
   * 넘기지 않으므로 아무것도 그려지지 않는다.
   */
  onResetColumns?: () => void;
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
      {/* 모양은 옆의 `Choice plain` 과 맞추되 역할은 버튼이다 — 켜고 끄는 값이 아니라 한 번 누르는 되돌리기다. */}
      {onResetColumns ? <Pressable accessibilityRole="button" accessibilityLabel="열 순서와 너비를 기본값으로 되돌리기" onPress={onResetColumns} style={[smsUi.choice, styles.reset]}><Text style={smsUi.body}>↺ 열 초기화</Text></Pressable> : null}
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
  reset: { borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 },
});
