import { StyleSheet, Text, View } from 'react-native';
import { Notice, s } from '@/components/sms-ui';
import { colors, fonts, radii, spacing, text } from '@/constants/theme';
import type { TranscriptSegment } from '@/types/calls';

/**
 * 말풍선을 **오른쪽**에 세우는 화자 번호.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이것은 확인된 사실이 아니라 가정이다.**                                      │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * 알리바바 ASR 은 화자를 `"0"`/`"1"` 로만 준다 — **누가 상담사인지는 말해 주지 않는다.**
 * 우리가 가진 통화에서는 상담사가 먼저 말하지 않았는데도 상담사가 `"0"` 이었고, 녹음하는
 * 폰이 상담사 쪽이라 목소리가 크고 선명해서로 보인다. 하지만 **보장이 없고**, 짧은 대답이
 * 반대쪽 화자로 새는 오류도 실제로 있다(이 통화의 「네, 여보세요.」가 그 예다 — 고객의
 * 말인데 `"0"` 으로 왔다).
 *
 * 🔴 **그래서 화면에 「상담사」「고객」이라고 쓰지 않는다.** 틀렸을 때 거짓이 확신에 차
 * 보이고, 원문을 읽은 사람이 하지도 않은 말을 상담사가 했다고 믿게 된다. 좌우로 가르되
 * 이름표는 **번호 그대로** 달고, 그 위에 가정이라는 사실을 한 줄로 적는다.
 */
const RIGHT_SPEAKER = '0';

/** `mm:ss`. 통화 원문의 시각은 통화 시작으로부터 잰 초다 — 시계 시각이 아니다. */
export const spokenAt = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

/**
 * 통화 원문을 **주고받은 대화로** 그린다.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **좌우로 가르는 것은 화자 정보가 있을 때뿐이다.**                               │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * 서버 파이프라인(알리바바 ASR)은 화자를 나눠 주지만 **폰·맥북 whisper 로 만든 원문에는
 * 화자가 아예 없다**(→ `components/asr-bench.tsx` 로 재 본 그 결과들). 그때 전부 한쪽에
 * 몰아 세우면 화면은 「한 사람이 264번 말한 대화」라고 말하는 셈이 된다 — 없는 정보를
 * 있는 것처럼 그리느니 시각과 내용만 흐르게 두는 편이 정직하다.
 *
 * ⚠️ 화자가 `"0"`/`"1"` 둘이라는 보장도 없다. 셋 이상이 와도 `"0"` 만 오른쪽에 서고 나머지는
 * 전부 왼쪽에 선다 — 번호를 그대로 달고 있으므로 화면이 거짓말을 하지는 않는다.
 *
 * ⚠️ **한 통화가 264조각·1만 자다.** 그래서 이 목록은 한 번에 전부 그려진다 — 실제로 재 보면
 * 264개를 세우는 데 130ms 안팎이고 스크롤도 걸리지 않아, 가상 스크롤을 들일 이유가 없다.
 * 조각 수가 몇 배로 늘어나는 일이 생기면 그때 다시 재라.
 */
export function CallTranscript({ segments }: { segments: TranscriptSegment[] }) {
  const split = segments.some((segment) => segment.speaker);
  if (!segments.length) return <Notice message="저장된 통화 원문이 없습니다." />;
  return <>
    {/*
      🔴 **가정을 가정이라고 적는 줄이다. 지우지 마라.** 이 줄이 없으면 좌우로 갈린 화면
      자체가 「우리는 누가 상담사인지 안다」고 말한다(→ 위 `RIGHT_SPEAKER`).
    */}
    {split ? <Text style={s.meta}>오른쪽이 화자 {RIGHT_SPEAKER}, 왼쪽이 나머지 화자입니다. 어느 번호가 상담사인지는 확정할 수 없어 이름 대신 번호로 적습니다.</Text> : null}
    {/*
      🔴 **말풍선은 바깥 묶음의 `gap` 을 쓰지 않는다.** 균일한 간격을 그대로 받으면 한 사람이
      이어 말한 세 마디와 상대가 받아친 한 마디가 **똑같이 떨어져** 있어, 좌우로 갈라 놓고도
      「어디서 말이 넘어갔는지」가 눈에 들어오지 않는다. 간격은 각 줄이 스스로 정한다
      (아래 `runTop`/`turnTop`).
    */}
    <View style={styles.talk}>
      {segments.map((segment, index) => {
        const right = split && segment.speaker === RIGHT_SPEAKER;
        // 화자가 바뀌는 자리. 이름표도 간격도 이 한 값이 정한다.
        const turned = split && segment.speaker !== segments[index - 1]?.speaker;
        return <View key={index}>
          {/*
            🔴 **화자 이름표는 바뀔 때 한 번만 적는다.** 발화마다 적으면 264번 나와서 읽을
            내용보다 이름표가 많아진다 — 카카오톡이 상대 말풍선 위에 이름을 한 번만 적는
            것과 같은 이유다. 그러면서도 「이 번호가 상담사라는 보장은 없다」는 사실이
            화면에 남는다(→ 위 `RIGHT_SPEAKER` 와 바로 위의 안내 줄).
          */}
          {turned ? <Text style={[styles.speaker, right ? styles.alignRight : styles.alignLeft, index ? styles.runTop : null]}>화자 {segment.speaker}</Text> : null}
          <View style={[
            styles.turn,
            split ? (right ? styles.turnRight : styles.turnLeft) : null,
            // 같은 사람이 이어 말하면 바싹 붙이고, 넘어가는 자리만 벌린다.
            index ? (turned ? styles.turnTop : styles.runTop) : null,
          ]}>
            {/*
              🔴 **시각은 말풍선 바깥, 안쪽(화면 가운데) 방향에 붙는다.** 말풍선 안에 넣으면
              읽을 말과 같은 덩어리가 되어 눈이 매번 「00:02 · 」을 먼저 밟고 지나간다 —
              264번이면 그것만으로 원문이 읽히지 않는다.
            */}
            {split && right ? <Text style={styles.turnTime}>{spokenAt(segment.start)}</Text> : null}
            <View style={[styles.bubble, split ? (right ? styles.bubbleRight : styles.bubbleLeft) : styles.bubblePlain]}>
              <Text selectable style={s.body}>{segment.text}</Text>
            </View>
            {!split || !right ? <Text style={styles.turnTime}>{spokenAt(segment.start)}</Text> : null}
          </View>
        </View>;
      })}
    </View>
  </>;
}

