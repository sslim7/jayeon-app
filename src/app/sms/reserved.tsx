import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { ButtonRow, Loading, Notice, SmsButton, SmsPage, s, smsError } from '@/components/sms-ui';
import { colors, fonts, spacing, text } from '@/constants/theme';
import { useReservations } from '@/hooks/use-reservations';
import { formatPhone } from '@/lib/phone';
import { newSmsRequestId } from '@/lib/sms-dispatch';
import { smsApi } from '@/lib/sms-api';
import { reservedGroups } from '@/lib/sms-reservations';

export default function ReservedScreen() {
  const { reservations, rows, loading, error, reload } = useReservations();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  useEffect(() => {
    void reload();
  }, [reload]);
  // 목록이 바뀌면 사라진 줄의 선택은 버린다.
  const ids = rows.map((row) => row.id);
  const picked = selected.filter((id) => ids.includes(id));
  const groups = reservedGroups(rows, picked);
  const single = groups.length === 1 ? groups[0] : null;
  const all = rows.length > 0 && picked.length === rows.length;

  /**
   * 예약 취소.
   *
   * 서버에는 「캠페인에서 수신자 한 명 빼기」 API 가 없고 캠페인 단위 취소만 있다. 그래서
   * 남는 사람으로 같은 제목·본문·첨부의 예약을 **먼저 만든 뒤** 기존 예약을 취소한다.
   * 순서를 뒤집으면 중간에 실패했을 때 예약이 통째로 사라지지만, 이 순서라면 최악의 경우가
   * 「같은 예약이 잠깐 둘」이라 사용자가 눈으로 보고 다시 지울 수 있다.
   */
  async function cancelSelected() {
    setBusy(true);
    setFailure('');
    let moved = 0;
    let failed = 0;
    for (const group of groups) {
      const campaign = reservations.find((item) => item.campaign.id === group.campaignId)?.campaign;
      if (!campaign) { failed += group.removedRecipientIds.length; continue; }
      try {
        if (group.remainingRecipientIds.length) {
          await smsApi.create({
            requestId: newSmsRequestId(),
            title: campaign.title,
            message: campaign.message,
            recipientIds: group.remainingRecipientIds,
            attachmentIds: (campaign.attachments ?? []).map((item) => item.id),
          });
        }
        await smsApi.setStatus(group.campaignId, 'CANCELLED');
        moved += group.removedRecipientIds.length;
      } catch (e) {
        failed += group.removedRecipientIds.length;
        setFailure(smsError(e));
      }
    }
    setConfirming(false);
    setSelected([]);
    setNotice(`${moved}명의 예약을 취소했어요.${failed ? ` ${failed}명은 취소하지 못했어요.` : ''}`);
    setBusy(false);
    await reload();
  }

  return (
    <SmsPage hideTitle wide title="예약 문자 보내기">
      <Notice message="아직 보내지 않은 예약입니다. 발송은 예약 하나(템플릿 하나)씩 합니다." />
      {error ? <Notice error message={error} /> : null}
      {failure ? <Notice error message={failure} /> : null}
      {notice ? <Notice message={notice} /> : null}
      {loading ? <Loading /> : !rows.length ? (
        <Notice message="예약된 문자가 없어요. 「문자 보내기」에서 수신자를 고르고 예약하기를 눌러 주세요." />
      ) : (
        <View style={styles.table}>
          <View style={[styles.row, styles.head]}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel="전체 선택" aria-checked={all ? true : picked.length ? 'mixed' : false} accessibilityState={{ checked: all ? true : picked.length ? 'mixed' : false, disabled: busy }} disabled={busy} style={styles.check} onPress={() => setSelected(all ? [] : ids)}>
              <Text style={styles.cell}>{all ? '☑' : picked.length ? '▣' : '☐'}</Text>
            </Pressable>
            <Text style={[styles.cell, styles.heading, styles.name]}>이름</Text>
            <Text style={[styles.cell, styles.heading, styles.phone]}>전화번호</Text>
            <Text style={[styles.cell, styles.heading, styles.title]}>템플릿명</Text>
          </View>
          {rows.map((row) => {
            const checked = picked.includes(row.id);
            return (
              <View key={row.id} style={[styles.row, checked && { backgroundColor: colors.sageRow }]}>
                <Pressable accessibilityRole="checkbox" accessibilityLabel={`${row.name} · ${formatPhone(row.phone)} · ${row.campaignTitle}`} accessibilityState={{ checked, disabled: busy }} aria-checked={checked} disabled={busy} style={styles.check} onPress={() => setSelected((current) => checked ? current.filter((id) => id !== row.id) : [...current, row.id])}>
                  <Text style={styles.cell}>{checked ? '☑' : '☐'}</Text>
                </Pressable>
                <Text numberOfLines={1} style={[styles.cell, styles.name]}>{row.name}</Text>
                <Text numberOfLines={1} style={[styles.cell, styles.phone]}>{formatPhone(row.phone)}</Text>
                <Text numberOfLines={1} style={[styles.cell, styles.title]}>{row.campaignTitle}</Text>
              </View>
            );
          })}
        </View>
      )}
      <Text style={s.meta}>전체 {rows.length}명 · 선택 {picked.length}명</Text>
      {groups.length > 1 ? <Notice error message="한 번에 한 템플릿만 보낼 수 있어요. 같은 템플릿의 예약만 선택해 주세요." /> : null}
      {single && single.selectedRowIds.length < single.total ? <Notice message={`발송은 예약 단위로 합니다. 「${single.campaignTitle}」에 함께 예약된 ${single.total - single.selectedRowIds.length}명도 같이 보내게 됩니다.`} /> : null}
      <ButtonRow>
        <SmsButton fill label="발송" disabled={busy || loading || !single} onPress={() => { if (single) router.push({ pathname: '/sms/[id]', params: { id: single.campaignId } }); }} />
        <SmsButton fill secondary danger label="삭제" disabled={busy || loading || !picked.length} onPress={() => { setNotice(''); setConfirming(true); }} />
      </ButtonRow>
      {confirming ? <BottomSheet title="예약 취소" visible onClose={() => setConfirming(false)}>
        <Notice error message={`선택한 ${picked.length}명을 예약에서 뺄까요?`} />
        <Notice message="수신자 정보는 지우지 않습니다. 남는 사람은 같은 내용으로 새 예약이 만들어지고 기존 예약은 취소로 기록됩니다." />
        <SmsButton label="삭제" accessibilityLabel="예약 취소 확인" danger secondary disabled={busy} onPress={() => void cancelSelected()} />
        <SmsButton label="취소" accessibilityLabel="예약 취소 되돌리기" secondary disabled={busy} onPress={() => setConfirming(false)} />
      </BottomSheet> : null}
    </SmsPage>
  );
}

const styles = StyleSheet.create({
  table: { borderWidth: 1, borderColor: colors.borderPill, backgroundColor: colors.card },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.border },
  head: { backgroundColor: colors.bg },
  check: { width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cell: { ...fonts.body, fontSize: text.md, color: colors.ink, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  heading: { ...fonts.bodySemi },
  name: { flex: 1.1 },
  phone: { flex: 1.6 },
  title: { flex: 1.6 },
});
