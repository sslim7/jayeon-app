import { useMemo } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { useScreenHeader } from '@/components/app-navigation';
import { SmsPage, s } from '@/components/sms-ui';
import { APP_VERSION } from '@/constants/app-meta';
import { colors, fonts, radii, spacing, text } from '@/constants/theme';
import { nativeShellVersion } from '@/lib/native-bridge';

/**
 * 설정 — 서랍 발치의 톱니가 여는 화면.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **시트가 아니라 라우트다.** 앞으로 여기에 들어올 것들(약관·개인정보·기기 관리)은    │
 * │ 저마다 다시 한 겹을 더 여는 것들이라, 시트 위에 시트를 쌓으면 닫는 길이 층마다 갈린다.  │
 * │ 화면을 갈아 두면 나가는 길이 「뒤로」 하나(버튼·안드로이드 하드웨어·브라우저)로 모인다. │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * 형제 앱의 같은 자리(`birdieup-app/src/components/app-settings-sheet.tsx`)에서 **짜임만**
 * 가져왔다 — 섹션 제목 + 카드 한 덩이, 줄은 「아이콘 + 이름(왼쪽) · 값(오른쪽)」. 색과 간격은
 * 이 저장소의 토큰(`constants/theme.ts`)이다. 그쪽 값을 그대로 옮기면 디자인이 확정되는 날
 * 이 화면만 빠진다.
 *
 * 🔴 **약관·개인정보 처리방침은 아직 넣지 않는다.** 문서가 없어서다. 빈 곳으로 가는 줄을
 * 미리 세워 두면 눌렀을 때 **고장으로 읽힌다** — 문서가 생기는 날 「정보」 섹션에 더한다.
 */
export default function SettingsScreen() {
  /**
   * 🔴 **제목과 뒤로 가기는 본문이 아니라 앱 헤더에 선다**(→ `components/app-navigation.tsx`).
   * 아무것도 하지 않으면 이 화면 위에도 「☰ + 문자 보내기」가 남는다 — 경로가 메뉴 항목과
   * 맞지 않아 **메뉴의 첫 항목 이름이 그냥 찍히기 때문**이다.
   *
   * 🔴 **돌아갈 기록이 있으면 반드시 `back()` 이다.** 설정은 어느 화면에서든 서랍을 열어
   * 들어오므로, `replace` 로 목적지를 못 박으면 문자 보내기에서 들어온 사람도 통화분석에서
   * 들어온 사람도 같은 곳에 떨어진다 — 그 사람이 쌓아 둔 스크롤과 선택이 함께 사라진다.
   * 기록이 없는 경우(주소로 바로 열기·새로고침)에만 첫 화면을 연다.
   *
   * ⚠️ `useMemo` 는 멋이 아니다 — 매 렌더 새 객체를 넘기면 헤더가 매번 다시 올라간다.
   */
  useScreenHeader(useMemo(() => ({
    title: '설정',
    onBack: () => (router.canGoBack() ? router.back() : router.replace('/sms/new')),
  }), []));
  /**
   * 껍데기(네이티브 앱) 버전. 껍데기 밖이면 `null` 이다(→ `lib/native-bridge`).
   *
   * 🔴 **웹 버전과 껍데기 버전은 서로 다를 수 있다.** 웹은 배포하면 즉시 새것이 되지만
   * 껍데기는 스토어를 거치므로, 「옛 껍데기가 새 웹을 연다」가 **정상적으로 존재하는 조합**
   * 이다. 문의를 받을 때 「어느 버전 쓰세요?」에 답할 수 있어야 하는 것이 이 줄의 존재
   * 이유라, 둘이 갈렸으면 한쪽만 보여 주면 안 된다.
   *
   * ⚠️ 렌더 중에 읽는다. 껍데기는 이 값을 **페이지 로드 전에** 주입하므로 첫 렌더부터
   * 참이고, 효과로 미루면 한 줄이던 자리가 두 줄로 벌어지는 것이 눈에 보인다
   * (그 패턴은 `react-hooks/set-state-in-effect` 에도 걸린다).
   */
  const shellVersion = nativeShellVersion();
  const split = !!shellVersion && shellVersion !== APP_VERSION;
  return (
    // `hideTitle` — 제목은 위 헤더가 이미 말한다. 본문에 또 세우면 같은 말이 두 줄로 선다.
    <SmsPage title="설정" hideTitle>
      <Section title="계정">
        {/*
          🔴 **폰을 잃어버린 사람이 찾아 들어오는 줄이다.** 여기 있던 「준비 중」 배지와 안내
          한 줄은 서버가 나오면서 걷었다 — 이제 진짜 화면으로 이어진다(→ `app/devices.tsx`).

          🔴 **가짜 기기 목록을 그리지 마라.** 있지도 않은 기기가 뜨면 사용자는 그것을 믿고
          판단한다. 목록은 서버가 주는 것만 그린다.
        */}
        <Row icon="device" label="로그인 기기 관리" onPress={() => router.push('/devices')} />
      </Section>

      <Section title="정보">
        {/*
          버전은 **값으로 보여 주고 끝난다.** 눌러 들어갈 상세가 없어서다 — 이 줄이 하는 일은
          「지금 무엇을 쓰고 있는지」 하나이고, 그건 오른쪽 한 칸이면 족하다.

          ⚠️ **평소에는 한 줄이다.** 웹과 껍데기가 같은 버전인데도 두 줄을 세우면 사용자가
          올 때마다 「뭐가 둘이지」를 읽어야 한다. 갈렸을 때만 이름을 바꿔(앱 버전 → 화면
          버전) 두 줄로 벌리고, 왜 둘인지를 아래 한 줄이 설명한다.
        */}
        <Row icon="version" label={split ? '화면 버전' : '앱 버전'} value={versionText(APP_VERSION)} />
        {split ? <Row icon="phone" label="설치된 앱 버전" value={versionText(shellVersion)} /> : null}
        {split ? <Note>화면은 새로 고치면 바로 바뀌고, 설치된 앱은 스토어 업데이트를 거쳐요. 문의하실 때 두 값을 함께 알려 주세요.</Note> : null}
      </Section>

      {/*
        만든 곳 한 줄. 카드 **밖**·가운데·흐린 글씨다 — 읽을 것이 아니라 여기가 끝이라는 표시라서,
        카드 안에 들이면 설정 항목 하나처럼 읽힌다. 형제 앱과 같은 문안을 쓴다
        (→ `birdieup-app/src/components/brand-footer.tsx`).
      */}
      <Text selectable style={styles.brand}>© {COPYRIGHT_YEARS} REDHEAD — Open by Nature.</Text>
    </SmsPage>
  );
}

