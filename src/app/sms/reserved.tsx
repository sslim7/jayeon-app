import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { TextField } from '@/components/form-fields';
import { ButtonRow, Loading, Notice, SmsButton, SmsPage, s, smsError } from '@/components/sms-ui';
import { colors, fonts, radii, spacing, text } from '@/constants/theme';
import { useReservations } from '@/hooks/use-reservations';
import { formatPhone } from '@/lib/phone';
import { matchesRecipientQuery } from '@/lib/recipient-search';
import { newSmsRequestId } from '@/lib/sms-dispatch';
import { smsApi } from '@/lib/sms-api';
import { planReservedSend, reservedGroups, reservedTags, MAX_RESERVATION_SIZE } from '@/lib/sms-reservations';
import { readSmsLeave, smsExit, SMS_LEAVE_PARAM, SMS_ONLY_PARAM, SMS_ORIGIN_PARAM } from '@/lib/sms-origin';

export default function ReservedScreen() {
  const { reservations, rows, loading, error, reload } = useReservations();
  /*
   * 예약이 하나도 없을 때 안내를 **화면 가운데**에 세우기 위한 높이.
   *
   * 🔴 `flex: 1` 로는 안 된다. `SmsPage` 는 `ScrollView` 이고 그 내용 컨테이너가
   * `flexGrow` 를 갖지 않아(→ `components/sms-ui.tsx` 의 `s.page`), 자식이 채울 높이 자체가
   * 없다. 그래서 채울 높이를 **창 높이에서 직접** 가져온다.
   *
   * ⚠️ 빼는 값은 헤더와 페이지 여백 몫의 어림이다. 정확할 필요는 없다 — 조금 모자라면
   * 안내가 살짝 위에 서고, 넘치면 스크롤이 생길 뿐이라 어느 쪽도 화면을 깨지 않는다.
   */
  const emptyHeight = Math.max(160, useWindowDimensions().height - 220);
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
  const inTag = rows.filter((row) => row.campaignTitle === active);
  const visible = inTag.filter((row) => matchesRecipientQuery(query, row));
  const ids = visible.map((row) => row.id);
  // 태그를 옮겨 다녀도 보이지 않는 줄이 선택에 남지 않게 한다.
  const picked = selected.filter((id) => ids.includes(id));
  /*
   * 🔴 **묶음은 검색 결과가 아니라 태그 전체에서 만든다.** 취소도 합치기도 「원래 예약을 취소하고
   * 남는 사람으로 다시 만들기」인데, 검색으로 가려진 사람이 묶음에 없으면 `remainingRecipientIds`
   * 에서 빠져 **다시 만들 때 통째로 사라진다.** 고르는 것은 여전히 보이는 줄(`picked`)뿐이다.
   */
  const groups = reservedGroups(inTag, picked);
  /*
   * 고른 사람을 어떻게 보낼지. 🔴 **여러 예약 건에 걸쳐 골라도 보낼 수 있어야 한다** — 「더메이
   * 7명」이 시스템 사정으로 2건에 나뉘어 있다는 것은 사용자가 알 바가 아니다. 걸쳐 있으면 고른
   * 사람만으로 예약을 하나 새로 만들어 보낸다(→ `lib/sms-reservations.ts` 의 `planReservedSend`).
   */
  const plan = planReservedSend(reservations, groups);
  const all = visible.length > 0 && picked.length === visible.length;

  /**
   * 고른 사람에게 보내기.
   *
   * 한 건 안의 선택이면 예전 그대로 그 건의 상세로 간다. 여러 건에 걸쳐 있으면 **먼저 합친다**:
   * 고른 사람으로 예약을 새로 만들고, 원래 건은 남는 사람으로 다시 만든 뒤 취소한다.
   *
   * 🔴 **순서를 지킨다 — 새 것을 먼저 만들고 원래 것을 취소한다.** 뒤집으면 중간에 실패했을 때
   * 예약이 통째로 사라진다. 이 순서라면 최악이 「예약이 잠깐 둘」이라 눈으로 보고 지울 수 있다.
   * ⚠️ 합친 뒤에는 캠페인이 하나라 상세 화면·아이폰 확인창·러너가 평소와 똑같이 돈다.
   */
  async function sendSelected() {
    if (!plan || plan.kind === 'blocked') return;
    if (plan.kind === 'single') {
      router.push({ pathname: '/sms/[id]', params: {
        id: plan.campaignId,
        [SMS_ORIGIN_PARAM]: 'reserved',
        [SMS_ONLY_PARAM]: plan.campaignRecipientIds.join(','),
      } });
      return;
    }
    setBusy(true);
    setFailure('');
    setNotice('');
    const draft = { title: plan.title, message: plan.message, attachmentIds: plan.attachmentIds, reserved: true };
    let created = '';
    try {
      created = (await smsApi.create({ requestId: newSmsRequestId(), ...draft, recipientIds: plan.recipientIds })).id;
    } catch (e) {
      // 아직 아무것도 건드리지 않았다. 있는 그대로 말하고 예약은 그대로 둔다.
      setFailure(`${smsError(e)} 예약은 그대로 두었어요.`);
      setBusy(false);
      return;
    }
    let failed = 0;
    let detail = '';
    for (const source of plan.sources) {
      try {
        if (source.remainingRecipientIds.length) {
          await smsApi.create({ requestId: newSmsRequestId(), ...draft, recipientIds: source.remainingRecipientIds });
        }
        await smsApi.setStatus(source.campaignId, 'CANCELLED');
      } catch (e) {
        failed += 1;
        detail = smsError(e);
      }
    }
    setSelected([]);
    setBusy(false);
    if (failed) {
      /*
       * ⚠️ 어디까지 됐는지 말한다. 새 예약은 만들어졌지만 원래 예약이 남아 있어, 그대로 보내면
       * 남은 예약으로 **한 번 더 갈 수 있다.** 그래서 보내러 가지 않고 목록을 다시 읽어 보여 준다.
       */
      setFailure(`${plan.count}명을 한 건으로 합쳤지만 기존 예약 ${failed}건을 정리하지 못했어요. 그 사람들이 예약에 남아 있을 수 있으니 목록을 확인하고 필요하면 예약을 취소해 주세요.${detail ? ` (${detail})` : ''}`);
      await reload();
      return;
    }
    router.push({ pathname: '/sms/[id]', params: { id: created, [SMS_ORIGIN_PARAM]: 'reserved' } });
  }

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
        <View style={[styles.empty, { minHeight: emptyHeight }]}>
          {/*
            ⚠️ **「예약된 문자가 없어요」가 아니다.** 이 화면은 이제 「예약하기」로 만든 것만이
            아니라 **아직 보내지 않은 문자 전부**를 담는다(→ `lib/sms-reservations.ts` 의
            `reservedCampaigns`). 예전 문구대로 두면 발송 준비만 해 둔 문자가 여기 있는데도
            사용자는 「예약만 없는 거겠지」로 읽어, 비었을 때 무엇이 없는 것인지가 어긋난다.
          */}
          <Notice message="아직 보내지 않은 문자가 없어요. 「문자 보내기」에서 수신자를 고르고 예약하기를 눌러 주세요." />
        </View>
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
        {/*
          🔴 **「한 건 안에서 골라 주세요」는 이제 거짓이다.** 걸쳐 골라도 보낼 수 있다. 대신
          누르기 **전에** 무슨 일이 일어나는지 적는다 — 예약이 하나로 합쳐지는 것은 되돌리기
          쉬운 일이 아니라 모르고 누르면 안 된다.
        */}
        {plan?.kind === 'merge' ? <Notice message={`고른 사람이 ${plan.sources.length}건에 나뉘어 있어 하나로 합쳐서 보냅니다.`} /> : null}
        {plan?.kind === 'blocked' ? <Notice error message={plan.reason === 'size'
          ? `한 번에 ${MAX_RESERVATION_SIZE}명까지 보낼 수 있어요. 지금 ${plan.count}명을 골랐으니 나눠서 보내 주세요.`
          /*
           * ⚠️ 제목이 같아 어느 건이 다른지 눈으로 가릴 수 없다. 그래서 **몇 명씩 걸쳐 있는지**를
           * 적어 준다 — 그것만으로도 「이만큼씩 나눠 고르면 되겠구나」가 보인다.
           */
          : `예약된 내용이 서로 달라 한 번에 보낼 수 없어요. 고른 사람이 ${plan.parts.map((part, index) => `${index + 1}번째 건 ${part.count}명`).join(' · ')}으로 나뉘어 있어요. 같은 내용끼리 골라 주세요.`} /> : null}
        <ButtonRow>
          {/*
            🔴 **체크한 사람만 보낸다.** 예전에는 캠페인 id 만 넘겨서, 체크박스로 3명을 골라도
            예약된 사람 **전원**에게 나갔다 — 「체크해야 발송 버튼이 켜지는데 왜 다 나가느냐」가
            그 자리다. 이제 고른 사람의 **캠페인 수신자 id** 를 함께 실어 보내고, 상세 화면이
            그 목록으로 대상을 좁힌다(→ `lib/sms-origin.ts` 의 `SMS_ONLY_PARAM`).
            ⚠️ 라벨에 인원수를 적는다. 그냥 「발송」이면 몇 명에게 나가는지 누를 때까지 모른다.
            다 보내려면 머리줄의 전체 선택(☑)을 누르면 된다.
            🔴 **여러 예약 건에 걸쳐 골라도 켜진다.** 예전에는 한 건 안의 선택일 때만 켜져서,
            같은 「더메이」 7명인데 2건에 나뉘어 있으면 두 명을 골라도 버튼이 죽어 있었다 —
            사용자에게는 이유가 없는 일이다. 걸쳐 있으면 누를 때 하나로 합친다(`sendSelected`).
          */}
          <SmsButton
            fill
            label={plan && plan.kind !== 'blocked' ? `${plan.count}명 발송` : '발송'}
            disabled={busy || !plan || plan.kind === 'blocked'}
            onPress={() => void sendSelected()}
          />
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
  /** 예약이 없을 때의 안내 자리. 넓은 화면에서 글이 왼쪽 위에 홀로 붙어 있지 않게 가운데 세운다. */
  empty: { alignItems: 'center', justifyContent: 'center' },
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