const styles = StyleSheet.create({
  /** 말풍선 묶음. 🔴 `gap` 을 주지 마라 — 간격을 줄마다 다르게 두는 것이 이 묶음의 존재 이유다. */
  talk: {},
  /**
   * 한 마디가 차지하는 줄: 시각 · 말풍선 · 시각.
   *
   * ⚠️ **교차축 정렬은 행이 아니라 시각 글자에 건다**(→ 아래 `turnTime` 의 `alignSelf`).
   * 행에 `alignItems: 'flex-end'` 를 걸면 말풍선까지 그 정렬을 받아, 한 줄을 다 쓰는
   * 화자 없는 원문(`bubblePlain`)이 세로로 쪼그라든다.
   */
  turn: { flexDirection: 'row', gap: spacing.xs },
  turnRight: { justifyContent: 'flex-end' },
  turnLeft: { justifyContent: 'flex-start' },
  /** 같은 사람이 이어 말하는 자리 — 바싹 붙인다. */
  runTop: { marginTop: spacing.xs },
  /** 말이 넘어가는 자리 — 여기서만 벌린다. 이 차이가 곧 「대화로 읽힌다」의 전부다. */
  turnTop: { marginTop: spacing.lg },
  /**
   * 🔴 **말풍선에 `flex` 를 주지 마라.**
   *
   * 가로 묶음 안에서 `flex: 1` 이나 `flex: 0` 을 쓰면 react-native-web 이 `flex-basis: 0` 을
   * 남겨, 말풍선이 **한 글자 폭으로 찌그러진 채 글자가 세로로 쏟아진다** — 실제로 그렇게
   * 그려 보고 고쳤다. 타입도 린트도 잡지 못하고, 화면을 띄워 보기 전에는 알 수 없다.
   * 아무것도 주지 않으면 내용 폭(max-content)으로 서고 아래 `maxWidth` 가 거기서 감는다.
   */
  bubble: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.card },
  /**
   * 🔴 `maxWidth` 가 없으면 좌우로 가른 것이 보이지 않는다. 긴 말 한 마디가 화면 폭을 다
   * 쓰면 오른쪽 풍선과 왼쪽 풍선이 같은 자리에서 시작해 **대화가 다시 한 줄짜리 목록이 된다.**
   * 모서리 하나를 죽이는 것은 말풍선의 꼬리 대신이다 — 어느 쪽에서 나온 말인지가 형태로 남는다.
   */
  bubbleRight: { maxWidth: '74%', backgroundColor: colors.sageRow, borderTopRightRadius: radii.xs },
  bubbleLeft: { maxWidth: '74%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderCard, borderTopLeftRadius: radii.xs },
  /** **화자를 모르는 원문**의 말풍선. 좌우로 가를 수 없으므로 남는 자리를 다 가져간다. */
  bubblePlain: { flexGrow: 1, flexShrink: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderCard },
  /**
   * 시각.
   *
   * 🔴 **`alignSelf: 'flex-end'` 가 이 줄의 핵심이다.** 여러 줄로 감긴 말풍선 옆에서 시각이
   * 가운데나 위에 뜨면 어느 말의 시각인지 눈으로 잇기 어렵다 — 말풍선의 **마지막 줄**에
   * 맞춰야 카카오톡에서 보던 그 모양이 된다. 한 줄짜리 발화에서는 저절로 같은 높이가 된다.
   * 🔴 **`colors.muted` 를 쓰지 않는다** — 바탕 대비 2.65:1 이라 본문보다 작은 글자에는
   * WCAG 4.5:1 에 한참 못 미친다(→ `constants/theme.ts`). 「가볍게」는 흐린 색이 아니라
   * **작은 크기와 낮은 무게**로 낸다.
   */
  turnTime: { ...fonts.body, color: colors.mid, fontSize: text.sm, alignSelf: 'flex-end', paddingBottom: spacing.xs },
  /** 화자 이름표. 말풍선 위에, 그 말풍선이 선 쪽에 붙는다. */
  speaker: { ...fonts.bodyMedium, color: colors.mid, fontSize: text.sm, paddingBottom: spacing.xs },
  alignRight: { textAlign: 'right' },
  alignLeft: { textAlign: 'left' },
});
