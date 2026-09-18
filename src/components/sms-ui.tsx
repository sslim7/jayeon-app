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
export function SmsPage({ title, children, wide = false, actions, hideTitle = false, compact = false, footer, fab, onEndReached }: PropsWithChildren<{ title: string; wide?: boolean; actions?: ReactNode; hideTitle?: boolean; compact?: boolean; footer?: ReactNode; fab?: ReactNode; onEndReached?: () => void }>) {
  return (
    <SafeAreaView style={s.root}>
      <Stack.Screen options={{ title }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        /*
          바닥이 가까워지면 알린다(끝없이 이어 붙이는 목록용). 한 화면 못 미친 자리에서 미리
          부르는 이유는, 바닥에 닿은 뒤에 요청하면 스크롤이 **눈에 보이게 멈추기** 때문이다.
          중복 호출은 부르는 쪽이 「이미 받는 중인가」로 막는다.
        */
        onScroll={onEndReached ? ({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 320) onEndReached();
        } : undefined}
        scrollEventThrottle={200}
        // 제목을 앱 헤더가 대신 보여 주면 헤더 제목↔구분선 간격(약 12)과 같게 붙인다.
        // footer 가 있으면 본문이 남은 높이를 채워 목록이 그 안에서 스크롤할 수 있게 한다.
        // fab 이 있으면 그 원(60)과 아래 여백만큼 본문을 더 비운다 — 안 비우면 목록 마지막 줄이 버튼에 가린다.
        contentContainerStyle={[s.page, wide && { maxWidth: '100%' }, hideTitle && { paddingTop: spacing.md }, compact && s.pageCompact, !!footer && { flexGrow: 1, paddingBottom: spacing.md }, !!fab && { paddingBottom: 60 + spacing.xxl + spacing.lg }]}
      >
        {!hideTitle || actions ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md }}>
        {!hideTitle ? <Text accessibilityRole="header" style={[s.title, { flexGrow: 1 }]}>
          {title}
        </Text> : null}
        {actions ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginLeft: 'auto' }}>{actions}</View> : null}
        </View> : null}
        {children}
      </ScrollView>
      {/* 스크롤 영역 밖에 두어 목록 길이와 상관없이 항상 보인다. 하단 안전 영역은 루트가 채운다. */}
      {footer ? <View style={[s.footer, compact && { paddingHorizontal: spacing.lg }]}>{footer}</View> : null}
      {/* 스크롤 밖 · 안전 영역 안. 목록이 아무리 길어져도 같은 자리에 남는다. */}
      {fab}
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
  fill = false,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
  /** 한 줄에 여러 버튼을 나란히 둘 때. 폭을 나눠 갖고 좌우 여백을 줄여 폰 폭에서도 한 줄에 들어간다. */
  fill?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, fill && s.buttonFill, disabled && { opacity: 0.5 }]}
    >
      <Text numberOfLines={fill ? 1 : undefined} style={[s.buttonText, secondary && { color: danger ? colors.red : colors.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}
/**
 * 오른쪽 아래의 둥근 「+」.
 *
 * 화면에서 할 수 있는 일이 「읽기」와 「새로 만들기」 둘뿐인 목록에 둔다 — 헤더 버튼은 목록을
 * 내리면 눈에서 멀어지지만, 이 자리는 어디까지 내려가도 손이 닿는 곳에 그대로 있다.
 * 형제 프로젝트(birdieup-app `app/boards.tsx`)의 만들기 버튼과 같은 규격이다.
 */
export function Fab({ accessibilityLabel, onPress }: { accessibilityLabel: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [s.fab, pressed && s.fabOn]}
    >
      <Text style={s.fabPlus}>+</Text>
    </Pressable>
  );
}
/** 한 줄에 나란히 놓는 조작 묶음. 자식은 `fill` 버튼이어야 폭을 고르게 나눈다. */
export function ButtonRow({ children }: PropsWithChildren) {
  return <View style={s.buttonRow}>{children}</View>;
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
/**
 * 진행 막대. **실제로 센 진행률만 그린다** — 값을 낼 수 없는 단계는 부르는 쪽이 스피너를
 * 쓴다(→ `lib/call-progress.ts`). 움직이기만 하는 막대는 「멈췄나?」를 풀어 주지 못한다.
 */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View
      // aria-* 로 적는다. react-native-web 은 RN 의 중첩 `accessibilityValue` 를 옮기지 않는다.
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      style={s.progressTrack}>
      <View style={[s.progressFill, { width: `${value}%` }]} />
    </View>
  );
}
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
  pageCompact: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  footer: { paddingHorizontal: spacing.xxl, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderPill, backgroundColor: colors.bg },
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
  fab: { position: 'absolute', right: spacing.xl, bottom: spacing.xxl, width: 60, height: 60, borderRadius: 30, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  fabOn: { backgroundColor: colors.green },
  /** 글리프가 아래로 치우쳐 있어 조금 올려야 원 가운데에 선다(lineHeight > fontSize). */
  fabPlus: { ...fonts.bodyMedium, fontSize: text.display, lineHeight: 34, color: colors.onInk },
  buttonFill: { flex: 1, paddingHorizontal: spacing.xs },
  buttonRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  buttonText: { ...fonts.bodySemi, color: colors.onInk, fontSize: text.lg },
  link: {
    ...fonts.bodySemi,
    color: colors.greenText,
    fontSize: text.lg,
    paddingVertical: spacing.sm,
  },
  progressTrack: { width: '100%', height: 6, borderRadius: radii.hair, backgroundColor: colors.inkFillSoft, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radii.hair, backgroundColor: colors.green },
  choice: {
    borderWidth: 1,
    borderColor: colors.borderCard,
    borderRadius: radii.button,
    padding: spacing.md,
    minHeight: 48,
  },
});
