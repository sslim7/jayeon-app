import type { PropsWithChildren, ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SmsButton, s } from '@/components/sms-ui';
import { colors, radii, spacing } from '@/constants/theme';
export function BottomSheet({ title, visible, onClose, children, headerActions }: PropsWithChildren<{ title: string; visible: boolean; onClose: () => void; headerActions?: ReactNode }>) {
  // 웹의 종료 애니메이션이 끝나지 않아도 숨긴 모달의 포커스 제한은 즉시 해제한다.
  if (!visible) return null;
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel={`${title} 바깥 영역 닫기`} onPress={onClose} />
        <SafeAreaView style={styles.panel} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[s.subtitle, { flex: 1 }]}>{title}</Text>
            {headerActions}
            <SmsButton label="닫기" secondary onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{children}</ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.ink, opacity: 0.4 },
  // 등록 시트는 한 화면에 다 들어와야 한다(파일 선택 → 상대 → 통화일시 → 제출). 위에 남기는
  // 띠는 「뒤에 화면이 있다」를 알리는 최소한만 둔다.
  panel: { width: '100%', maxWidth: 720, maxHeight: '95%', alignSelf: 'center', backgroundColor: colors.bg, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, padding: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.md },
  content: { gap: spacing.lg, paddingBottom: spacing.xxl },
});
