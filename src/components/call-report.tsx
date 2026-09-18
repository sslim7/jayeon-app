import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Loading, Notice, SmsButton, s } from '@/components/sms-ui';
import { CallStages } from '@/components/call-stages';
import { colors, fonts, spacing, text } from '@/constants/theme';
import { callFailureText, callRetryable } from '@/lib/call-errors';
import { isActive, isFailed, missingAnalysisNotice } from '@/lib/call-progress';
import { summaryLines } from '@/lib/call-summary';
import { formatPhone } from '@/lib/phone';
import type { CallAnalysis, CallRecord } from '@/types/calls';

/**
 * 한 구획에 들어가는 덩어리. 같은 구획 안에서도 **모양이 다른 것들이 섞인다** — 「할 일」은
 * 담당·기한을 단 카드와 후속 조치 목록이 함께 서고, 「고객이 원한 것」은 요구와 질문 두 목록이
 * 이어 붙는다. 그래서 구획이 곧 한 모양이라고 가정하지 않는다.
 */
type Block =
  | { kind: 'summary'; body: string }
  | { kind: 'cards'; cards: CallAnalysis['details'] }
  | { kind: 'todos'; todos: CallAnalysis['todos'] }
  /** `label` 이 빈 문자열이면 잔제목을 달지 않는다 — 구획 제목이 이미 그 말을 한 경우다. */
  | { kind: 'list'; label: string; items: string[] };
interface ReportSection { title: string; blocks: Block[] }

/**
 * 분석 한 덩어리를 **읽는 순서대로 늘어놓은 보고서**로 바꾼다.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **서버가 준 여섯 갈래를 그대로 여섯 덩어리로 늘어놓지 않는다.**                     │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * `consulting` 의 키(`customer_needs`·`questions`·`concerns`·`objections`·
 * `important_points`·`followups`)는 **모델이 뽑기 좋은 칸**이지 사람이 읽는 차례가 아니다.
 * 항목마다 0~3줄씩이라 그대로 펴면 제목이 본문보다 많아지고, 무엇보다 「고객이 원한 것」과
 * 「그 고객이 물은 것」이 남남처럼 떨어져 앉는다. 그래서 묶는 기준을 **읽는 사람의 질문**으로
 * 바꿨다:
 *
 * - `고객이 원한 것`  ← 요구 + 질문   : 고객이 **먼저 꺼낸** 것들이다.
 * - `걸림돌`         ← 우려 + 반대   : 계약을 **막고 있는** 것들이다. 둘은 같은 자리에서 대응한다.
 * - `중요 발언`      ← 그대로        : 묶을 짝이 없다. 앱이 쓰던 말을 그대로 쓴다.
 *
 * 🔴 **`followups` 는 「상담 분석」이 아니라 「할 일」로 옮긴다.** 둘 다 답하는 질문이
 * 「다음에 무엇을 하나」 하나뿐인데 보고서 앞뒤로 갈라 두면 읽는 사람이 **할 일을 두 번
 * 계획한다** — 위에서 세운 계획이 아래 목록에서 뒤집히는 일이 실제로 생긴다.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **「할 일」이 마지막이다.** 이 순서가 이 배열의 존재 이유다.                      │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * 앞의 구획들은 전부 **끝난 통화의 기록**이고(무슨 이야기였나 → 무엇을 원했나 → 무엇이
 * 막고 있나 → 어떤 말이 오갔나), 할 일만 **앞으로 할 일**이다. 기록 한가운데에 끼워 두면
 * 읽던 사람이 거기서 손을 떼고 움직였다가 나머지를 못 읽거나, 다 읽은 뒤 할 일을 찾아
 * 위로 되짚는다. 문서를 덮는 자리에 두면 **읽기가 곧 다음 행동으로 이어진다.**
 *
 * 비어 있는 구획은 **제목까지 걷고**, 무엇이 비었는지는 호출부가 마지막 한 줄로 말한다
 * (→ 아래 `missing`). 빈 제목을 남기면 문서에 구멍이 뚫린 것처럼 보이고, 아무 말도 없이
 * 걷으면 「할 일 칸이 왜 없지, 고장인가」가 된다.
 */
