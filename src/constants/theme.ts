/**
 * 「자연」 디자인 토큰.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이 팔레트는 디자인이 나오기 전의 임시값이다.**                                │
 * │ 디자인이 확정되면 **이 파일 하나만 갈아끼운다.**                                   │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * 그래서 화면 코드에는 색 문자열을 **한 글자도 적지 마라.** `#4A7C59` 가 화면 스무 곳에
 * 흩어지는 순간 위 약속이 거짓이 되고, 디자인이 오는 날 「갈아끼우기」가 아니라 「전수
 * 조사」가 된다. 여기 없는 색이 필요하면 토큰을 여기서 늘려라.
 *
 * 컨셉: 따뜻한 종이 바탕 + 깊은 숲 잉크 + 세이지 그린 강조.
 *
 * 색을 제외한 나머지(크기·둥글기·여백 스케일)는 디자인이 와도 대체로 살아남는 뼈대라
 * 지금 정해 둔다 — 화면마다 숫자를 새로 고르기 시작하면 그 편차는 나중에 되돌릴 수 없다.
 */
import { Platform } from 'react-native';
import type { TextStyle } from 'react-native';

/**
 * 입력 필드 글자 크기의 웹 전용 하한 보정.
 *
 * iOS Safari 는 `font-size` 가 16px 미만인 입력에 포커스가 가면 **페이지를 강제로 확대한다.**
 * 확대된 상태에서는 버튼이 화면 밖으로 밀려나고, 포커스가 풀려도 배율이 원래대로 돌아오지
 * 않는다. 16px 이상이면 확대 자체가 일어나지 않으므로 웹에서만 하한을 올린다.
 *
 * 📌 **이 앱에서는 이게 형제 프로젝트보다 더 중요하다** — 우리는 웹이 주 무대이고,
 * 네이티브 앱조차 인증 뒤에는 그 웹을 웹뷰로 연다. 즉 입력 화면의 대부분이 웹이다.
 *
 * 네이티브에는 이 동작이 없어 디자인 값을 그대로 쓴다.
 */
export const inputFontSize = (size: number): number =>
  Platform.OS === 'web' ? Math.max(size, 16) : size;

/**
 * 색.
 *
 * 대비는 WCAG 2.1 상대휘도로 **`bg`(#F5F2EC) 기준** 실측해 적어 둔다 — 「예뻐 보인다」와
 * 「야외에서 읽힌다」는 다른 문제이고, 나중에 색을 고칠 사람이 무엇을 지켜야 하는지
 * 알아야 한다. 기준선은 본문 4.5:1, 큰 글자(18.66px 굵게 또는 24px) 3:1 이다.
 * **색을 바꾸면 그 줄의 숫자도 다시 재서 고쳐라.** 틀린 숫자는 없는 것보다 나쁘다.
 */
