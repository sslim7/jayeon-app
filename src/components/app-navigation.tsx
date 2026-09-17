import { Link, useFocusEffect, usePathname } from 'expo-router';
import { Image } from 'expo-image';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileSheet, PasswordChangeSheet } from '@/components/profile-sheet';
import { useUserStore } from '@/store/user-store';
import { colors, fonts, radii, spacing, text } from '@/constants/theme';

const destinations = [
  { href: '/sms/new', label: '문자 보내기', icon: 'message' },
  { href: '/sms/reserved', label: '예약 문자 보내기', icon: 'reserved' },
] as const;

// 헤더는 화면 트리 밖에 있으므로 화면이 오른쪽 슬롯을 채울 통로만 둔다. 세터는 안정적이라 화면을 다시 그리지 않는다.
const HeaderActionsContext = createContext<(actions: ReactNode) => void>(() => {});

/** 포커스된 화면만 헤더 오른쪽에 조작을 올린다. 다른 화면이 위에 쌓이거나 떠나면 비운다. */
export function useHeaderActions(actions: ReactNode) {
  const setActions = useContext(HeaderActionsContext);
  useFocusEffect(useCallback(() => {
    setActions(actions);
    return () => setActions(null);
  }, [actions, setActions]));
}

/** 화면마다 동일한 진입점을 제공하며 실제 발송 상태와는 독립적으로 동작한다. */
export function AppNavigation({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = enabled && openPath === pathname;
  const [stageWidth, setStageWidth] = useState(0);
  const drawerWidth = Math.min(stageWidth * 0.8, 340);
  const [sheet, setSheet] = useState<'profile' | 'password' | null>(null);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [navigationContext, setNavigationContext] = useState({ pathname, enabled });
  // 인증 단계나 경로가 바뀌어도 화면 트리는 유지하고 메뉴 상태만 정리한다.
  if (navigationContext.pathname !== pathname || navigationContext.enabled !== enabled) {
    setNavigationContext({ pathname, enabled });
    setOpenPath(null);
    setSheet(null);
  }
  const profile = useUserStore((state) => state.profile);
  const profileName = profile?.userName || '내 계정';
  const progress = useSharedValue(0);
  const startProgress = useSharedValue(0);
  const setOpen = useCallback((next: boolean) => setOpenPath(next ? pathname : null), [pathname]);
  // 닫힌 화면의 표 가로 스크롤과 텍스트 선택을 가로채지 않는다.
  const pan = Gesture.Pan()
    .enabled(open && drawerWidth > 0)
    .activeOffsetX([-20, 20])
    .failOffsetY([-12, 12])
    .onBegin(() => { startProgress.value = progress.value; })
    .onUpdate((event) => {
      progress.value = Math.max(0, Math.min(1, startProgress.value + event.translationX / drawerWidth));
    })
    .onEnd((event) => {
      const next = event.velocityX > 500 ? true : event.velocityX < -500 ? false : progress.value > 0.5;
      progress.value = withTiming(next ? 1 : 0, { duration: next ? 400 : 330, easing: Easing.bezier(0.32, 0.08, 0.24, 1), reduceMotion: ReduceMotion.System });
      runOnJS(setOpen)(next);
    });
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: open ? 400 : 330, easing: Easing.bezier(0.32, 0.08, 0.24, 1), reduceMotion: ReduceMotion.System });
    // 공유 값은 렌더 간 동일한 객체다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { setOpen(false); return true; });
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    if (typeof window !== 'undefined') window.addEventListener('keydown', close);
    return () => { back.remove(); if (typeof window !== 'undefined') window.removeEventListener('keydown', close); };
  }, [open, setOpen]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const content = document.getElementById('navigation-content');
    const drawer = document.getElementById('navigation-drawer');
    // 숨겨진 화면의 입력란이나 메뉴가 Tab 이동으로 활성화되지 않게 한다.
    if (content) content.inert = open;
    if (drawer) drawer.inert = !open;
    return () => { if (content) content.inert = false; if (drawer) drawer.inert = false; };
  }, [open]);
  // 메뉴 밖의 화면(발송 상세 등)은 들어온 통로인 첫 항목을 제목으로 쓴다.
  const current = destinations.find((item) => item.href === pathname) ?? destinations[0];
  const homeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * drawerWidth }, { scale: 1 - 0.08 * progress.value }],
    borderRadius: 24 * progress.value,
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.28 }));

  return (
    <>
      <View style={styles.stage} onLayout={(event) => setStageWidth(event.nativeEvent.layout.width)}>
          <SafeAreaView nativeID="navigation-drawer" style={[styles.drawer, { width: drawerWidth }]} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'} aria-hidden={!open} pointerEvents={open ? 'auto' : 'none'}>
            <View style={styles.drawerHeader}>
              <View style={styles.drawerHeading}>
                <Image source={require('../../assets/images/logo.png')} accessibilityLabel="Nature" contentFit="contain" style={styles.brand} />
              </View>
            </View>
            <ScrollView contentContainerStyle={styles.items}>
              {destinations.map((item) => {
                const selected = pathname === item.href;
                return <Link key={item.href} href={item.href} asChild>
                  <Pressable accessibilityRole="link" accessibilityLabel={item.label} accessibilityState={{ selected }} aria-current={selected ? 'page' : undefined} onPress={() => setOpen(false)} style={StyleSheet.flatten([styles.item, selected && styles.selected])}>
                    <MenuIcon kind={item.icon} />
                    <Text style={[styles.itemLabel, selected && styles.selectedLabel]}>{item.label}</Text>
                  </Pressable>
                </Link>;
              })}
            </ScrollView>
            <View style={styles.profileFooter}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${profileName} 프로필`} onPress={() => { setSheet('profile'); }} style={styles.profileButton}>
                <View style={styles.avatar}><MenuIcon kind="profile" /></View>
                <View style={{ flex: 1, gap: spacing.xs }}><Text style={styles.itemLabel}>{profileName}</Text><Text style={styles.caption}>프로필 보기</Text></View>
              </Pressable>
            </View>
          </SafeAreaView>
        <GestureDetector gesture={pan}>
          <Animated.View testID="navigation-main" style={[styles.main, homeStyle]}>
            <View nativeID="navigation-content" style={styles.content} pointerEvents={open ? 'none' : 'auto'} accessibilityElementsHidden={open} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'} aria-hidden={open}>
              {enabled ? <SafeAreaView edges={['top', 'left', 'right']} style={styles.headerSafe}>
                <View style={styles.header}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="메뉴 열기"
                    accessibilityState={{ expanded: open }}
                    aria-expanded={open}
                    onPress={() => setOpen(true)}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                  >
                    <View accessible={false} style={styles.hamburger}>
                      <View style={styles.line} />
                      <View style={styles.line} />
                      <View style={styles.line} />
                    </View>
                  </Pressable>
                  <Text accessibilityRole="header" numberOfLines={1} style={styles.current}>{current.label}</Text>
                  {headerActions ? <View style={styles.headerActions}>{headerActions}</View> : <View style={styles.iconButton} />}
                </View>
              </SafeAreaView> : null}
              <HeaderActionsContext.Provider value={setHeaderActions}>{children}</HeaderActionsContext.Provider>
            </View>
            <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, styles.dim, dimStyle]}>
              {open ? <Pressable accessibilityRole="button" accessibilityLabel="메뉴 닫기" onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} /> : null}
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>
      {enabled && sheet === 'profile' ? <ProfileSheet onClose={() => setSheet(null)} onPassword={() => setSheet('password')} /> : null}
      {enabled && sheet === 'password' ? <PasswordChangeSheet onClose={() => setSheet('profile')} /> : null}
    </>
  );
}

function MenuIcon({ kind }: { kind: 'message' | 'reserved' | 'profile' }) {
  return <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={colors.greenText} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" aria-hidden={true}>
    {kind === 'profile' ? <><Circle cx={12} cy={8} r={3.5} /><Path d="M5 21v-2a7 7 0 0 1 14 0v2" /></> : null}
    {kind === 'message' ? <Path d="M4 4h16v12H9l-5 4V4Zm4 4h8M8 12h5" /> : null}
    {/* 달력 + 체크: 아직 보내지 않고 담아 둔 문자 */}
    {kind === 'reserved' ? <><Rect x={3} y={5} width={18} height={16} rx={2.5} /><Path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4" /></> : null}
  </Svg>;
}

const styles = StyleSheet.create({
  stage: { flex: 1, overflow: 'hidden', backgroundColor: colors.card },
  main: { flex: 1, overflow: 'hidden', backgroundColor: colors.bg },
  content: { flex: 1 },
  dim: { backgroundColor: colors.ink },
  headerSafe: { backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.borderPill },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  iconButton: { width: 48, height: 48, borderRadius: radii.button, alignItems: 'center', justifyContent: 'center' },
  hamburger: { gap: 5 },
  line: { width: 22, height: 2, borderRadius: radii.hair, backgroundColor: colors.ink },
  brand: { width: '50%', aspectRatio: 3 },
  current: { ...fonts.bodyBold, fontSize: text.h1, color: colors.ink, flex: 1, textAlign: 'center' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.card, borderRightWidth: 1, borderRightColor: colors.borderPill },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  drawerHeading: { flex: 1, gap: spacing.xs },
  caption: { ...fonts.body, fontSize: text.md, color: colors.mid },
  profileFooter: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderPill },
  profileButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.sageRow, alignItems: 'center', justifyContent: 'center' },
  items: { padding: spacing.lg, gap: spacing.sm },
  item: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.button },
  itemLabel: { ...fonts.bodyMedium, fontSize: text.xl, color: colors.ink, flex: 1 },
  selected: { backgroundColor: colors.sageRow },
  selectedLabel: { ...fonts.bodyBold, color: colors.greenText },
  pressed: { backgroundColor: colors.inkFill },
});
