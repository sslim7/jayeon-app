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
  recipientId: string;
  name: string;
  phone: string;
};
export type ReservedGroup = {
  campaignId: string;
  campaignTitle: string;
  selectedRowIds: string[];
  /** 예약에서 빼려는 수신자 */
  removedRecipientIds: string[];
  /** 예약에 남는 수신자 */
  remainingRecipientIds: string[];
  /** 그 캠페인의 전체 예약 인원 */
  total: number;
};

export function readyCampaigns(campaigns: Campaign[]): Campaign[] {
  return campaigns.filter((item) => item.status === 'READY');
}

export function reservedRows(reservations: Reservation[]): ReservedRow[] {
  return reservations
    .flatMap(({ campaign, recipients }) =>
      recipients.map((item) => ({
        id: `${campaign.id}:${item.id}`,
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        recipientId: item.recipientId,
        name: item.name,
        phone: item.phone,
      })),
    )
    // 사람 기준으로 찾는 목록이라 이름순으로 두고, 같은 이름은 템플릿명으로 갈라 붙인다.
    .sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.campaignTitle.localeCompare(b.campaignTitle, 'ko') || a.id.localeCompare(b.id));
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
      group = { campaignId: row.campaignId, campaignTitle: row.campaignTitle, selectedRowIds: [], removedRecipientIds: [], remainingRecipientIds: [], total: 0 };
      groups.set(row.campaignId, group);
    }
    group.total += 1;
    if (selected.has(row.id)) {
      group.selectedRowIds.push(row.id);
      group.removedRecipientIds.push(row.recipientId);
    } else group.remainingRecipientIds.push(row.recipientId);
  }
  return Array.from(groups.values()).filter((group) => group.selectedRowIds.length > 0);
}
