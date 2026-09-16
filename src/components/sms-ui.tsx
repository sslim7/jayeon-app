import type { PropsWithChildren, ReactNode } from 'react';
import { Stack } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, layout, radii, spacing, text } from '@/constants/theme';
import { readApiErrorMessage } from '@/lib/api-errors';

export function smsError(error: unknown): string {
  if (error instanceof Error && error.name === 'Error') return error.message;
  return readApiErrorMessage(error, {}, '처리하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
}
export function SmsPage({ title, children, wide = false, actions, hideTitle = false }: PropsWithChildren<{ title: string; wide?: boolean; actions?: ReactNode; hideTitle?: boolean }>) {
  return (
    <SafeAreaView style={s.root}>
      <Stack.Screen options={{ title }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.page, wide && { maxWidth: '100%' }]}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md }}>
        {!hideTitle ? <Text accessibilityRole="header" style={[s.title, { flexGrow: 1 }]}>
          {title}
        </Text> : null}
        {actions ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginLeft: 'auto' }}>{actions}</View> : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function SmsButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  secondary = false,
  danger = false,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && { opacity: 0.5 }]}
    >
      <Text style={[s.buttonText, secondary && { color: danger ? colors.red : colors.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}
export function Notice({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <Text
      selectable
      accessibilityRole={error ? 'alert' : undefined}
      style={[s.body, error && { color: colors.red }]}
    >
      {message}
    </Text>
  );
}
export function Loading() {
  return <ActivityIndicator accessibilityLabel="불러오는 중" color={colors.green} />;
}
export function Choice({
  label,
  selected,
  onPress,
  disabled,
  plain = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  plain?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      disabled={disabled}
      onPress={onPress}
      style={[s.choice, selected && { backgroundColor: colors.sageRow }, plain && { borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 }]}
    >
      <Text style={s.body}>
        {selected ? '☑' : '☐'} {label}
      </Text>
    </Pressable>
  );
}
export const statusLabel: Record<string, string> = {
  READY: '대기',
  SENDING: '발송 중 · 확인 필요',
  SENT: '성공',
  FAILED: '실패',
  UNKNOWN: '결과 확인 필요',
  COMPLETED: '완료',
  PARTIAL_FAILED: '일부 실패 / 확인 필요',
  CANCELLED: '중단',
};
export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  page: {
    width: '100%',
    maxWidth: layout.maxContentWidth + 200,
    alignSelf: 'center',
    padding: spacing.xxl,
    gap: spacing.lg,
    paddingBottom: 60,
  },
  title: { ...fonts.bodyBold, color: colors.ink, fontSize: text.h1 },
  subtitle: { ...fonts.bodySemi, color: colors.ink, fontSize: text.xl },
  body: { ...fonts.body, color: colors.mid, fontSize: text.lg, lineHeight: 24 },
  meta: { ...fonts.body, color: colors.mid, fontSize: text.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.borderCard,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  button: {
    minHeight: 48,
    backgroundColor: colors.ink,
    borderRadius: radii.button,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderPill },
  buttonText: { ...fonts.bodySemi, color: colors.onInk, fontSize: text.lg },
  link: {
    ...fonts.bodySemi,
    color: colors.greenText,
    fontSize: text.lg,
    paddingVertical: spacing.sm,
  },
  choice: {
    borderWidth: 1,
    borderColor: colors.borderCard,
    borderRadius: radii.button,
    padding: spacing.md,
    minHeight: 48,
  },
});