export const colors = {
  /** 앱 배경 — 따뜻한 종이 */
  bg: '#F5F2EC',
  /** 카드의 밝은 면. 배경보다 한 단 희다 */
  card: '#FDFBF7',
  /** 잉크 — 깊은 숲. 본문 글자이자 어두운 면의 배경. `bg` 대비 11.05:1 */
  ink: '#1E3A2F',

  /**
   * 강조 초록(세이지 계열의 짙은 쪽). 버튼 바탕 · 아이콘 · 큰 글자용.
   *
   * ⚠️ **종이 바탕 위의 본문 글자로는 쓰지 마라** — `bg` 대비 4.35:1 로 큰 글자(3:1)는
   * 통과하지만 본문(4.5:1)에는 모자란다. 그 자리에는 아래 `greenText` 가 있다.
   */
  green: '#4A7C59',
  /** 종이 위에 초록 **글자**를 써야 할 때. `green` 을 살짝 눌러 `bg` 대비 4.71:1 을 만든 값 */
  greenText: '#467656',
  /** 연한 세이지 — 강조의 부드러운 쪽. 잉크 면 위의 강조, 하이라이트 바탕 */
  accentSoft: '#A8C09A',
  /** 경고·삭제·음수. `bg` 대비 5.32:1 */
  red: '#B23A2A',
  /** 잉크 면 위에서 쓰는 붉은색. 어두운 바탕에서는 `red` 가 가라앉는다 */
  redLight: '#E39B8C',

  /** 보조 글자(메타·캡션). `bg` 대비 2.65:1 — **본문에 쓰지 마라.** 큰 글자·보조 정보 전용 */
  muted: '#8A9A8F',
  /** 중간톤 — 본문보다 눌러야 하지만 `muted` 로는 흐린 자리. `bg` 대비 6.52:1 */
  mid: '#3F5D4D',
  /** 비활성 아이콘 */
  inactive: '#A6A99E',
  /** 값이 없음을 나타내는 자리표(·) */
  empty: '#C6C1B4',

  /* 테두리 — 전부 잉크의 반투명이다. 회색 선을 따로 두면 종이 바탕에서 차갑게 뜬다 */
  border: 'rgba(30,58,47,0.10)',
  borderStrong: 'rgba(30,58,47,0.14)',
  /** 알약 버튼·헤더 구분선 */
  borderPill: 'rgba(30,58,47,0.18)',
  borderSoft: 'rgba(30,58,47,0.08)',
  borderCard: 'rgba(30,58,47,0.12)',

  /* 잉크 면 **위**에서 쓰는 톤. 종이색의 반투명이다 */
  onInk: '#F5F2EC',
  onInkMuted: 'rgba(245,242,236,0.55)',
  onInkFaint: 'rgba(245,242,236,0.50)',
  onInkSubtle: 'rgba(245,242,236,0.60)',
  onInkBorder: 'rgba(245,242,236,0.25)',
  onInkFill: 'rgba(245,242,236,0.07)',
  onInkFillStrong: 'rgba(245,242,236,0.18)',

  /* 반투명 채움(칩·배지 바탕). 불투명 색으로 두면 카드 위와 배경 위에서 다르게 보인다 */
  inkFill: 'rgba(30,58,47,0.10)',
  inkFillSoft: 'rgba(30,58,47,0.07)',
  greenFill: 'rgba(74,124,89,0.14)',
  /** 현재 항목 하이라이트 */
  sageRow: 'rgba(168,192,154,0.22)',
} as const;

/* ------------------------------------------------------------------ */
/* 폰트                                                                */
/* ------------------------------------------------------------------ */

/**
 * 폰트 토큰 하나. `style={[styles.x, fonts.bodyBold]}` 나 `{ ...fonts.bodyBold }` 로 쓴다.
 *
 * 📌 **형제 프로젝트는 이 자리에 문자열(fontFamily) 하나만 뒀는데, 우리는 객체다.**
 * 이유는 웹 폰트를 받아 오는 방식이 다르기 때문이다:
 *
 * - 네이티브는 `@expo-google-fonts` 의 TTF 를 올리므로 **굵기마다 패밀리 이름이 따로**
 *   있다(`IBMPlexSansKR_700Bold`). fontFamily 하나로 굵기가 정해진다.
 * - 웹은 `+html.tsx` 가 Google Fonts CDN 을 `<link>` 로 건다. CDN 이 등록하는 패밀리는
 *   굵기와 무관한 **하나의 이름**(`IBM Plex Sans KR`)이고, 굵기는 `font-weight` 로 고른다.
 *   즉 웹에서는 fontFamily 만으로 굵기를 말할 방법이 **없다.**
 *
 * 그래서 토큰이 `{ fontFamily, fontWeight }` 를 함께 들고, 양쪽이 이 상수 하나만 본다.
 * 🔴 **화면에서 `fontWeight` 를 따로 지정하지 마라** — 네이티브에서는 굵기가 이미 패밀리에
 * 들어 있어서, 따로 적으면 웹만 바뀌고 네이티브는 그대로인 **한쪽만 어긋난 상태**가 된다.
 * 그런 어긋남은 타입도 화면도 깨뜨리지 않아서 눈치채기 어렵다.
 */
export type FontToken = Readonly<{ fontFamily: string; fontWeight?: TextStyle['fontWeight'] }>;

const isWeb = Platform.OS === 'web';

/**
 * 네이티브 패밀리 이름과 웹 패밀리 + 굵기를 짝지어 토큰을 만든다.
 *
 * 네이티브에서 `fontWeight` 를 **일부러 비운다.** 굵기별 TTF 를 이미 올려 두었는데 굵기를
 * 또 지정하면 안드로이드가 그 위에 합성 볼드를 얹어 글자가 뭉개질 수 있다.
 */
const font = (
  nativeFamily: string,
  webFamily: string,
  weight: TextStyle['fontWeight'],
): FontToken =>
  isWeb ? { fontFamily: webFamily, fontWeight: weight } : { fontFamily: nativeFamily };

/** 웹에서 쓰는 CDN 패밀리 이름. `+html.tsx` 의 `<link>` 가 등록하는 이름과 **1:1 이어야 한다.** */
const WEB_KR = 'IBM Plex Sans KR';
const WEB_MONO = 'IBM Plex Mono';
const WEB_DISPLAY = 'Archivo';

