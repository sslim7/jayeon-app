import { Text, View, StyleSheet } from 'react-native';

import { ProgressBar, s } from '@/components/sms-ui';
import { colors, fonts, radii, spacing, text } from '@/constants/theme';
import { callStageViews, formatDuration, type StageView } from '@/lib/call-progress';
import type { CallRecord } from '@/types/calls';

/**
 * 분석의 네 단계를 세로로 세워 「어디까지 왔는지」를 한눈에 보인다.
 *
 * 실기기에서 통화 분석 단계만 20분을 넘긴다. 그 동안 화면에 아무 변화가 없으면 사용자는
 * **멈춘 것과 도는 것을 구분할 수 없다** — 그래서 지나간 단계는 바탕색으로 구분하고, 도는
 * 단계는 걸린 시간을 1초마다 새로 그린다(시각은 부르는 쪽이 `now` 로 넘긴다. 렌더 중에
 * 시계를 읽으면 결과가 불안정해진다).
 *
 * 🔴 막대는 **실제로 센 진행률이 있을 때만** 그린다(→ `lib/call-progress.ts`).
 */
export function CallStages({ item, now }: { item: CallRecord; now: number }) {
  return (
    <View style={styles.list}>
      {callStageViews(item, now).map((stage, index) => (
        <View key={stage.key}>
          {index ? <View style={styles.link} /> : null}
          <View style={[styles.stage, styles[stage.state]]}>
            <View style={styles.head}>
              <Text style={[styles.name, stage.state === 'pending' && styles.faint, stage.state === 'failed' && styles.stopped]}>{stage.label}</Text>
              <Text style={[s.meta, stage.state === 'pending' && styles.faint]}>{stageTime(stage)}</Text>
            </View>
            {stage.percent !== null ? <ProgressBar percent={stage.percent} label={`${stage.label} ${stage.percent}%`} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** 잰 적이 없는 시간은 지어내지 않는다 — 단계 상태만 말한다. */
function stageTime(stage: StageView): string {
  if (stage.state === 'pending') return '예정';
  const spent = stage.ms === null ? '' : formatDuration(stage.ms);
  if (stage.state === 'done') return spent || '완료';
  if (stage.state === 'failed') return spent ? `${spent}에서 멈춤` : '멈춤';
  const running = spent ? `${spent} 경과` : '진행 중';
  return stage.percent === null ? running : `${running} · ${stage.percent}%`;
}

const styles = StyleSheet.create({
  list: { marginTop: spacing.xs },
  // 단계를 잇는 세로선. 점 하나를 더 두지 않고 선만으로 순서를 말한다.
  link: { width: 2, height: 12, marginLeft: spacing.lg, backgroundColor: colors.borderPill },
  stage: { borderRadius: radii.chip, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: { ...fonts.bodySemi, color: colors.ink, fontSize: text.md },
  faint: { color: colors.muted },
  stopped: { color: colors.red },
  done: { backgroundColor: colors.greenFill },
  running: { backgroundColor: colors.sageRow, borderWidth: 1, borderColor: colors.accentSoft },
  failed: { backgroundColor: colors.inkFill },
  pending: { backgroundColor: colors.inkFillSoft },
});
