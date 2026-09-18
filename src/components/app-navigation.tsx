import { Link, useFocusEffect, usePathname } from 'expo-router';
import { Image } from 'expo-image';
import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileSheet, PasswordChangeSheet } from '@/components/profile-sheet';
import { useUserStore } from '@/store/user-store';
import { colors, fonts, radii, spacing, text } from '@/constants/theme';
// 🔧 측정용(→ `components/asr-bench.tsx`). 끝나면 이 import 와 아래 갈래를 함께 지운다.
import { isNativeShell, openNativeScreen } from '@/lib/native-bridge';

type MenuIconKind = 'message' | 'reserved' | 'profile' | 'calls' | 'bench' | 'settings';
type Destination = { href: '/sms/new' | '/sms/reserved' | '/calls' | '/asr-bench'; label: string; icon: MenuIconKind };

/**
 * ⚠️ **「받아쓰기 시험」은 임시 항목이다.** 폰에서 whisper 가 얼마나 걸리는지만 재는 화면이고
 * (→ `components/asr-bench.tsx`), 측정이 끝나면 화면과 함께 이 줄도 지운다.
 *
 * 🔴 **웹에는 넣지 않는다.** 웹에서는 받아쓰기를 돌릴 수 없어 열어 봐야 「폰에서 하세요」
 * 한 줄뿐인데, 그 죽은 메뉴는 로그인 이후 화면이 전부 웹인 이 앱의 주 무대에 남는다.
 */
const destinations: readonly Destination[] = [
  { href: '/sms/new', label: '문자 보내기', icon: 'message' },
  { href: '/sms/reserved', label: '예약 문자 보내기', icon: 'reserved' },
  { href: '/calls', label: '통화분석', icon: 'calls' },
  // 🔧 **웹에서도 보여야 한다.** 로그인 이후 화면은 전부 웹이라 사용자가 보는 ☰ 는 웹이
  // 그린 것이고, 네이티브 메뉴는 화면에 나타나지 않는다. 대신 누르면 껍데기에게 네이티브
  // 화면을 열어 달라고 말한다(→ `lib/native-bridge.web.ts` 의 openNativeScreen).
  // 브라우저에서는 열 껍데기가 없으므로 아래 렌더에서 항목 자체를 걷는다.
  { href: '/asr-bench', label: '받아쓰기 시험', icon: 'bench' } as Destination,
];

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

/**
 * 헤더를 **화면 것으로 갈아 끼울 때** 주는 값. 제목과 뒤로 가는 길이 함께 온다.
 *
 * 🔴 둘을 한 값으로 묶은 것이 의도다. 「☰ + 메뉴 이름」은 **메뉴가 세운 화면**의 머리이고,
 * 「← 뒤로 + 문서 이름」은 **그 위에 쌓인 화면**의 머리다. 한쪽만 갈면 통화 보고서에서
 * ☰ 와 「현정 상담 분석」이 같이 서는데, 그 조합은 여기가 메뉴 항목이라고 거짓말한다.
 */
type ScreenHeader = { title: string; onBack: () => void };
const ScreenHeaderContext = createContext<Dispatch<SetStateAction<ScreenHeader | null>>>(() => {});

/**
 * 이 화면이 떠 있는 동안 헤더를 「← 뒤로 + 제목」으로 바꾼다. `null` 이면 앱 공통 헤더다.
 *
 * ⚠️ **`header` 를 `useMemo` 로 고정해서 넘겨라.** 렌더마다 새 객체를 만들면 아래 효과가
 * 매 렌더 다시 돌아 헤더가 깜빡인다(→ `useHeaderActions` 와 같은 규칙).
 *
 * 🔴 **치울 때 내 것인지 확인하고 치운다.** 화면이 전환될 때 새 화면의 포커스 효과와 떠나는
 * 화면의 정리가 어느 쪽이 먼저인지는 보장되지 않는다 — 조건 없이 `null` 을 넣으면 방금
 * 올라온 화면의 헤더를 떠나는 화면이 지우고, 그러면 **뒤로 가기가 통째로 사라진다.**
 */
