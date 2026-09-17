import { useCallback, useMemo, useState } from 'react';
import { smsError } from '@/components/sms-ui';
import { smsApi } from '@/lib/sms-api';
import { reservedCampaigns, reservedRecipientIds, reservedRows, type Reservation } from '@/lib/sms-reservations';

/**
 * 예약(READY 캠페인)에 들어 있는 수신자를 모은다.
 *
 * 서버에 「예약된 수신자」를 한 번에 주는 API가 없어 캠페인 목록 1회 + READY 캠페인 수만큼
 * 수신자 조회가 필요하다. 그래서 화면 진입에 한 번만 부르고 결과를 memo 해서 재사용하며,
 * 예약을 만들거나 취소한 뒤에만 다시 부른다. READY 캠페인이 수십 개로 늘면 그만큼 요청이
 * 늘어나므로, 그때는 서버에 예약 목록 API를 두는 편이 낫다.
 */
export function useReservations() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 방금 읽은 값을 그대로 돌려준다 — 예약 직전 중복 판정은 state 갱신을 기다리지 않고 이 값으로 해야 한다.
  const reload = useCallback(async (): Promise<Reservation[] | null> => {
    setLoading(true);
    try {
      const ready = reservedCampaigns(await smsApi.list());
      const next = await Promise.all(ready.map(async (campaign) => ({ campaign, recipients: await smsApi.recipients(campaign.id) })));
      setReservations(next);
      setError('');
      return next;
    } catch (e) {
      setError(smsError(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  const rows = useMemo(() => reservedRows(reservations), [reservations]);
  const recipientIds = useMemo(() => reservedRecipientIds(rows), [rows]);
  return { reservations, rows, recipientIds, loading, error, reload };
}
