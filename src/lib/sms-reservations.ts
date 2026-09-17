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

/** 한 건에 담을 수 있는 최대 인원(서버 제약). */
export const MAX_RESERVATION_SIZE = 50;

/**
 * 예약으로 볼 캠페인.
 *
 * 발송 준비만 해 두고 보내지 않은 문자도 READY 로 남기 때문에 상태만으로는 예약과 구분되지
 * 않는다. 「예약하기」로 만든 것만 `reserved` 가 true 다.
 */
export function reservedCampaigns(campaigns: Campaign[]): Campaign[] {
  return campaigns.filter((item) => item.status === 'READY' && item.reserved);
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
