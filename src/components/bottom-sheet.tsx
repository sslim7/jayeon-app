import type { PropsWithChildren, ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SmsButton, s } from '@/components/sms-ui';
import { colors, radii, spacing } from '@/constants/theme';
export function BottomSheet({ title, visible, onClose, children, headerActions }: PropsWithChildren<{ title: string; visible: boolean; onClose: () => void; headerActions?: ReactNode }>) {
  /*
    🔴 **노치 자리는 시트가 아니라 바깥 컨테이너가 지킨다.** 패널의 `maxHeight: '95%'` 로는
    상단 인셋(아이폰 15 Pro 기준 59)을 못 피한다 — 844 화면의 위 5% 는 약 42 뿐이라 긴 시트는
    다이나믹 아일랜드 밑으로 올라간다. 여기서 `paddingTop` 으로 그 자리를 먼저 떼어 두면
    패널은 노치 **아래**에서만 자라고, 백분율 높이도 줄어든 부모를 기준으로 계산된다.
  */
  const insets = useSafeAreaInsets();
  // 웹의 종료 애니메이션이 끝나지 않아도 숨긴 모달의 포커스 제한은 즉시 해제한다.
  if (!visible) return null;
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel={`${title} 바깥 영역 닫기`} onPress={onClose} />
        {/*
          🔴 **`edges` 를 빼면 기본값이 네 방향 전부다.** SafeAreaView 는 자기가 화면 어디에
          붙어 있는지 모르므로, 아래에 붙은 이 패널에도 **위쪽 인셋을 안쪽 여백으로** 얹는다.
          그러면 제목 줄 위에 노치 높이(≈59)만큼 쓸모없는 빈 띠가 생긴다.

          ⚠️ **웹에서는 인셋이 0 이라 절대 드러나지 않는다** — 실기기에서만 보이는 결함이라
          브라우저로 아무리 확인해도 멀쩡해 보인다. 아래(홈 인디케이터)와 좌우(가로 모드 노치)는
          이 패널이 맡는 몫이므로 그대로 둔다. `components/sms-ui.tsx` 의 `SmsPage` 가 같은
          이유로 같은 모양이다.
        */}
        <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.panel} accessibilityViewIsModal>
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