/** 서비스를 시작한 해. 저작권 표기의 앞쪽은 여기서 멈춰 있어야 한다. */
const FOUNDED_YEAR = 2026;
/**
 * 시작한 해 그대로면 한 해만, 해가 넘어갔으면 범위로.
 *
 * 🔴 **연도를 손으로 박지 마라.** 박아 두면 해가 바뀌는 날 이 줄이 조용히 거짓이 되는데,
 * 아무것도 깨지지 않으므로 아무도 알아채지 못한다. 형제 앱도 같은 방식이다.
 */
const COPYRIGHT_YEARS = new Date().getFullYear() > FOUNDED_YEAR
  ? `${FOUNDED_YEAR}-${new Date().getFullYear()}`
  : `${FOUNDED_YEAR}`;

/**
 * 버전 한 값의 표기.
 *
 * ⚠️ `APP_VERSION` 은 **빈 문자열일 수 있다**(`expo-config` 를 못 읽은 경우 →
 * `constants/app-meta.ts`). 그대로 쓰면 화면에 `v` 한 글자만 남아 고장으로 읽히므로,
 * 모르면 모른다고 적는다.
 */
function versionText(version: string | null): string {
  return version ? `v${version}` : '알 수 없음';
}

/** 섹션 한 덩이 — 제목 + 카드. 성격이 다른 줄은 같은 카드에 담지 않는다. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <View style={[s.card, styles.card]}>{children}</View>
    </View>
  );
}

/**
 * 설정 한 줄 — 아이콘 + 이름(왼쪽), 값(오른쪽 끝).
 *
 * ⚠️ **화살표(›)는 갈 곳이 있는 줄에만 단다.** 값만 보여 주고 끝나는 줄에 화살표가 있으면
 * 눌러 보게 되고, 눌러도 움직이지 않으면 고장으로 읽힌다. 반대로 **갈 곳이 있는데 화살표가
 * 없으면 아무도 누르지 않는다** — 그래서 `onPress` 가 있는 줄에만 자동으로 선다.
 * 🔴 두 값을 따로 받지 않는 것이 요점이다. 갈래를 손으로 맞추게 두면 언젠가 한쪽만 바뀐다.
 */
