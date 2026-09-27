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
 * 아직 안 보낸 것은 **만든 경로와 무관하게** 여기 모인다. `status === 'READY'` 하나가 곧
 * 「아직 아무것도 나가지 않았다」는 뜻이다 — 발송을 시작하면 서버가 `SENDING` 으로 옮긴다.
 *
 * ⚠️ `reserved` 필드는 그대로 둔다. 예약 취소 후 다시 만들 때 예약으로 남기는 표시로 쓰고
 * 있고(→ `app/sms/reserved.tsx`), 나중에 「예약으로 만든 것」을 갈라 보여 줄 근거이기도 하다.
 */
export function reservedCampaigns(campaigns: Campaign[]): Campaign[] {
  return campaigns.filter((item) => item.status === 'READY');
}

export function reservedRows(reservations: Reservation[]): ReservedRow[] {
  return reservations
    .flatMap(({ campaign, recipients }) =>
      recipients.map((item) => ({
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
  const ids = Array.from(new Set([...replaced.flatMap(({ recipients }) => recipients.map((item) => item.recipientId)), ...targetIds]));
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += MAX_RESERVATION_SIZE) chunks.push(ids.slice(start, start + MAX_RESERVATION_SIZE));
  return { replaced, chunks, mergedCount: ids.length - targetIds.length };
}
