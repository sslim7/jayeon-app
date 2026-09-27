import type { RecipientHistory } from '@/types/sms';

/**
 * 발송 이력을 **「일자 · 템플릿」 묶음**으로 접는 판정.
 *
 * 이력은 수신자 한 명이 한 줄이라, 50명에게 한 번 보내면 목록이 50줄로 늘어난다. 그러면
 * 「언제 무엇을 보냈나」를 훑을 수가 없고 스크롤만 남는다. 그래서 먼저 발송 단위로 접어 두고,
 * 누른 묶음만 수신자 줄을 펼친다.
 *
 * 🔴 **판정을 화면에서 하지 않는다.** 날짜 자르기와 정렬은 눈으로 확인하기 어려운 종류의
 * 실수(→ 아래 `historyDateKey`)를 품고 있어서, 화면 없이 `node --test` 로 고정한다
 * (→ `tests/sms-history.test.cjs`).
 */

/** 묶는 데 필요한 것만 받는다 — 테스트가 수신자 한 줄을 통째로 짓지 않아도 되게. */
type Timed = Pick<RecipientHistory, 'sentAt' | 'failedAt' | 'updatedAt'>;
type Titled = Timed & Pick<RecipientHistory, 'campaignTitle'>;

export type SmsHistoryGroup<T extends Titled> = {
  /** 펼침 상태를 기억할 키(→ `historyGroupKey`). */
  key: string;
  /** 로컬 날짜 YYYY-MM-DD. */
  date: string;
  title: string;
  count: number;
  items: T[];
};

/**
 * 이 줄이 「언제」로 세어질 시각.
 *
 * 성공은 `sentAt`, 실패는 `failedAt`, 둘 다 비어 있으면 마지막으로 손댄 때다. 목록 한 줄이
 * 쓰는 시각과 **같은 순서로** 골라야 한다(→ `app/sms/history.tsx` 의 `sentAtLabel`) — 한쪽만
 * 바뀌면 줄에 적힌 일시와 그 줄이 들어간 묶음의 일자가 어긋난다.
 */
const historyTime = (item: Timed) => item.sentAt || item.failedAt || item.updatedAt;

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * 이 줄이 속한 **로컬 날짜**(YYYY-MM-DD).
 *
 * 🔴 **ISO 문자열을 `slice(0, 10)` 으로 자르면 안 된다.** 서버가 주는 시각은 UTC 기준이라,
 * 그렇게 자른 날짜는 「UTC 로 몇 일이었나」다. 한국(UTC+9)에서는 **밤 늦게 보낸 발송**이
 * UTC 로는 이미 다음 날이어서, 사용자가 「어제 저녁에 보낸 것」으로 기억하는 발송이 다음 날
 * 묶음에 들어가 사라진다. 게다가 같은 밤에 나간 한 건이 자정을 걸쳐 **두 묶음으로 쪼개지고**
 * 건수가 둘로 갈린다. 화면에는 그럴듯한 날짜가 떠서 틀린 줄도 모른다.
 *
 * ⚠️ 시각을 못 읽는 값(빈 문자열·깨진 형식)은 앞 10자를 그대로 쓴다. `NaN-NaN-NaN` 같은
 * 날짜가 목록 머리에 서는 것보다는, 묶이지 않고 원래 글자로 남는 편이 덜 거짓말한다.
 */
export function historyDateKey(item: Timed): string {
  const raw = historyTime(item) ?? '';
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return String(raw).slice(0, 10);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * 묶음을 가리키는 안정적인 키.
 *
 * ⚠️ **템플릿 이름 길이를 함께 적는다.** 템플릿 이름은 사용자가 직접 지어서 `|` 가 들어올 수
 * 있고(「9월|정기」), 날짜와 이름을 구분자로만 이어 붙이면 서로 다른 두 묶음이 같은 키를 갖는
 * 날이 온다. 그러면 한 묶음을 펼쳤을 때 엉뚱한 묶음이 같이 펼쳐진다. 길이가 앞에 있으면
 * 이름이 어디서 시작하는지가 글자와 무관하게 정해져 충돌이 생기지 않는다.
 */
export function historyGroupKey(date: string, title: string): string {
  return `${date}|${title.length}|${title}`;
}

/** 정렬용 시각. 못 읽는 값은 0 으로 둔다 — NaN 이 비교에 끼면 정렬 결과 전체가 뒤틀린다. */
function sortableTime(item: Timed): number {
  const at = new Date(historyTime(item) ?? '').getTime();
  return Number.isNaN(at) ? 0 : at;
}

/**
 * 「일자 · 템플릿」으로 접는다.
 *
 * ⚠️ **같은 템플릿을 하루에 두 번 보내면 한 묶음이 된다.** 사용자가 고른 기준이 「일자,
 * 발송템플릿」이라서 그렇고, 펼치면 수신자 줄에 각자의 발송 일시가 그대로 적혀 있어 두 번
 * 나간 것은 그 자리에서 보인다.
 *
 * 정렬은 **최근 일자 먼저**, 같은 일자 안에서는 그 묶음의 가장 최근 발송이 먼저다.
 * 묶음 **안의** 줄 순서는 건드리지 않는다 — 서버가 최근 발송 순으로 주므로 받은 순서가 곧
 * 그 순서이고, 여기서 다시 정렬하면 서버가 아는 순서(같은 시각의 동순위 처리 등)를 잃는다.
 */
export function groupSmsHistory<T extends Titled>(items: readonly T[]): SmsHistoryGroup<T>[] {
  const groups = new Map<string, SmsHistoryGroup<T> & { latest: number }>();
  for (const item of items) {
    const date = historyDateKey(item);
    const title = item.campaignTitle;
    const key = historyGroupKey(date, title);
    const at = sortableTime(item);
    const found = groups.get(key);
    if (found) {
      found.items.push(item);
      found.count += 1;
      if (at > found.latest) found.latest = at;
      continue;
    }
    groups.set(key, { key, date, title, count: 1, items: [item], latest: at });
  }
  return [...groups.values()]
    // 날짜는 YYYY-MM-DD 라 글자 비교가 곧 시간 순서다.
    .sort((a, b) => b.date.localeCompare(a.date) || b.latest - a.latest)
    .map(({ latest: _latest, ...group }) => group);
}
