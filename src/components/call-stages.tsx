import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';

import { ProgressBar, s } from '@/components/sms-ui';
import { colors, fonts, radii, spacing, text } from '@/constants/theme';
import { callStageViews, elapsedLabel, stageText, type StageView } from '@/lib/call-progress';
import type { CallRecord } from '@/types/calls';

/**
 * 네 단계를 세로로 세워 「어디까지 왔는지」를 한눈에 보인다.
 *
 * 서버 전사·분석은 몇 분씩 걸린다. 그 동안 화면에 아무 변화가 없으면 사용자는 **멈춘 것과
 * 도는 것을 구분할 수 없다** — 그래서 지나간 단계는 바탕색으로 구분하고, 도는 단계에는 서버가
 * 보낸 한 줄(「받아쓰는 중」)과 등록 후 경과 시간을 함께 적는다(시각은 부르는 쪽이 `now` 로
 * 넘긴다. 렌더 중에 시계를 읽으면 결과가 불안정해진다).
 *
 * 🔴 **색으로만 구분하지 않는다.** 색을 구분하기 어려운 사용자도 있고, 야외 화면에서는 연한
 * 바탕색 차이가 통째로 사라진다. 그래서 상태를 **기호(✓ ▶ ✕ ○)와 글자(완료·진행 중·멈춤·
 * 예정)로도** 적고, 낭독기용 이름에도 같은 말을 담는다.
 *
 * 🔴 막대는 **실제 값이 있을 때만** 그린다(→ `lib/call-progress.ts`). 업로드 막대는 앱이
 * 직접 센 바이트이고 서버 막대는 서버가 보낸 전체 진행률이라 **뜻이 다르므로 이름도 다르게**
 * 적는다 — 같은 이름으로 적으면 「음성 변환 40%」가 전사의 40% 로 읽힌다.
 */
export function CallStages({ item, now }: { item: CallRecord; now: number }) {
  const stages = callStageViews(item);
  const elapsed = elapsedLabel(item, now);
  return (
    <View style={styles.list}>
      {stages.map((stage, index) => {
        const spent = stateText(stage, stage.state === 'running' ? elapsed : '');
        // 서버가 보낸 한 줄을 도는 단계에만 붙인다. 업로드는 앱이 하는 일이라 서버가 모른다.
        const detail = stage.state === 'running' && stage.key !== 'UPLOAD' ? stageText(item) : '';
        return (
          <View key={stage.key}>
            {/* 지나온 구간과 남은 구간을 선 색으로도 가른다. */}
            {index ? <View style={[styles.link, stages[index - 1].state === 'done' && styles.linkPassed]} /> : null}
            <View
              accessibilityLabel={`${stage.label}, ${spent.replace(/ · /g, ', ')}${detail ? `, ${detail}` : ''}`}
              style={[styles.stage, styles[stage.state]]}>
              {/* 진행 중인 단계만 낭독기에 바뀌는 값을 알린다. */}
              <View accessibilityLiveRegion={stage.state === 'running' ? 'polite' : 'none'} style={styles.head}>
                <Text style={[styles.mark, styles[`${stage.state}Text`]]}>{MARKS[stage.state]}</Text>
                <Text style={[styles.name, styles[`${stage.state}Text`], stage.state === 'running' && styles.nameRunning]}>{stage.label}</Text>
                <Text style={[s.meta, styles.spent, styles[`${stage.state}Text`]]}>{spent}</Text>
              </View>
              {detail ? <View style={styles.live}>{/* 낭독기에는 옆의 글자가 같은 말을 한다. 돌아가는 원은 화면용이므로 접근성 트리에서 숨긴다. */}
                <ActivityIndicator size="small" color={colors.green} aria-hidden /><Text style={[s.meta, styles.liveText]}>{detail}</Text></View> : null}
              {stage.percent !== null ? <ProgressBar percent={stage.percent} label={stage.key === 'UPLOAD' ? `업로드 ${stage.percent}%` : `전체 진행률 ${stage.percent}%`} /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const MARKS: Record<StageView['state'], string> = { done: '✓', running: '▶', failed: '✕', pending: '○' };

/**
 * 한 단계의 상태 한 줄.
 *
 * 🔴 **서버는 단계별 소요 시간을 주지 않는다.** 지나간 단계에 「3분 12초」를 적으려면 우리가
 * 지어내야 하므로 적지 않는다 — 진행 중인 단계에만 등록 후 경과 시간을 붙인다.
 */
function stateText(stage: StageView, elapsed: string): string {
  if (stage.state === 'pending') return '예정';
  // 마지막 「완료」 칸은 이름이 이미 그 말을 한다. 같은 말을 두 번 적지 않는다.
  if (stage.state === 'done') return stage.key === 'DONE' ? '' : '완료';
  if (stage.state === 'failed') return '멈춤';
  const parts = ['진행 중'];
  if (elapsed) parts.push(elapsed);
  if (stage.percent !== null) parts.push(`${stage.percent}%`);
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  list: { marginTop: spacing.xs },
  // 단계를 잇는 세로선. 점 하나를 더 두지 않고 선만으로 순서를 말한다.
  link: { width: 2, height: 12, marginLeft: spacing.xl, backgroundColor: colors.borderSoft },
  linkPassed: { backgroundColor: colors.accentSoft },
  // 네 단계는 **같은 모양의 카드**가 한 줄씩 쌓인 모습이어야 한다. 둥글기·여백·테두리 굵기를
  // 상태별로 달리하면 상자 크기가 미묘하게 흔들려 목록이 들쭉날쭉해 보인다.
  stage: { borderRadius: radii.chip, borderWidth: 1, borderColor: 'transparent', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { ...fonts.bodyBold, fontSize: text.md, width: 16, textAlign: 'center' },
  name: { ...fonts.bodySemi, fontSize: text.md },
  nameRunning: { ...fonts.bodyBold },
  // 오른쪽 끝에 붙이되, 좁은 폭에서는 줄어들며 접힌다.
  spent: { marginLeft: 'auto', flexShrink: 1, textAlign: 'right' },
  live: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveText: { flexShrink: 1 },

  done: { backgroundColor: colors.greenFill },
  doneText: { color: colors.greenText },
  // 「지금 여기」가 가장 세게 보여야 한다. 바탕 + 초록 테두리 + 굵은 이름으로 확실히 가른다.
  running: { backgroundColor: colors.sageRow, borderColor: colors.green },
  runningText: { color: colors.ink },
  failed: { backgroundColor: colors.card, borderColor: colors.red },
  failedText: { color: colors.red },
  // 아직 오지 않은 단계는 **칠하지 않는다.** 흰 카드에 테두리만 두고 글자를 흐리게 해서
  // 「자리는 있지만 아직 아니다」로 읽히게 한다.
  pending: { backgroundColor: colors.card, borderColor: colors.borderCard },
  pendingText: { color: colors.muted },
});