/**
 * 폰트 토큰.
 *
 * 네이티브 쪽 키는 `hooks/use-app-fonts.ts` 의 `useFonts` 키와, 웹 쪽 패밀리는 `+html.tsx`
 * 가 거는 CDN 링크와 **각각 1:1 로 맞아야 한다.** 이름이 어긋나면 폰트가 조용히 시스템
 * 기본값으로 떨어진다 — 오류도 경고도 없이 글꼴만 달라지는 고장이라 한참 뒤에 발견된다.
 *
 * 💡 **한글 폰트는 무겁다.** 지금은 CDN 이 `unicode-range` 로 조각내 주는 것에 기대고
 * 있는데, 첫 화면이 눈에 띄게 늦어지기 시작하면 폰트를 직접 서브셋해 self-host 하는 길이
 * 있다. 그 파이프라인을 실제로 만들어 둔 곳이 있으니 처음부터 설계하지 마라 —
 * 근거와 구현 모두 `birdieup-app/scripts/build-web-fonts.py` 에 있다(상용 한글 2,350자를
 * 본 패밀리에 담고 나머지는 폴백 패밀리로 빼는 방식).
 */
export const fonts = {
  /** Archivo — 헤드라인(숫자·영문 위주) */
  display: font('Archivo_800ExtraBold', WEB_DISPLAY, '800'),
  displayBold: font('Archivo_700Bold', WEB_DISPLAY, '700'),
  displayRegular: font('Archivo_400Regular', WEB_DISPLAY, '400'),

  /** IBM Plex Sans KR — 본문 */
  body: font('IBMPlexSansKR_400Regular', WEB_KR, '400'),
  bodyMedium: font('IBMPlexSansKR_500Medium', WEB_KR, '500'),
  bodySemi: font('IBMPlexSansKR_600SemiBold', WEB_KR, '600'),
  bodyBold: font('IBMPlexSansKR_700Bold', WEB_KR, '700'),

  /** IBM Plex Mono — 숫자·라벨 */
  mono: font('IBMPlexMono_500Medium', WEB_MONO, '500'),
  monoSemi: font('IBMPlexMono_600SemiBold', WEB_MONO, '600'),
  monoBold: font('IBMPlexMono_700Bold', WEB_MONO, '700'),
} as const;

/* ------------------------------------------------------------------ */
/* 치수                                                                */
/* ------------------------------------------------------------------ */

/**
 * 글자 크기 스케일.
 *
 * **새 코드는 여기 없는 크기를 쓰지 마라.** 화면마다 숫자를 새로 고르면 11.5 / 12.5 / 14.5
 * 처럼 눈에 보이지도 않는 편차가 수십 종 쌓이는데, 그건 의도가 아니라 사고이고 나중에
 * 되돌릴 방법이 없다. 필요한 크기가 없으면 이 표를 늘려라.
 */
export const text = {
  /** 모노 소형 라벨(섹션 키커) */
  micro: 9,
  xs: 10,
  sm: 11,
  /** 본문 기본 */
  base: 12,
  md: 13,
  lg: 15,
  xl: 16,
  /** 화면 제목 — 전 화면 공통 규격 */
  title: 20,
  h2: 22,
  h1: 26,
  display: 30,
} as const;

/**
 * 모서리 둥글기 스케일.
 *
 * 주의: 원형(아바타·점)은 `width / 2` 여야 하므로 이 스케일의 대상이 아니다.
 */
export const radii = {
  /** 그래버·점 같은 초소형 요소 */
  hair: 2,
  xs: 4,
  chipSm: 7,
  chip: 12,
  /** 헤더의 알약 버튼 */
  pill: 11,
  button: 14,
  buttonLg: 16,
  card: 18,
  cardLg: 22,
  /** 시트·모달 */
  sheet: 26,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const layout = {
  /**
   * 본문이 넓어질 수 있는 한계.
   *
   * 폰 화면을 기준으로 만든 레이아웃이라 넓은 창에서 그대로 늘리면 한 줄이 지나치게 길어져
   * 읽기 어렵다. 데스크톱 브라우저가 주 무대 중 하나이므로 이 상한이 실제로 쓰인다.
   */
  maxContentWidth: 430,
} as const;

export const theme = { colors, fonts, text, radii, spacing, layout } as const;

export type JayeonColors = typeof colors;
export type JayeonFonts = typeof fonts;
