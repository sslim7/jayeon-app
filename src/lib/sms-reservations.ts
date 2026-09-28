import type { Campaign, CampaignRecipient } from '@/types/sms';

/**
 * 「예약」은 아직 보내지 않은 캠페인(READY)이다. 서버에 예약 전용 자원이 없으므로
 * 캠페인을 만들되 발송을 시작하지 않는 것으로 예약을 표현한다. 발송을 시작한 캠페인은
 * 더 이상 예약이 아니라 진행 중인 발송이다.
 */
export type Reservation = { campaign: Campaign; recipients: CampaignRecipient[] };
/** 예약함 목록의 한 줄. 같은 사람이 여러 예약에 들어 있으면 줄도 여러 개다. */
export type ReservedRow = {
  /** 캠페인마다 수신자 행 id가 따로 있어 화면 선택 키는 캠페인 id와 묶어 만든다. */
  id: string;
  campaignId: string;
  campaignTitle: string;
  /**
   * 캠페인 안의 **그 사람 줄 id**(`CampaignRecipient.id`).
   *
   * 🔴 아래 `recipientId`(수신자 마스터 id)와 **다른 값이다.** 발송은 이 id 로 대상을 지목한다
   * (→ `lib/sms-runner.ts` 의 `retryRecipientIds`). 둘을 바꿔 쓰면 러너가 그 사람을 못 찾거나
   * **다른 사람**을 가리킨다 — 예약 취소는 마스터 id 로, 발송은 이 id 로 돈다.
   */
  campaignRecipientId: string;
  recipientId: string;
  name: string;
  phone: string;
};
export type ReservedGroup = {
  campaignId: string;
  campaignTitle: string;
  selectedRowIds: string[];
  /**
   * 고른 사람의 **캠페인 수신자 id** — 그대로 발송 대상이 된다.
   *
   * 🔴 `removedRecipientIds` 와 **같은 사람의 다른 이름표**다. 예약 취소는 마스터 id 로 예약을
   * 다시 만들고, 발송은 이 id 로 캠페인 안의 줄을 지목한다. 한쪽을 다른 쪽 자리에 넣으면
   * 조용히 어긋난다 — 취소는 엉뚱한 사람을 빼고, 발송은 아무도 못 찾아 **전원이 나간다.**
   */
  selectedCampaignRecipientIds: string[];
  /** 예약에서 빼려는 수신자 */
  removedRecipientIds: string[];
  /** 예약에 남는 수신자 */
  remainingRecipientIds: string[];
  /** 그 캠페인의 전체 예약 인원 */
  total: number;
};

/** 한 건에 담을 수 있는 최대 인원(서버 제약). */
export const MAX_RESERVATION_SIZE = 50;

/**
 * 이 화면에 모을 캠페인 — **아직 한 번도 보내지 않은 것 전부**다.
 *
 * 🔴 **`reserved` 로 좁히지 않는다.** 예전에는 `status === 'READY' && item.reserved` 였는데,
 * `reserved` 는 「예약하기」로 만든 것만 참이라 두 부류가 **어느 화면에도 나타나지 않았다**:
 *
 * - 「발송 준비」로 만들어 두고 보내지 않은 캠페인(`reserved` 가 false)
 * - 예약 기능이 생기기 전의 옛 문서(`reserved` 필드 자체가 없어 서버 정규화가 false 로 읽는다
 *   → `lib/sms-api.ts` 의 `normalizeCampaign`)
 *
 * 발송 이력에도 없고(한 번도 시작하지 않은 캠페인은 서버가 이력에서 뺀다 — 발송 일자라는 것이
 * 아예 없다) 여기에도 없으니, 그 사람들은 **찾을 길이 없었다.** 실제로 2026-09-16 에 만든
 * 「더메이333」 1명이 그렇게 사라져 있었다.
 *
 * 아직 안 보낸 것은 **만든 경로와 무관하게** 여기 모인다.
 *
 * 🔴 **기준은 캠페인 상태가 아니라 「아직 안 보낸 사람이 남았는가」(`readyCount > 0`)다.**
 * 상태로 거르면 **일부만 보낸 순간 나머지가 통째로 사라진다**: 7명 예약에서 한 명만 보내면
 * 서버가 캠페인을 `SENDING` 으로 옮기는데, `status === 'READY'` 만 보던 예전 규칙에서는 그
 * 예약이 목록에서 빠져 **남은 6명을 여기서 찾을 수 없었다.** 실제로 그렇게 신고를 받았다.
 *
 * ⚠️ `CANCELLED` 는 남은 사람이 있어도 뺀다 — 사용자가 그만두기로 한 발송이라 「보낼 것」이
 * 아니다. 그 사람들은 발송 이력의 그날 묶음에 미발송으로 남아 거기서 보낼 수 있다.
 * `COMPLETED` 는 `readyCount` 가 0 이라 저절로 빠진다.
 *
 * ⚠️ `reserved` 필드는 그대로 둔다. 예약 취소 후 다시 만들 때 예약으로 남기는 표시로 쓰고
 * 있고(→ `app/sms/reserved.tsx`), 나중에 「예약으로 만든 것」을 갈라 보여 줄 근거이기도 하다.
 */