function reportOf(analysis: CallAnalysis): { sections: ReportSection[]; missing: string[] } {
  const talk = analysis.consulting;
  const list = (label: string, items: string[]): Block[] => items.length ? [{ kind: 'list', label, items }] : [];
  const all: ReportSection[] = [
    // 🔴 요약도 「있으면」이다. 기기 분석 시절 기록 중에는 요약이 빈 문자열인 것이 있다.
    { title: '요약', blocks: analysis.summary.trim() ? [{ kind: 'summary', body: analysis.summary.trim() }] : [] },
    { title: '결정사항', blocks: list('', analysis.decisions) },
    { title: '상세 내용', blocks: analysis.details.length ? [{ kind: 'cards', cards: analysis.details }] : [] },
    { title: '고객이 원한 것', blocks: [...list('고객 요구사항', talk.customer_needs), ...list('질문', talk.questions)] },
    { title: '걸림돌', blocks: [...list('우려사항', talk.concerns), ...list('반대 / 거절 요소', talk.objections)] },
    { title: '중요 발언', blocks: list('', talk.important_points) },
    { title: '할 일', blocks: [
      ...(analysis.todos.length ? [{ kind: 'todos', todos: analysis.todos } as Block] : []),
      ...list('후속 조치', talk.followups),
    ] },
  ];
  return { sections: all.filter((section) => section.blocks.length), missing: all.filter((section) => !section.blocks.length).map((section) => section.title) };
}
const time = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

/**
 * 통화 한 건의 **보고서 본문.**
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **탭이 아니라 한 장의 문서다.** 요약·상세·고객·걸림돌·할 일을 이어 붙여 위에서       │
 * │ 아래로 한 번에 읽힌다. 나누어 두면 전부 읽는 데 버튼을 네 번 눌러야 하고, 그 네 번을    │
 * │ 다 누르는 사람은 없다 — 읽히지 않는 분석은 만들지 않은 것과 같다.                     │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 **통화 원문은 이 문서에 없다.** 원문 한 건이 264조각·만 자 안팎이라, 접힌 구획으로
 * 두더라도 보고서의 끝이 어디인지 흐려진다 — 무엇보다 「원문만 보러 온 사람」이 보고서를
 * 지나쳐 내려와야 했다. 지금은 **형제 화면**이다(→ `app/calls/[id]/transcript.tsx`).
 *
 * 🔧 **머리말에 남는 것은 「누구와 언제 얼마나」 한 줄뿐이다.** 분석 모델 이름·이 통화에 든
 * 비용·「서버 AI로 다시 분석」이 여기 함께 서 있었는데, 셋 다 **보고서를 읽으러 온 사람의
 * 질문이 아니라 우리(운영)의 질문**이라 걷었다. 비용은 어드민 화면이 생기면 그리로 가고
 * (계산과 표기는 `lib/call-cost.ts` 에 그대로 있다), 다시 분석도 마찬가지다
 * (→ `components/call-reanalyze.tsx`). 기능은 지우지 않았고 이 화면에서 그리지 않을 뿐이다.
 *
 * 화면(=라우트)이 아니라 컴포넌트인 이유: 받아 오기·폴링·뒤로 가기는 라우트의 일이고
 * (→ `app/calls/[id]/index.tsx`), 여기는 **받은 한 건을 그리는 일만** 한다.
 */
