import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ENV } from '@/config/env';
import { APP_VERSION } from '@/constants/app-meta';
import { colors, fonts, layout, radii, spacing, text } from '@/constants/theme';

/**
 * 홈 — **자리를 잡아 두는 화면이다.**
 *
 * 아직 기능이 없으므로 지금 보여 줄 값어치가 있는 것은 「어떤 빌드가 어느 서버를 보고 있는가」
 * 뿐이다. 그 셋(앱 버전 · 환경 이름 · API 주소)은 고장 신고를 받을 때 **가장 먼저 묻게 되는
 * 것들**이라, 화면에 적어 두면 사용자가 스크린샷 한 장으로 답해 준다.
 *
 * 📌 이 파일은 **토큰을 쓰는 본보기**이기도 하다. 색·글꼴·크기·여백·둥글기를 한 군데도
 * 직접 적지 않았다 — 앞으로 만드는 화면도 그래야 한다(→ `constants/theme.ts` 머리말).
 */
export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.content}>
        <Text style={styles.kicker}>JAYEON</Text>
        <Text style={styles.title}>자연</Text>
        <Text style={styles.subtitle}>화면은 아직 준비 중이에요.</Text>

        <View style={styles.card}>
          <Row label="버전" value={APP_VERSION || '—'} />
          <Row label="환경" value={ENV.name} />
          <Row label="API" value={ENV.apiUrl} />
        </View>
      </View>
    </SafeAreaView>
  );
}

/** 라벨 + 값 한 줄. 값은 주소처럼 길어질 수 있어 남는 자리를 전부 준다. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    // 넓은 브라우저 창에서 한 줄이 지나치게 길어지지 않게 한다.
    maxWidth: layout.maxContentWidth,
    paddingHorizontal: spacing.xxl,
  },
  kicker: {
    ...fonts.mono,
    fontSize: text.sm,
    letterSpacing: 2,
    color: colors.muted,
  },
  title: {
    marginTop: spacing.xs,
    ...fonts.bodyBold,
    fontSize: text.display,
    color: colors.ink,
  },
  subtitle: {
    marginTop: spacing.sm,
    ...fonts.body,
    fontSize: text.md,
    lineHeight: 20,
    color: colors.mid,
  },
  card: {
    marginTop: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowLabel: {
    ...fonts.bodySemi,
    fontSize: text.base,
    color: colors.muted,
    width: 48,
  },
  rowValue: {
    flex: 1,
    ...fonts.mono,
    fontSize: text.base,
    lineHeight: 18,
    color: colors.ink,
  },
});