export function reservedCampaigns(campaigns: Campaign[]): Campaign[] {
  return campaigns.filter((item) => item.readyCount > 0 && item.status !== 'CANCELLED');
}

/**
 * 예약함에 세울 줄 — **아직 보내지 않은 사람만**이다.
 *
 * 🔴 **`status === 'READY'` 로 거른다.** 캠페인은 일부만 보내도 목록에 남으므로
 * (→ `reservedCampaigns` 의 `readyCount > 0`) 거르지 않으면 **이미 문자를 받은 사람이
 * 예약함에 그대로 서 있다.** 그러면 두 가지가 조용히 깨진다:
 *
 * - 같은 사람이 「보낸 건」과 「안 보낸 건」에 한 줄씩 나와 **중복 예약처럼 보인다**
 *   (사용자가 「중복을 지웠다」고 한 자리다).
 * - 그 줄을 골라 보내면 **같은 문자를 두 번 받는다** — 합쳐 보내기는 고른 사람으로 예약을
 *   새로 만들기 때문에(→ `planReservedSend`) 상태 판정이 한 번 초기화된다.
 *
 * ⚠️ 실패(`FAILED`)한 사람도 여기 오지 않는다. 그 사람들은 발송 이력의 그날 묶음에서 다시
 * 보내는 자리가 따로 있다 — 예약함은 「한 번도 시도하지 않은 사람」만 다룬다.
 */
export function reservedRows(reservations: Reservation[]): ReservedRow[] {
  return reservations
    .flatMap(({ campaign, recipients }) =>
      recipients.filter((item) => item.status === 'READY').map((item) => ({
        id: `${campaign.id}:${item.id}`,
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        campaignRecipientId: item.id,
        recipientId: item.recipientId,
        name: item.name,
        phone: item.phone,
      })),
    )
    // 사람 기준으로 찾는 목록이라 이름순으로 두고, 같은 이름은 템플릿명으로 갈라 붙인다.
    .sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.campaignTitle.localeCompare(b.campaignTitle, 'ko') || a.id.localeCompare(b.id));
}

/**
 * 템플릿명(= 예약을 만든 제목)별 인원수. 예약함은 이 태그로 한 템플릿씩만 보여 준다.
 * 많이 남은 쪽을 먼저 처리하게 인원수 내림차순으로 두고, 같으면 이름순으로 고정한다.
 */
export function reservedTags(rows: ReservedRow[]): { title: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.campaignTitle, (counts.get(row.campaignTitle) ?? 0) + 1);
  return Array.from(counts, ([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'ko'));
}

/** 목록의 예약 아이콘 판정용. 어느 예약이든 들어 있으면 예약된 사람이다. */
export function reservedRecipientIds(rows: ReservedRow[]): Set<string> {
  return new Set(rows.map((row) => row.recipientId));
}

/** 같은 사람이 같은 내용을 두 번 받지 않도록 이미 예약된 사람은 새 예약에서 뺀다. */
export function excludeReserved(
  selectedIds: string[],
  reserved: ReadonlySet<string>,
): { targetIds: string[]; excludedCount: number } {
  const targetIds = selectedIds.filter((id) => !reserved.has(id));
  return { targetIds, excludedCount: selectedIds.length - targetIds.length };
}

/**
 * 선택한 예약 줄을 캠페인별로 묶는다. 발송도 취소도 캠페인 단위로만 가능하므로
 * 화면은 이 묶음을 보고 「한 캠페인인가」와 「남는 사람이 있는가」를 판단한다.
 */
