import { Link, usePathname } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileSheet, PasswordChangeSheet } from '@/components/profile-sheet';
import { useUserStore } from '@/store/user-store';
import { colors, fonts, radii, spacing, text } from '@/constants/theme';

const destination = { href: '/sms/new', label: '문자 보내기' } as const;

/** 화면마다 동일한 진입점을 제공하며 실제 발송 상태와는 독립적으로 동작한다. */
export function AppNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<'profile' | 'password' | null>(null);
  const profile = useUserStore((state) => state.profile);
  const profileName = profile?.userName || '내 계정';
  // 웹 Modal의 등장 애니메이션 중에도 Escape로 즉시 닫을 수 있게 한다.
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  const selected = pathname === destination.href;

  return (
    <>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.headerSafe}>
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
          <Text accessibilityRole="header" numberOfLines={1} style={styles.current}>{destination.label}</Text>
          <View style={styles.iconButton} />
        </View>
      </SafeAreaView>
      {open ? <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="메뉴 바깥 영역 닫기"
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <SafeAreaView style={styles.drawer} accessibilityViewIsModal>
            <View style={styles.drawerHeader}>
              <View style={styles.drawerHeading}>
                <Image source={require('../../assets/images/logo.png')} accessibilityLabel="Nature" contentFit="contain" style={styles.brand} />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="닫기"
                onPress={() => setOpen(false)}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <Text accessible={false} style={styles.close}>닫기</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.items}>
              <Link href={destination.href} asChild>
                <Pressable accessibilityRole="link" accessibilityLabel={destination.label} accessibilityState={{ selected }} aria-current={selected ? 'page' : undefined} onPress={() => setOpen(false)} style={StyleSheet.flatten([styles.item, selected && styles.selected])}>
                  <Text style={[styles.itemLabel, selected && styles.selectedLabel]}>{destination.label}</Text>
                </Pressable>
              </Link>
            </ScrollView>
            <View style={styles.profileFooter}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${profileName} 프로필`} onPress={() => { setOpen(false); setSheet('profile'); }} style={styles.profileButton}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{Array.from(profileName)[0]}</Text></View>
                <View style={{ flex: 1, gap: spacing.xs }}><Text style={styles.itemLabel}>{profileName}</Text><Text style={styles.caption}>프로필 보기</Text></View>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal> : null}
      {sheet === 'profile' ? <ProfileSheet onClose={() => setSheet(null)} onPassword={() => setSheet('password')} /> : null}
      {sheet === 'password' ? <PasswordChangeSheet onClose={() => setSheet('profile')} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  headerSafe: { backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.borderPill },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  iconButton: { width: 48, height: 48, borderRadius: radii.button, alignItems: 'center', justifyContent: 'center' },
  hamburger: { gap: 5 },
  line: { width: 22, height: 2, borderRadius: radii.hair, backgroundColor: colors.ink },
  brand: { width: '100%', aspectRatio: 3 },
  current: { ...fonts.bodyBold, fontSize: text.h1, color: colors.ink, flex: 1, textAlign: 'center' },
  overlay: { flex: 1 },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.ink, opacity: 0.4 },
  drawer: { flex: 1, width: 320, maxWidth: '85%', backgroundColor: colors.card, borderRightWidth: 1, borderRightColor: colors.borderPill },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  drawerHeading: { flex: 1, gap: spacing.xs },
  caption: { ...fonts.body, fontSize: text.md, color: colors.mid },
  close: { ...fonts.body, fontSize: text.md, color: colors.ink },
  profileFooter: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderPill },
  profileButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.sageRow, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...fonts.bodyBold, color: colors.greenText, fontSize: text.title },
  items: { padding: spacing.lg, gap: spacing.sm },
  item: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.button },
  itemLabel: { ...fonts.bodyMedium, fontSize: text.xl, color: colors.ink, flex: 1 },
  selected: { backgroundColor: colors.sageRow },
  selectedLabel: { ...fonts.bodyBold, color: colors.greenText },
  pressed: { backgroundColor: colors.inkFill },
});