export function CallReport({ record, loading, now, onTranscript }: { record: CallRecord; loading: boolean; now: number; onTranscript: () => void }) {
  const analysis = record.analysis;
  const report = useMemo(() => analysis ? reportOf(analysis) : null, [analysis]);
  const failure = isFailed(record.status) ? callFailureText(record) : '';
  return <>
    {/*
      **머리말.** 누구와 언제 얼마나 통화했는지까지가 여기다. 보고서 본문보다 위에 두는
      이유는 「누구와 언제」를 모르는 채로 요약을 읽기 시작하면 그 요약이 누구 이야기인지
      되짚느라 한 번 더 올라와야 하기 때문이다.
    */}
    <Text style={s.meta}>{formatPhone(record.contact.phone)} · {new Date(record.call.recorded_at).toLocaleString('ko-KR')}{record.call.duration !== null ? ` · ${time(record.call.duration)}` : ''}</Text>
    {/* 아직 도는 통화와 멈춘 통화만 단계를 편다. 끝난 통화에 네 칸을 세울 이유가 없다. */}
    {isActive(record.status) || isFailed(record.status) ? <CallStages item={record} now={now} /> : null}
    {/*
      🔴 **실패 문구를 두 번 적지 않는다.** 분석이 비어 있는 통화에서는 아래 안내가 같은 말에
      「그래서 다음에 무엇을 할 수 있는지」까지 붙여 말한다 — 둘을 다 세우면 같은 문장이 두
      문단 연달아 서고, 읽는 사람은 **다른 두 가지 실패가 났다고 읽는다.**
    */}
    {failure && report?.sections.length ? <Notice error message={failure} /> : null}
    {loading ? <Loading /> : null}

    {/* ─── 보고서 본문 ─────────────────────────────────────────────────── */}
    {report ? report.sections.map((section) => <Section key={section.title} title={section.title}>
      {section.blocks.map((block, index) => <BlockView key={index} block={block} />)}
    </Section>) : null}
    {/*
      🔴 **비어 있는 구획은 제목까지 걷되, 비었다는 사실은 말한다.**

      「할 일」 칸이 통째로 없으면 읽는 사람은 그것이 「없다」인지 「안 나왔다」인지 알 수
      없어 결국 다시 분석을 누른다. 한 줄이면 그 왕복이 사라진다. 전부 비어 있는 분석은
      애초에 이 자리까지 오지 않는다(아래 `missingAnalysisNotice` 가 맡는다).

      ⚠️ 조사(「이/가」)를 붙이지 않는다. 뒤에 오는 말이 받침 있는 낱말일 수도 아닐 수도 있어
      「결정사항이(가)」 같은 괄호를 달게 되는데, 그 괄호는 사람이 쓴 문장이 아니라 **기계가
      포기한 자리**로 읽힌다. 항목 나열은 콜론이 받는다.
    */}
    {report?.missing.length && report.sections.length ? <Text style={styles.absent}>이 통화에서 확인되지 않은 항목: {report.missing.join(' · ')}</Text> : null}
    {/*
      요약이 없는 통화가 빈 화면이 되지 않게 왜 비었는지를 말해 준다.

      🔴 **그 말 옆에 원문으로 가는 길을 함께 둔다.** 원문 구획이 이 문서에 있던 시절에는
      「분석이 없다」는 줄 바로 아래가 원문이라 사용자가 스크롤만 하면 됐는데, 원문이 형제
      화면으로 나가면서 그 자리가 **막다른 길**이 됐다 — 보러 온 것이 없는 화면에서 되돌아갈
      곳도 안 알려 주면, 남는 것은 「고장인가」뿐이다.
      ⚠️ 원문이 실제로 있을 때만 세운다. 없으면 「저장된 통화 원문이 없습니다」만 있는
      화면으로 보내게 되고, 그것은 버튼이 약속을 어기는 것이다.
    */}
    {!report?.sections.length && !loading ? <>
      {/* 🔴 실패로 비었으면 `alert` 다 — 낭독기에서 이 줄을 그냥 지나치면 왜 빈지 알 수 없다. */}
      <Notice error={!!failure} message={missingAnalysisNotice(record, now, failure, callRetryable(record))} />
      {record.transcript?.segments.length ? <View style={s.row}><SmsButton secondary label="통화 원문 보기" accessibilityLabel={`${record.contact.name} 통화 원문 보기`} onPress={onTranscript} /></View> : null}
    </> : null}
  </>;
}