export function useScreenHeader(header: ScreenHeader | null) {
  const setHeader = useContext(ScreenHeaderContext);
  useFocusEffect(useCallback(() => {
    setHeader(header);
    return () => setHeader((current) => (current === header ? null : current));
  }, [header, setHeader]));
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
  /** 화면이 갈아 끼운 헤더. 비어 있으면 아래 `current` 가 메뉴 이름을 세운다. */
  const [screenHeader, setScreenHeader] = useState<ScreenHeader | null>(null);
  const [navigationContext, setNavigationContext] = useState({ pathname, enabled });
  // 인증 단계나 경로가 바뀌어도 화면 트리는 유지하고 메뉴 상태만 정리한다.
  if (navigationContext.pathname !== pathname || navigationContext.enabled !== enabled) {
    setNavigationContext({ pathname, enabled });
    setOpenPath(null);
    setSheet(null);
  }
  const profile = useUserStore((state) => state.profile);
  const profileName = profile?.userName || '내 계정';
  /**
   * 원 안에 세우는 첫 글자. 이름을 아직 못 받았으면 사람 아이콘으로 떨어진다 —
   * 「내 계정」의 '내' 를 크게 세워 봐야 알려 주는 것이 없고, 진짜 이름처럼 읽힌다.
   */
  const profileInitial = profile?.userName?.trim().charAt(0).toUpperCase() ?? '';
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
                const body = <>
                  <MenuIcon kind={item.icon} />
                  <Text style={[styles.itemLabel, selected && styles.selectedLabel]}>{item.label}</Text>
                </>;
                // 🔧 측정용 갈래(→ `components/asr-bench.tsx`). 끝나면 이 블록을 통째로 지운다.
                //
                // 받아쓰기 화면은 네이티브 모듈을 쓰므로 웹뷰 안에서 열 수 없다. 웹에서는
                // Link 로 이동시키면 **빈 화면으로 가 버리므로**, 껍데기에게 열어 달라고
                // 말하고 여기서는 이동하지 않는다.
                // 🔴 브라우저(껍데기 없음)에서는 항목 자체를 그리지 않는다 — 눌러도 아무
                // 일도 일어나지 않는 메뉴가 남으면 고장으로 읽힌다.
                if (item.href === '/asr-bench' && Platform.OS === 'web') {
                  if (!isNativeShell()) return null;
                  return <Pressable key={item.href} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => { setOpen(false); openNativeScreen(item.href); }} style={StyleSheet.flatten([styles.item])}>
                    {body}
                  </Pressable>;
                }
                return <Link key={item.href} href={item.href} asChild>
                  <Pressable accessibilityRole="link" accessibilityLabel={item.label} accessibilityState={{ selected }} aria-current={selected ? 'page' : undefined} onPress={() => setOpen(false)} style={StyleSheet.flatten([styles.item, selected && styles.selected])}>
                    {body}
                  </Pressable>
                </Link>;
              })}
            </ScrollView>
            {/*
              서랍 발치의 **두 원** — 왼쪽이 「나」, 오른쪽이 「앱」이다. 형제 앱과 같은 배치이고
              (→ `birdieup-app/src/components/home-drawer.tsx`), 같은 사람이 두 앱을 오가므로
              **자리가 같아야 익숙하다.**

              🔴 **목록의 마지막 줄로 되돌리지 마라.** 전에는 여기가 「아바타 + 이름 + 프로필
              보기」한 줄이었는데, 줄로 세우면 '나'가 문자 보내기·통화분석과 **같은 층에 같은
              무게로** 선다. 위 목록은 갈 곳을 담는 자리이고 이 둘은 그 밖에 있다 — 떼어서
              발치에 띄워 두면 메뉴 항목이 늘어도 이 자리가 밀리지 않는다.

              ⚠️ **원을 셋으로 늘리지 마라.** 둘일 때만 「나 ↔ 앱」이라는 대칭이 자리만으로
              읽힌다. 셋째가 끼는 순간 그냥 아이콘 줄이 되어 무엇이 무엇인지 눌러 봐야 안다.
              설정 안에 들어갈 수 있는 것이면 설정 안에 넣어라(→ `app/settings.tsx`).

              🔴 **아이콘뿐인 버튼이라 낭독기에는 `accessibilityLabel` 이 전부다.** 프로필 쪽
              이름에 사용자 이름을 붙여 두는 것은, 계정을 여럿 쓰는 사람이 **어느 계정으로
              들어와 있는지** 눌러 보지 않고도 알아야 하기 때문이다 — 눈으로는 원 안의 첫
              글자가 같은 몫을 한다.
            */}
            <View style={styles.foot}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${profileName} 프로필`} onPress={() => { setSheet('profile'); }} style={styles.footCircle}>
                {profileInitial ? <Text style={styles.footInitial}>{profileInitial}</Text> : <MenuIcon kind="profile" />}
              </Pressable>
              {/*
                설정은 **화면**이라 메뉴 항목과 같이 `Link` 로 간다 — 웹에서 주소가 생기고
                (새 탭·뒤로 가기가 그대로 동작한다) 낭독기에도 링크로 읽힌다.
                ⚠️ 서랍을 먼저 접는 것도 메뉴 항목과 같은 이유다 — 펴 둔 채 나가면 돌아왔을 때
                그 상태가 그대로 남는다.

                🔴 **`Link asChild` 의 자식에는 `style` 을 함수나 배열로 주지 마라.** 안쪽에서
                라딕스 `Slot` 이 부모와 자식의 style 을 **객체로 펼쳐 합치는데**, 함수를 펼치면
                빈 객체가 되어 **스타일이 통째로 사라진다**(배열은 개발 모드에서 예외를 던지고
                함수는 아무 말 없이 지나간다 → `expo-router/build/ui/Slot.js`). 실제로 여기서
                원이 사라져 톱니만 덩그러니 떠 있었다. 그래서 위 메뉴 항목들도, 이 원도
                `StyleSheet.flatten` 된 **객체 하나**를 넘긴다 — 눌림 표시를 붙이고 싶으면
                그 규칙을 먼저 지킬 방법을 찾아라.
              */}
              <Link href="/settings" asChild>
                <Pressable accessibilityRole="link" accessibilityLabel="설정" onPress={() => setOpen(false)} style={StyleSheet.flatten([styles.footCircle])}>
                  <MenuIcon kind="settings" />
                </Pressable>
              </Link>
            </View>
          </SafeAreaView>
        <GestureDetector gesture={pan}>
          <Animated.View testID="navigation-main" style={[styles.main, homeStyle]}>
            <View nativeID="navigation-content" style={styles.content} pointerEvents={open ? 'none' : 'auto'} accessibilityElementsHidden={open} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'} aria-hidden={open}>
              {enabled ? <SafeAreaView edges={['top', 'left', 'right']} style={styles.headerSafe}>
                <View style={styles.header}>
                  {/*
                    🔴 **☰ 와 「← 뒤로」는 같은 자리를 두고 다툰다 — 둘을 같이 세우지 않는다.**
                    메뉴가 세운 화면(문자 보내기·예약·통화분석 목록)에서는 왼쪽이 ☰ 이고,
                    그 위에 쌓인 화면(통화 보고서)에서는 나가는 길이 **뒤로 하나뿐**이다.
                    그 화면에서 ☰ 를 누르면 메뉴가 열려 밑에 깔린 목록으로 이동해 버리는데,
                    사용자가 기대한 것은 「보던 목록으로 돌아가기」다 — 결과가 비슷해 보여서
                    **쌓아 둔 스크롤과 펼친 줄을 잃었다는 사실만 남는다.**
                  */}
                  {screenHeader ? <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="뒤로"
                    onPress={screenHeader.onBack}
                    style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                  >
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden={true}>
                      <Path d="M15 5l-7 7 7 7" />
                    </Svg>
                    <Text numberOfLines={1} style={styles.backLabel}>뒤로</Text>
                  </Pressable> : <Pressable
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
                  </Pressable>}
                  <Text accessibilityRole="header" numberOfLines={1} style={styles.current}>{screenHeader ? screenHeader.title : current.label}</Text>
                  {/*
                    오른쪽 빈 칸은 **제목을 가운데로 미는 추**다. 왼쪽 버튼과 폭이 같아야 제목이
                    화면 가운데에 서므로, 뒤로 버튼일 때는 그 폭(`backButton`)으로 맞춘다.
                  */}
                  {headerActions ? <View style={styles.headerActions}>{headerActions}</View> : <View style={screenHeader ? styles.backButton : styles.iconButton} />}
                </View>
              </SafeAreaView> : null}
              <ScreenHeaderContext.Provider value={setScreenHeader}>
              <HeaderActionsContext.Provider value={setHeaderActions}>{children}</HeaderActionsContext.Provider>
              </ScreenHeaderContext.Provider>
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

function MenuIcon({ kind }: { kind: MenuIconKind }) {
  return <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={colors.greenText} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" aria-hidden={true}>
    {kind === 'calls' ? <><Rect x={4} y={3} width={16} height={18} rx={2} /><Path d="M8 8h8M8 12h8M8 16h5" /></> : null}
    {kind === 'profile' ? <><Circle cx={12} cy={8} r={3.5} /><Path d="M5 21v-2a7 7 0 0 1 14 0v2" /></> : null}
    {kind === 'message' ? <Path d="M4 4h16v12H9l-5 4V4Zm4 4h8M8 12h5" /> : null}
    {/* 스톱워치: 「얼마나 걸리나」를 재는 임시 화면 */}
    {kind === 'bench' ? <><Circle cx={12} cy={13} r={7.5} /><Path d="M12 9.5V13l2.5 1.5M9.5 2.5h5" /></> : null}
    {/* 톱니: 앱 자신을 다루는 자리. 형제 앱 서랍의 설정 원과 같은 그림이다 */}
    {kind === 'settings' ? <><Circle cx={12} cy={12} r={3} /><Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></> : null}
    {/* 달력 + 체크: 아직 보내지 않고 담아 둔 문자 */}
    {kind === 'reserved' ? <><Rect x={3} y={5} width={18} height={16} rx={2.5} /><Path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4" /></> : null}
  </Svg>;
}

const styles = StyleSheet.create({
  stage: { flex: 1, overflow: 'hidden', backgroundColor: colors.card },
  main: { flex: 1, overflow: 'hidden', backgroundColor: colors.bg },
  content: { flex: 1 },
  dim: { backgroundColor: colors.ink },
  // 헤더가 본문 위에 쌓여야 아이콘 툴팁 말풍선이 본문에 가려지지 않는다.
  headerSafe: { backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.borderPill, zIndex: 3 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  iconButton: { width: 48, height: 48, borderRadius: radii.button, alignItems: 'center', justifyContent: 'center' },
  /**
   * 「← 뒤로」. 폭을 **고정**하는 이유는 맞은편 빈 칸이 같은 값을 써야 제목이 가운데에 서기
   * 때문이다(→ 위 헤더). 화살표만 두지 않는 것은, 이 앱이 웹뷰 안에서도 돌아 화살표 하나가
   * 브라우저 뒤로 가기인지 화면 안의 조작인지 구별되지 않아서다.
   */
  backButton: { width: 76, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radii.button },
  backLabel: { ...fonts.bodySemi, fontSize: text.lg, color: colors.ink },
  hamburger: { gap: 5 },
  line: { width: 22, height: 2, borderRadius: radii.hair, backgroundColor: colors.ink },
  brand: { width: '50%', aspectRatio: 3 },
  current: { ...fonts.bodyBold, fontSize: text.h1, color: colors.ink, flex: 1, textAlign: 'center' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.card, borderRightWidth: 1, borderRightColor: colors.borderPill },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  drawerHeading: { flex: 1, gap: spacing.xs },
  /**
   * 발치의 두 원이 서는 줄.
   *
   * 🔴 **위에 구분선을 긋지 않는다.** 선을 그으면 목록의 마지막 구획으로 보여서, 떼어 놓으려고
   * 원으로 만든 뜻이 도로 사라진다. 여기가 바닥이라는 것은 선이 아니라 **빈 자리**가 말한다.
   * 그림자를 쓰지 않는 코드베이스라 '떠 있음' 은 색이 만든다 — 서랍 바탕(card)보다 한 단
   * 어두운 종이색(bg) 원이라 바탕에서 한 겹 떠 보인다.
   */
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  /**
   * 두 원은 **옷도 지름도 같다.** 값을 따로 두지 않는 것은 의도다 — 상수가 둘이면 한쪽만
   * 바뀌는 날이 오고, 크기가 어긋난 두 원은 한 쌍으로 읽히지 않는다.
   * 지름 52 는 손가락 표적 최소치(44)를 넉넉히 넘긴다.
   */
  footCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.borderPill, alignItems: 'center', justifyContent: 'center' },
  /** 이름의 첫 글자. 아이콘 자리에 서므로 아이콘과 같은 초록이다 */
  footInitial: { ...fonts.bodyBold, fontSize: text.title, color: colors.greenText },
  items: { padding: spacing.lg, gap: spacing.sm },
  item: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.button },
  itemLabel: { ...fonts.bodyMedium, fontSize: text.xl, color: colors.ink, flex: 1 },
  selected: { backgroundColor: colors.sageRow },
  selectedLabel: { ...fonts.bodyBold, color: colors.greenText },
  pressed: { backgroundColor: colors.inkFill },
});
