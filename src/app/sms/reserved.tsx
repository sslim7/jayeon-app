import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { TextField } from '@/components/form-fields';
import { ButtonRow, Loading, Notice, SmsButton, SmsPage, s, smsError } from '@/components/sms-ui';
import { colors, fonts, radii, spacing, text } from '@/constants/theme';
import { useReservations } from '@/hooks/use-reservations';
import { formatPhone } from '@/lib/phone';
import { matchesRecipientQuery } from '@/lib/recipient-search';
import { newSmsRequestId } from '@/lib/sms-dispatch';
import { smsApi } from '@/lib/sms-api';
import { reservedGroups, reservedTags } from '@/lib/sms-reservations';
import { readSmsLeave, smsExit, SMS_LEAVE_PARAM, SMS_ORIGIN_PARAM } from '@/lib/sms-origin';

export default function ReservedScreen() {
  const { reservations, rows, loading, error, reload } = useReservations();
  /*
   * 발송 상세를 닫고 **여기로 돌아온 경우**. 그때 무슨 말을 할지는 출처가 정한다
   * (→ `lib/sms-origin.ts`). 🔴 이 화면의 안내는 「예약을 취소했어요」처럼 **예약에 손을 댔다**는
   * 말이라, 남의 흐름에서 튕겨 온 사람이 그대로 읽으면 없던 일을 있었다고 믿는다.
   */
  const params = useLocalSearchParams<{ closed?: string }>();
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(() => {
    const leave = readSmsLeave(params[SMS_LEAVE_PARAM]);
    return leave ? smsExit('reserved', leave).notice : '';
  });
  const [failure, setFailure] = useState('');
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  const tags = reservedTags(rows);
  // 고른 태그가 사라지면(모두 취소 등) 남은 첫 태그로 되돌아간다.
  const active = tags.some((item) => item.title === tag) ? tag : tags[0]?.title ?? '';
  // 검색은 **고른 태그 안에서만** 좁힌다. 발송도 태그(예약) 단위라 태그 밖을 섞어 보여 주면
  // 「보이는 사람에게 보낸다」가 깨진다.
  const visible = rows.filter((row) => row.campaignTitle === active && matchesRecipientQuery(query, row));
  const ids = visible.map((row) => row.id);
  // 태그를 옮겨 다녀도 보이지 않는 줄이 선택에 남지 않게 한다.
  const picked = selected.filter((id) => ids.includes(id));
  const groups = reservedGroups(visible, picked);
  const single = groups.length === 1 ? groups[0] : null;
  const all = visible.length > 0 && picked.length === visible.length;

  /**
   * 예약 취소.
   *
   * 서버에는 「예약에서 수신자 한 명 빼기」 API 가 없고 예약(캠페인) 단위 취소만 있다. 그래서
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
            // 다시 만든 것도 예약이어야 예약함에 남는다.
            reserved: true,
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
      {error ? <Notice error message={error} /> : null}
      {failure ? <Notice error message={failure} /> : null}
      {notice ? <Notice message={notice} /> : null}
      {loading && !rows.length ? <Loading /> : !rows.length ? (
        <Notice message="예약된 문자가 없어요. 「문자 보내기」에서 수신자를 고르고 예약하기를 눌러 주세요." />
      ) : <>
        {/* 템플릿 태그: 한 번에 한 템플릿만 보여 준다(발송도 그 단위로 한다). */}
        <View style={styles.tags}>
          {tags.map((item) => {
            const on = item.title === active;
            return <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={`${item.title} 예약 ${item.count}명`} accessibilityState={{ selected: on }} aria-pressed={on} disabled={busy} onPress={() => { setTag(item.title); setSelected([]); setQuery(''); }} style={[styles.tag, on && styles.tagOn]}>
              <Text numberOfLines={1} style={[styles.tagLabel, on && styles.tagLabelOn]}>{item.title}({item.count})</Text>
            </Pressable>;
          })}
        </View>
        {/* 검색칸은 placeholder 가 같은 말을 하므로 라벨 글자를 걷는다(낭독기에는 그대로 읽힌다). */}
        <TextField hideLabel label="이름,전화번호 뒷자리 4자" placeholder="이름,전화번호 뒷자리 4자" value={query} onChangeText={setQuery} />
        <View style={styles.table}>
          <View style={[styles.row, styles.head]}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel="전체 선택" aria-checked={all ? true : picked.length ? 'mixed' : false} accessibilityState={{ checked: all ? true : picked.length ? 'mixed' : false, disabled: busy }} disabled={busy} style={styles.check} onPress={() => setSelected(all ? [] : ids)}>
              <Text style={styles.cell}>{all ? '☑' : picked.length ? '▣' : '☐'}</Text>
            </Pressable>
            <Text style={[styles.cell, styles.heading, styles.name]}>이름</Text>
            <Text style={[styles.cell, styles.heading, styles.phone]}>전화번호</Text>
          </View>
          {visible.map((row) => {
            const checked = picked.includes(row.id);
            return (
              <View key={row.id} style={[styles.row, checked && { backgroundColor: colors.sageRow }]}>
                <Pressable accessibilityRole="checkbox" accessibilityLabel={`${row.name} · ${formatPhone(row.phone)}`} accessibilityState={{ checked, disabled: busy }} aria-checked={checked} disabled={busy} style={styles.check} onPress={() => setSelected((current) => checked ? current.filter((id) => id !== row.id) : [...current, row.id])}>
                  <Text style={styles.cell}>{checked ? '☑' : '☐'}</Text>
                </Pressable>
                <Text numberOfLines={1} style={[styles.cell, styles.name]}>{row.name}</Text>
                <Text numberOfLines={1} style={[styles.cell, styles.phone]}>{formatPhone(row.phone)}</Text>
              </View>
            );
          })}
        </View>
        {/* 태그 안에 사람은 있는데 검색으로 다 걸러졌을 때. 빈 표만 두면 예약이 사라진 줄 안다. */}
        {!visible.length ? <Notice message="검색어에 해당하는 예약이 없습니다." /> : null}
        <Text style={s.meta}>{active} {visible.length}명 · 선택 {picked.length}명</Text>
        {groups.length > 1 ? <Notice message={`「${active}」 예약은 인원이 많아 ${groups.length}건으로 나뉘어 있어요. 보내기는 한 건씩 하면 되니 한 건 안에서 골라 주세요.`} /> : null}
        {single && single.selectedRowIds.length < single.total ? <Notice message={`보내기는 예약한 건 전체로 나갑니다. 같이 예약된 ${single.total - single.selectedRowIds.length}명도 함께 보내게 됩니다.`} /> : null}
        <ButtonRow>
          <SmsButton fill label="발송" disabled={busy || !single} onPress={() => { if (single) router.push({ pathname: '/sms/[id]', params: { id: single.campaignId, [SMS_ORIGIN_PARAM]: 'reserved' } }); }} />
          <SmsButton fill secondary danger label="삭제" disabled={busy || !picked.length} onPress={() => { setNotice(''); setConfirming(true); }} />
        </ButtonRow>
      </>}
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
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderPill, backgroundColor: colors.card },
  tagOn: { borderColor: colors.greenText, backgroundColor: colors.sageRow },
  tagLabel: { ...fonts.body, fontSize: text.lg, color: colors.mid },
  tagLabelOn: { ...fonts.bodySemi, color: colors.greenText },
  table: { borderWidth: 1, borderColor: colors.borderPill, backgroundColor: colors.card },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.border },
  head: { backgroundColor: colors.bg },
  check: { width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cell: { ...fonts.body, fontSize: text.md, color: colors.ink, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  heading: { ...fonts.bodySemi },
  name: { flex: 1 },
  phone: { flex: 1.2 },
});