export function reservedGroups(rows: ReservedRow[], selectedRowIds: string[]): ReservedGroup[] {
  const selected = new Set(selectedRowIds);
  const groups = new Map<string, ReservedGroup>();
  for (const row of rows) {
    let group = groups.get(row.campaignId);
    if (!group) {
      group = { campaignId: row.campaignId, campaignTitle: row.campaignTitle, selectedRowIds: [], selectedCampaignRecipientIds: [], removedRecipientIds: [], remainingRecipientIds: [], total: 0 };
      groups.set(row.campaignId, group);
    }
    group.total += 1;
    if (selected.has(row.id)) {
      group.selectedRowIds.push(row.id);
      group.selectedCampaignRecipientIds.push(row.campaignRecipientId);
      group.removedRecipientIds.push(row.recipientId);
    } else group.remainingRecipientIds.push(row.recipientId);
  }
  return Array.from(groups.values()).filter((group) => group.selectedRowIds.length > 0);
}

/**
 * 같은 템플릿의 예약을 하나로 합친 명단.
 *
 * 같은 템플릿인지는 **예약 제목**으로 본다 — 서버 캠페인에는 템플릿 id 가 남지 않고, 예약은
 * 언제나 템플릿 이름을 제목으로 만들기 때문이다(화면의 템플릿 태그도 같은 기준이라 태그 하나가
 * 늘 예약 한 건에 대응한다). 합친 뒤에는 **현재 템플릿의 본문·첨부**로 다시 만들어지므로,
 * 템플릿을 고친 뒤 합치면 기존 예약자도 새 내용을 받는다.
 *
 * 한 건은 50명까지라 넘치면 50명씩 나눈다.
 */
export function mergeReservation(reservations: Reservation[], title: string, targetIds: string[]): {
  /** 합치면서 취소할 기존 예약 */
  replaced: Reservation[];
  /** 새로 만들 예약들의 수신자 명단 */
  chunks: string[][];
  /** 기존 예약에서 끌어온 인원수 */
  mergedCount: number;
} {
  const replaced = reservations.filter((item) => item.campaign.title === title);
  /*
   * 🔴 **기존 예약에서 끌어오는 사람은 아직 안 보낸 사람뿐이다.** 흡수한 예약은 곧 취소되는데,
   * 이미 보낸 사람까지 담아 다시 만들면 그 사람은 **같은 문자를 한 번 더 받는다.** 일부만 보낸
   * 예약도 목록에 남기 때문에(→ `reservedCampaigns`) 여기로 들어온다.
   * ⚠️ 보낸 기록은 취소된 옛 예약에 그대로 남아 발송 이력에서 볼 수 있다.
   */
  const ids = Array.from(new Set([...replaced.flatMap(({ recipients }) => recipients.filter((item) => item.status === 'READY').map((item) => item.recipientId)), ...targetIds]));
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += MAX_RESERVATION_SIZE) chunks.push(ids.slice(start, start + MAX_RESERVATION_SIZE));
  return { replaced, chunks, mergedCount: ids.length - targetIds.length };
}

/**
 * 두 예약이 **같은 내용**인가 — 합쳐도 되는지의 유일한 기준.
 *
 * 🔴 **여기가 틀리면 누군가는 자기가 예약된 것과 다른 문자를 받는다.** 같은 제목의 예약이라도
 * 중간에 템플릿을 고쳤다면 본문이나 첨부가 서로 다를 수 있다(예약은 만들 때의 내용을 캠페인에
 * 그대로 복사해 둔다). 제목만 보고 합치면 그 차이가 조용히 사라진다.
 *
 * ⚠️ 첨부는 **순서를 보지 않는다.** 서버가 돌려주는 차례는 보장이 없어, 순서만 다른 같은 첨부를
 * 「다르다」고 보면 합칠 수 있는 것을 못 합치게 막는다.
 */