/**
 * 보고서의 한 구획.
 *
 * 🔴 제목에 `accessibilityRole="header"` 를 단다. 탭이 사라지면서 이 화면은 **한 번에 다
 * 읽히는 대신 아주 길어졌다** — 낭독기 사용자가 구획 단위로 건너뛸 수 있어야 「할 일만 보고
 * 싶다」가 가능하다. 탭 시절에는 버튼 네 개가 그 일을 대신했다.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>;
}
function BlockView({ block }: { block: Block }) {
  /*
    **요약은 문장마다 줄을 나눠 카드에 담는다.**

    모델이 주는 요약은 서너 문장이 이어 붙은 한 덩어리라, 그대로 그리면 어디까지가 한
    이야기인지 눈으로 잡히지 않는다 — 보고서를 여는 이유가 「이 통화가 뭐였지」를 3초 안에
    아는 것이라 그 한 덩어리가 곧 이 화면의 실패다. 끊는 규칙은 `lib/call-summary.ts` 에 있다.

    카드에 담는 것은 **아래 구획들과 모양을 맞추기 위해서다.** 상세·고객·걸림돌이 전부 둥근
    카드 안에 있는데 요약만 맨바닥에 있으면, 문서에서 가장 먼저 읽어야 할 것이 가장 덜
    다듬어진 것처럼 보인다.
  */
  if (block.kind === 'summary') return <View style={s.card}>
    {summaryLines(block.body).map((line, index) => <Text selectable key={index} style={styles.summaryLine}>{line}</Text>)}
  </View>;
  if (block.kind === 'cards') return <>{block.cards.map((card, i) => <View key={i} style={s.card}><Text style={s.subtitle}>{card.title}</Text><Text selectable style={s.body}>{card.content}</Text></View>)}</>;
  /*
    할 일은 **항목마다 카드 하나**다. 아래 목록과 달리 한 항목이 내용·담당·기한·근거 네 줄을
    들고 있어, 묶어 두면 어느 담당이 어느 할 일의 것인지 줄로는 구별되지 않는다.

    🔴 **앞에 `☐` 를 달지 않는다.** 체크박스처럼 보이는데 **누를 수가 없어서**, 눌러 본
    사람에게는 고장난 화면이 된다. 실제로 그 질문("이 ㅁ은 뭐지")을 받았다. 목록이라는
    표시는 카드가 이미 하고 있다.
  */
  if (block.kind === 'todos') return <>{block.todos.map((todo, i) => <View key={i} style={s.card}>
    <Text selectable style={s.body}>{todo.content}</Text>
    {/* 담당·기한은 **모를 수 있다.** 빈칸으로 두면 「없음」과 구별되지 않아 그렇게 적는다. */}
    <Text style={s.meta}>담당: {todo.owner || '확인되지 않음'} · 기한: {todo.due_date || '확인되지 않음'}</Text>
    <Text selectable style={s.meta}>근거: {todo.source}</Text>
  </View>)}</>;
  /*
    **잔제목 하나에 카드 하나.** 항목마다 카드를 주지 않는 이유가 여기 있다.

    이 목록의 항목은 「일대일 만남 선호」처럼 한 줄짜리 짧은 문구다. 항목마다 카드를 주면
    한 줄을 담은 상자가 다섯 개 쌓이는데, 그러면 테두리가 내용보다 많아져 **불릿 목록보다
    더 산만해진다** — 카드로 감싸 달라는 요구의 목적(상세 내용과 같은 무게로 읽히게)이
    오히려 뒤집힌다. 실제로 둘 다 그려 보고 고른 쪽이다.

    🔴 잔제목은 상세 내용 카드의 소제목과 **같은 글씨**(`s.subtitle`)를 쓴다. 「후속 조치」가
    본문과 같은 굵기로 서 있으면 그것이 제목인지 첫 항목인지 알 수 없다.
    ⚠️ 헤더(`accessibilityRole="header"`)로는 달지 않는다 — 건너뛰기 목록이 스무 줄이 되면
    건너뛸 수가 없다. 구획 제목만 헤더다.
  */
  return <View style={s.card}>
    {block.label ? <Text style={s.subtitle}>{block.label}</Text> : null}
    {block.items.map((item, i) => <Text selectable key={i} style={s.body}>• {item}</Text>)}
  </View>;
}
const styles = StyleSheet.create({
  /**
   * 구획 사이의 줄. 문서로 읽히려면 제목이 **앞 구획과 붙지 않아야** 한다 — 가는 선 하나로
   * 「여기서 화제가 바뀐다」가 보인다. 카드 테두리(`borderCard`)보다 연한 색을 쓰는 이유는
   * 이 선이 칸을 나누는 것이 아니라 숨을 고르는 자리라서다.
   */
  section: { gap: spacing.md, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  /** 화면 제목(h1)보다 작고 본문보다 크다. 이 위계가 곧 「보고서처럼 읽힌다」의 전부다. */
  sectionTitle: { ...fonts.bodyBold, color: colors.ink, fontSize: text.title },
  /** 본문(`s.body`, 24)보다 줄 간격이 넓다. 문장마다 선 줄을 숨 쉴 자리 없이 쌓지 않는다. */
  summaryLine: { ...fonts.body, color: colors.mid, fontSize: text.lg, lineHeight: 27 },
  absent: { ...fonts.body, color: colors.mid, fontSize: text.md, paddingTop: spacing.md },

});
