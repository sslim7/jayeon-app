import { api } from '@/lib/api';
import type { CallRecord } from '@/types/calls';

export const callApi = {
  // 서버는 최신순 페이징만 제공한다. 이름 필터는 화면(`app/calls.tsx`)이 받은 목록에서 처리한다.
  async list(): Promise<CallRecord[]> {
    const items: CallRecord[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: { items: CallRecord[]; nextCursor?: string | null } = await api.get(`/calls${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!Array.isArray(page.items)) throw new Error('통화 목록을 확인할 수 없습니다.');
      items.push(...page.items);
      cursor = page.nextCursor ?? null;
      if (cursor && (typeof cursor !== 'string' || seen.has(cursor))) throw new Error('통화 목록을 끝까지 불러오지 못했습니다.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
  },
  get: (id: string) => api.get<CallRecord>(`/calls/${encodeURIComponent(id)}`),
  // PUT 응답은 원문·분석을 뺀 요약이다(서버가 6MiB 를 되돌려주지 않게). 호출부는 응답을 쓰지 않는다.
  upload: (record: CallRecord) => api.put<unknown>(`/calls/${encodeURIComponent(record.call_id)}`, record),
};