function Row({ icon, label, value, badge, onPress }: { icon: RowIcon; label: string; value?: string; badge?: string; onPress?: () => void }) {
  const body = <>
    <RowIconGlyph kind={icon} />
    <Text style={styles.rowLabel}>{label}</Text>
    {/*
      ⚠️ **값은 모노, 상태는 본문 폰트다.** 값(버전)은 숫자라 모노가 자리를 고르게 잡아 주지만,
      모노에 한글을 넣으면 폰트가 없어 폴백으로 떨어지면서 「준비  중」처럼 자간이 벌어진다.
    */}
    {value ? <Text selectable style={styles.rowValue}>{value}</Text> : null}
    {badge ? <Text style={styles.rowBadge}>{badge}</Text> : null}
    {onPress ? <Chevron /> : null}
  </>;
  if (!onPress) return <View style={styles.row}>{body}</View>;
  // 이름이 곧 낭독기가 읽을 이름이다 — 아이콘과 화살표는 접근성 트리에서 이미 빠져 있다.
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.row}>{body}</Pressable>;
}

/**
 * 갈 곳이 있는 줄의 오른쪽 끝에 서는 홑화살표.
 *
 * 🔴 **이모지(›·〉)를 쓰지 않는다** — 기기마다 글리프가 달라 같은 줄이 사람마다 다르게 보인다.
 * 앱의 다른 화살표와 같은 규격이다(→ `app/calls/index.tsx` 의 `Chevron`).
 */
function Chevron() {
  return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.mid} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden={true}>
    <Path d="M9 6l6 6-6 6" />
  </Svg>;
}

/** 줄 아래에 붙는 설명. 「준비 중」처럼 그 자체로는 뜻이 반쯤인 값의 나머지 반이다. */
function Note({ children }: { children: React.ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

type RowIcon = 'device' | 'phone' | 'version';

/**
 * 줄 아이콘. **이모지를 쓰지 않는다** — 기기·OS 마다 그림이 제각각이라 같은 줄이 사람마다
 * 다르게 보인다. 서랍의 `MenuIcon`(→ `components/app-navigation.tsx`)과 같은 규격이다:
 * 24×24, 외곽선, 초록 글자색.
 */
function RowIconGlyph({ kind }: { kind: RowIcon }) {
  return <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.greenText} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" aria-hidden={true}>
    {/*
      노트북: 「로그인한 기기」.
      ⚠️ 22px 에서는 **한 물건만 그린다.** 노트북과 폰을 한 칸에 넣어 봤더니 폰이 뭉개져
      숫자 0 처럼 읽혔다 — 작은 아이콘은 형태가 단순해야 뜻이 남는다.
    */}
    {kind === 'device' ? <><Rect x={3.5} y={5} width={17} height={11} rx={1.8} /><Path d="M1.5 19h21" /></> : null}
    {/* 폰: 스토어로 설치한 껍데기 앱 쪽 값 */}
    {kind === 'phone' ? <><Rect x={6.5} y={2.5} width={11} height={19} rx={2.5} /><Path d="M10.5 18.5h3" /></> : null}
    {/* 반짝임: 「지금 쓰고 있는 것」. 형제 앱 설정의 버전 줄과 같은 그림이다 */}
    {kind === 'version' ? <><Path d="M10.5 3.5l1.6 4.1 4.1 1.6-4.1 1.6-1.6 4.1-1.6-4.1L4.8 9.2l4.1-1.6z" /><Path d="M17.5 14.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" /></> : null}
  </Svg>;
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  sectionTitle: { ...fonts.bodySemi, fontSize: text.md, color: colors.mid },
  /** 카드 기본값(`s.card`)보다 촘촘하다 — 줄 자체가 이미 높이(52)를 들고 있다. */
  card: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.xs },
  rowLabel: { ...fonts.bodyMedium, fontSize: text.xl, color: colors.ink, flex: 1 },
  /** 값은 오른쪽 끝. 눌러 복사할 수 있어야 문의할 때 그대로 옮겨 적는다. */
  rowValue: { ...fonts.mono, fontSize: text.lg, color: colors.mid },
  /** 「준비 중」처럼 값이 아니라 **상태**인 것. 알약 모양이라 버전 값과 한눈에 갈린다 */
  rowBadge: { ...fonts.bodySemi, fontSize: text.md, color: colors.mid, backgroundColor: colors.inkFill, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, overflow: 'hidden' },
  note: { ...fonts.body, fontSize: text.md, color: colors.mid, lineHeight: 20, paddingHorizontal: spacing.xs },
  /**
   * ⚠️ 색은 `colors.mid` 다. 더 흐린 `inactive`·`muted` 로 두면 보기에는 알맞지만 종이 바탕
   * 대비가 2점대라 **본문 기준(4.5:1)에 못 미친다** — 12px 글자라 큰 글자 예외도 못 받는다
   * (→ `constants/theme.ts` 의 대비 실측값). 흐리게 보이는 몫은 크기와 자리가 이미 한다.
   */
  brand: { ...fonts.body, fontSize: text.base, color: colors.mid, textAlign: 'center', marginTop: spacing.sm },
});