export function sameReservationContent(a: Campaign, b: Campaign): boolean {
  if (a.title !== b.title || a.message !== b.message) return false;
  const ids = (campaign: Campaign) => (campaign.attachments ?? []).map((item) => item.id).sort();
  const left = ids(a);
  const right = ids(b);
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * 예약함에서 고른 사람을 **어떻게 보낼지**.
 *
 * - `single`: 고른 사람이 예약 한 건 안에 있다. 그 건의 상세로 그대로 들어간다.
 * - `merge`: 여러 건에 걸쳐 있다. 고른 사람만으로 예약을 하나 새로 만들고 원래 건은 남는
 *   사람으로 다시 만든다. 합친 뒤에는 캠페인이 하나라 발송 경로가 평소와 똑같다.
 * - `blocked`: 합칠 수 없다. 버튼을 끄고 **왜 안 되는지** 화면에 적는다.
 */
export type ReservedSendPlan =
  | { kind: 'single'; campaignId: string; campaignRecipientIds: string[]; count: number }
  | {
      kind: 'merge';
      title: string;
      message: string;
      attachmentIds: string[];
      /** 새 예약에 담을 **수신자 마스터 id**(중복 제거). */
      recipientIds: string[];
      /** 원래 건들 — 남는 사람으로 다시 만든 뒤 취소한다. */
      sources: { campaignId: string; remainingRecipientIds: string[] }[];
      count: number;
    }
  | { kind: 'blocked'; reason: 'content' | 'size'; parts: { campaignId: string; count: number }[]; count: number };

/**
 * 고른 사람을 한 번에 보내기 위한 계획.
 *
 * 🔴 **한 건 안의 선택은 합치지 않는다.** 예전과 똑같이 그 건으로 들어간다 — 합칠 이유가 없는데
 * 캠페인을 새로 만들면 예약이 늘어나고, 중간에 실패하면 없던 문제가 생긴다.
 *
 * ⚠️ 여러 건에 걸친 선택은 **내용이 모두 같을 때만** 합친다(→ `sameReservationContent`).
 * ⚠️ 합친 결과가 한 건 한도를 넘으면 합치지 않는다 — 서버가 거절해 버튼만 먹통이 된다.
 */
export function planReservedSend(reservations: Reservation[], groups: ReservedGroup[]): ReservedSendPlan | null {
  if (!groups.length) return null;
  if (groups.length === 1) {
    const [group] = groups;
    return { kind: 'single', campaignId: group.campaignId, campaignRecipientIds: group.selectedCampaignRecipientIds, count: group.selectedCampaignRecipientIds.length };
  }
  const parts = groups.map((group) => ({ campaignId: group.campaignId, count: group.selectedRowIds.length }));
  const campaigns = groups.map((group) => reservations.find((item) => item.campaign.id === group.campaignId)?.campaign);
  /*
   * 🔴 캠페인을 못 찾으면 **보내지 않는다.** 줄과 캠페인은 같은 목록에서 온 것이라 실제로는
   * 일어나지 않지만, 못 찾았다는 것은 본문·첨부를 모른다는 뜻이다 — 모르는 채로 합치면 무슨
   * 내용이 나가는지 아무도 모른다. 버튼이 꺼지는 쪽이 낫다.
   */
  const first = campaigns[0];
  if (!first || campaigns.some((campaign) => !campaign)) return null;
  if (!campaigns.every((campaign) => campaign && sameReservationContent(first, campaign))) {
    return { kind: 'blocked', reason: 'content', parts, count: parts.reduce((sum, part) => sum + part.count, 0) };
  }
  /*
   * 🔴 **같은 사람은 한 번만.** 같은 사람이 두 예약에 들어 있으면 두 줄로 골라질 수 있는데,
   * 한 예약 안에 같은 수신자를 두 번 넣으면 서버가 거절한다(→ `mergeReservation`).
   * ⚠️ 그래서 인원수도 이 목록 길이로 센다 — 줄 수로 세면 버튼이 실제보다 많은 인원을 적는다.
   */
  const recipientIds = Array.from(new Set(groups.flatMap((group) => group.removedRecipientIds)));
  if (recipientIds.length > MAX_RESERVATION_SIZE) {
    return { kind: 'blocked', reason: 'size', parts, count: recipientIds.length };
  }
  return {
    kind: 'merge',
    title: first.title,
    message: first.message,
    attachmentIds: (first.attachments ?? []).map((item) => item.id),
    recipientIds,
    sources: groups.map((group) => ({ campaignId: group.campaignId, remainingRecipientIds: group.remainingRecipientIds })),
    count: recipientIds.length,
  };
}
