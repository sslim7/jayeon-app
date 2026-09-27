import { countOutcomes, type OutcomeCounts } from '@/lib/sms-outcome';
import type { CampaignStatus, RecipientHistory } from '@/types/sms';

/**
 * 발송 이력 화면이 쓰는 **순수 판정**: 「일자 · 템플릿」 묶기, 기간 거르기, 결과 집계, 미완료 여부.
 *
 * 이력은 수신자 한 명이 한 줄이라, 50명에게 한 번 보내면 목록이 50줄로 늘어난다. 그러면
 * 「언제 무엇을 보냈나」를 훑을 수가 없고 스크롤만 남는다. 그래서 먼저 발송 단위로 접어 두고,
 * 누른 묶음만 수신자 줄을 펼친다.
 *
 * 🔴 **「줄」과 「사람」은 다르다.** 서버는 한 사람에 대해 「지난 실패」와 「지금 대기」를 **두
 * 줄로** 내려보낸다(재시도한 사람). 그래서 목록은 줄 단위로 그리고(→ `items`), **세는 것은
 * 사람 단위로**(→ `current`, `currentByRecipient`) 한다. 이 구분을 놓치면 한 사람이 「실패 1 ·
 * 미발송 1」 두 명으로 세어진다 — 서버가 주는 `total` 도 사람 수가 아니라 줄 수다.
 *
 * 🔴 **판정을 화면에서 하지 않는다.** 날짜 자르기와 정렬은 눈으로 확인하기 어려운 종류의
 * 실수(→ 아래 `historyDateKey`)를 품고 있어서, 화면 없이 `node --test` 로 고정한다
 * (→ `tests/sms-history.test.cjs`).
 */

/** 묶는 데 필요한 것만 받는다 — 테스트가 수신자 한 줄을 통째로 짓지 않아도 되게. */
type Timed = Pick<RecipientHistory, 'sentAt' | 'failedAt' | 'updatedAt'>;
/**
 * ⚠️ `recipientId`·`campaignId` 는 **선택**으로 받는다. 외부 발송 기록에는 캠페인이 없고,
 * 여기 판정들은 그 줄도 버리지 않고 각각 한 사람으로 세야 한다(→ `personKey`).
 */
type Titled = Timed
  & Pick<RecipientHistory, 'campaignTitle' | 'status' | 'errorCode'>
  & Partial<Pick<RecipientHistory, 'recipientId' | 'campaignId'>>;

export type SmsHistoryGroup<T extends Titled> = {
  /** 펼침 상태를 기억할 키(→ `historyGroupKey`). */
  key: string;
  /** 로컬 날짜 YYYY-MM-DD. */
  date: string;
  title: string;
  /**
   * 이 묶음의 **수신자 줄 수**.
   *
   * ⚠️ `counts` 의 합과 다를 수 있다. 한 사람이 「지난 실패」와 「지금 대기」 두 줄로 내려오기
   * 때문이다(→ `currentByRecipient`). 줄 수와 사람 수는 서로 다른 것을 세고 있다.
   */
  count: number;
  /**
   * 결과별 **인원**. 🔴 줄 수가 아니다 — 세기 전에 `current` 로 접는다.
   *
   * 🔴 **묶을 때 함께 센다.** 화면이 묶음마다 다시 순회하면 같은 목록을 두 번 걷는 데다,
   * 세는 규칙이 화면으로 새어 나가 발송 상세와 다른 숫자가 나올 길이 열린다.
   */
  counts: OutcomeCounts;
  /**
   * 화면에 그리는 **줄 목록**. 🔴 **접지 않는다** — 「지난 실패」도 보여야 이력이다.
   * 실패 줄이 사라지면 사용자는 그 사람이 왜 다시 대기가 되었는지 알 수 없다.
   */
  items: T[];
  /**
   * 집계와 「누가 아직 안 받았나」에 쓰는 **사람 단위** 목록(→ `currentByRecipient`).
   *
   * 🔴 화면에 그리지 마라. 이것은 목록이 아니라 **세는 데 쓰는 눈**이다. 반대로 미발송 인원을
   * 화면이 `items` 로 세면 한 사람이 두 명이 된다 — 이 필드를 내주는 이유가 그것이다.
   */
  current: T[];
};

/**
 * 이 줄이 「언제」로 세어질 시각.
 *
 * 성공은 `sentAt`, 실패는 `failedAt`, 둘 다 비어 있으면 마지막으로 손댄 때다. 목록 한 줄이
 * 쓰는 시각과 **같은 순서로** 골라야 한다(→ `app/sms/history.tsx` 의 `sentAtLabel`) — 한쪽만
 * 바뀌면 줄에 적힌 일시와 그 줄이 들어간 묶음의 일자가 어긋난다.
 *
 * 🔴 **기간 거르기(`withinPeriod`)도 반드시 이 함수를 쓴다.** 거르는 기준 시각과 묶는 기준
 * 시각이 갈리면 「목록에는 있는데 그 묶음이 없다」(또는 그 반대)가 된다 — 실패만 있는 줄
 * (`sentAt` 이 비고 `failedAt` 만 있는 줄)에서 제일 먼저 드러난다. 그래서 export 해 둔다.
 */
export const historyTime = (item: Timed) => item.sentAt || item.failedAt || item.updatedAt;

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
 * 대기 줄의 `id` 에 붙는 꼬리.
 *
 * 서버가 `_` 가 아니라 `#` 로 가른 이유가 있다 — 시도 id 는 `[A-Za-z0-9_-]` 만 쓸 수 있어
 * `#` 을 담지 못한다. 그래서 이 꼬리는 어떤 시도 id 와도 헷갈리지 않는다.
 */
const PENDING_SUFFIX = '#pending';

/**
 * 이 이력 줄이 가리키는 **캠페인 수신자 id**. 뽑을 수 없으면 `null`.
 *
 * 🔴 **`RecipientHistory` 에는 이 값을 담은 필드가 없다.** `recipientId` 는 수신자 **마스터**
 * id 라서 재발송에 넘기면 서버가 그 캠페인에서 아무도 찾지 못한다. 재발송이 요구하는 것은
 * 캠페인 안의 그 사람 줄 id 다(→ `lib/sms-runner.ts` 의 `retryRecipientIds`). 그래서 서버가
 * 만든 이력 줄 `id` 에서 되뽑는다:
 *
 * - 완료된 시도 줄: `{campaignId}_{campaignRecipientId}_{attemptId}`
 * - 아직 안 보낸 대기 줄: `{campaignId}_{campaignRecipientId}#pending`
 *
 * 규칙은 두 가지다. **앞은 `campaignId` 로 잘라 낸다**(줄이 그 값을 함께 들고 온다). **뒤는**
 * `#pending` 이면 통째로 떼고, 아니면 **첫 `_` 까지**가 캠페인 수신자 id 다 — 이 id 는
 * Firestore 가 만든 `[A-Za-z0-9]{20}` 이라 `_` 를 담지 않는 반면 시도 id 는 담을 수 있어서,
 * 뒤에서 자르면 시도 id 안의 `_` 에 걸려 엉뚱한 글자가 나온다.
 *
 * 🔴 **모양이 다르면 짐작하지 말고 `null` 이다.** 여기서 한 글자만 틀려도 「다시 보내기」가
 * **엉뚱한 사람에게 문자를 보낸다.** 확신이 없으면 버튼을 세우지 않는 편이 낫다.
 */
export function historyCampaignRecipientId(item: Pick<RecipientHistory, 'id'> & Partial<Pick<RecipientHistory, 'campaignId'>>): string | null {
  const campaignId = item.campaignId ?? '';
  const id = item.id ?? '';
  if (!campaignId || !id.startsWith(`${campaignId}_`)) return null;
  const rest = id.slice(campaignId.length + 1);
  if (rest.endsWith(PENDING_SUFFIX)) {
    const found = rest.slice(0, -PENDING_SUFFIX.length);
    return found && !found.includes('#') ? found : null;
  }
  const cut = rest.indexOf('_');
  const found = cut > 0 ? rest.slice(0, cut) : '';
  return found && !found.includes('#') ? found : null;
}

/**
 * 「아직 안 보낸 사람」의 대기 줄인가.
 *
 * 서버가 대기 줄로 내려보내는 상태는 `READY`(차례가 안 옴)와 `SENDING`(시도 id 조차 없어
 * 결과를 받을 길이 없는 줄) 둘뿐이다. 아래 `isNewer` 의 **동점 처리에만** 쓴다.
 */
const isWaitingRow = (item: Titled) => item.status === 'READY' || item.status === 'SENDING';

/**
 * 한 사람을 가리키는 키. 🔴 **수신자 id 만으로는 부족하고 캠페인까지 함께 본다.**
 *
 * 하루에 같은 템플릿을 두 번 보내면 두 발송이 한 묶음으로 들어온다(→ `groupSmsHistory`).
 * 거기서 수신자 id 만으로 접으면 20명에게 두 번 보낸 40건이 「성공 20」으로 **줄어든다.**
 * 접어야 하는 것은 **한 발송 안에서 같은 사람이 남긴 여러 줄**(지난 실패 + 지금 대기)뿐이다.
 *
 * ⚠️ 둘 중 하나라도 없으면(외부 발송 기록 등) `null` — 접지 않고 각각 한 사람으로 센다.
 * 누구인지 확신할 수 없는 줄을 남의 줄과 합치면 사람 수가 조용히 줄어든다.
 *
 * 길이를 앞에 적는 이유는 `historyGroupKey` 와 같다 — 값 안에 구분자가 들어와도 안 겹친다.
 */
function personKey(item: Titled): string | null {
  if (!item.campaignId || !item.recipientId) return null;
  return `${item.campaignId.length}|${item.campaignId}|${item.recipientId}`;
}

/**
 * 두 줄 중 어느 쪽이 그 사람의 「지금 상태」인가.
 *
 * 🔴 **시각이 같으면 대기 줄이 나중 것이다.** 재시도는 실패를 되돌려 놓는 일이라 실패 **뒤에**
 * 오고, 그러므로 그 사람의 지금 상태는 「대기」다. 두 줄의 시각이 같게 들어오는 일은 실제로
 * 생긴다 — 대기 줄이 시각으로 쓰는 `updatedAt` 이 되돌린 그 순간이라 실패 시각과 같은
 * 밀리초일 수 있다. 여기서 실패 줄을 골라 버리면 **재시도를 눌러 둔 사람이 「실패」로 남아
 * 미발송 수에서 빠지고**, 화면은 보내야 할 사람이 없다고 말한다.
 */
function isNewer(candidate: Titled, kept: Titled): boolean {
  const a = sortableTime(candidate);
  const b = sortableTime(kept);
  if (a !== b) return a > b;
  return isWaitingRow(candidate) && !isWaitingRow(kept);
}

/**
 * 집계에 쓸 **사람 단위** 목록. 같은 발송·같은 사람의 여러 줄에서 「지금 상태」 한 줄만 남긴다.
 *
 * 🔴 **화면 목록을 접는 함수가 아니다.** 목록(`items`)은 줄 단위 그대로 둔다 — 「지난 실패」도
 * 보여야 이력이고, 그 줄이 사라지면 사용자는 왜 그 사람이 다시 대기가 되었는지 알 수 없다.
 * 접는 것은 **세는 일**뿐이다.
 *
 * 접지 않고 세면 실패했다가 재시도로 대기가 된 한 사람이 「실패 1 · 미발송 1」 — **두 명**으로
 * 세어진다. 서버의 `total` 도 사람 수가 아니라 줄 수라, 믿고 쓰면 같은 자리에서 틀린다.
 *
 * 남는 순서는 **처음 만난 자리**다. 서버가 준 순서(최근 발송 순)를 흔들지 않기 위해서다.
 */
export function currentByRecipient<T extends Titled>(items: readonly T[]): T[] {
  const slot = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const key = personKey(item);
    if (key === null) { out.push(item); continue; }
    const found = slot.get(key);
    if (found === undefined) { slot.set(key, out.length); out.push(item); continue; }
    if (isNewer(item, out[found])) out[found] = item;
  }
  return out;
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
  type Building = Omit<SmsHistoryGroup<T>, 'counts' | 'current'> & { latest: number };
  const groups = new Map<string, Building>();
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
    .map(({ latest: _latest, ...group }) => {
      // 🔴 **세기 전에 사람 단위로 접는다.** `group.items` 를 그대로 세면 한 사람이 두 명이 된다.
      const current = currentByRecipient(group.items);
      return { ...group, current, counts: countOutcomes(current) };
    });
}

/**
 * 묶음 머리에 적을 결과 요약. 예: `성공 21 · 실패 3`.
 *
 * 🔴 **`status` 를 직접 세지 않는다.** 서버 `status` 는 `SENT|FAILED` 둘뿐이라, 통과·중단처럼
 * **사람이 일부러 안 보낸 것까지 전부 `FAILED`** 로 들어온다(→ `lib/sms-outcome.ts`). 그걸
 * 실패로 세면 「보내려다 안 간 것」과 「아예 안 보낸 것」이 한 칸에 섞여, 사용자가 무엇을 해야
 * 하는지 알 수 없게 된다. 발송 상세(`components/campaign-details.tsx`)가 이미 같은 모듈로
 * 같은 낱말을 쓴다 — ⚠️ **여기서 다르게 세면 같은 발송이 두 화면에서 다른 숫자로 보인다.**
 *
 * ⚠️ **0인 칸은 적지 않는다.** 전부 성공인 흔한 경우에 `성공 24 · 실패 0 · 미발송 0` 이 서면
 * 읽는 데 방해만 된다. 다 0이면(들어온 줄이 없는 경우) 빈 글자 대신 `0건` 으로 둔다 — 머리에
 * 아무 글자도 없는 묶음이 서는 것보다 낫다.
 */
const OUTCOME_LABELS: readonly (readonly [keyof OutcomeCounts, string])[] = [
  ['sent', '성공'],
  ['failed', '실패'],
  ['unsent', '미발송'],
  ['review', '확인 필요'],
];
export function outcomeSummary(counts: OutcomeCounts): string {
  const parts = OUTCOME_LABELS.filter(([key]) => counts[key] > 0).map(([key, label]) => `${label} ${counts[key]}`);
  return parts.length ? parts.join(' · ') : '0건';
}

/** 화면이 고를 수 있는 기간. `null` 은 「전체」다 — 거르지 않는다. */
export type HistoryPeriod = 1 | 3 | 6 | null;

/**
 * `months` 개월 전 같은 시각. 이 값이 기간의 **시작 경계**다(경계 자체는 포함).
 *
 * ⚠️ **`setMonth` 에 그냥 맡기면 말일에서 새어 나간다.** 3월 31일에서 1개월을 빼면 「2월 31일」
 * 이 되고 JS 는 이를 3월 3일로 넘긴다. 그러면 경계가 오히려 **뒤로 밀려** 2월 28일~3월 3일에
 * 보낸 발송이 「최근 1개월」에서 조용히 빠진다. 그래서 날짜를 그 달의 말일로 눌러 준다.
 */
function periodStart(now: Date, months: number): number {
  const month = now.getMonth() - months;
  // `new Date(연, 달+1, 0)` 은 그 달의 말일이다. 달이 음수여도 해가 알아서 뒤로 넘어간다.
  const lastDay = new Date(now.getFullYear(), month + 1, 0).getDate();
  const start = new Date(now.getTime());
  start.setFullYear(now.getFullYear(), month, Math.min(now.getDate(), lastDay));
  return start.getTime();
}

/**
 * 최근 `months` 개월 안의 줄만 남긴다.
 *
 * 🔴 **거르기를 화면에서 하지 않는 이유.** 기간 계산은 말일·시간대·기준 시각 고르기가 전부
 * 조용히 틀릴 수 있는 자리라, 화면 없이 `node --test` 로 고정한다(→ `tests/sms-history.test.cjs`).
 * `now` 를 인자로 받는 것도 그래서다 — 테스트가 「지금」을 정할 수 있어야 경계를 짚을 수 있다.
 *
 * ⚠️ **시각을 못 읽는 줄은 버리지 않고 남긴다.** 그 줄은 어느 기간에 속하는지 판단할 근거가
 * 없는데, 없는 셈 치면 사용자는 「전체」를 고르기 전까지 그 줄을 영원히 볼 수 없다. 묶기도 같은
 * 태도다(→ `historyDateKey`) — 감추는 것보다 원래 글자로 남는 편이 덜 거짓말한다.
 */
export function withinPeriod<T extends Timed>(items: readonly T[], months: HistoryPeriod, now: Date = new Date()): T[] {
  if (months == null) return [...items];
  const from = periodStart(now, months);
  return items.filter((item) => {
    const at = new Date(historyTime(item) ?? '').getTime();
    return Number.isNaN(at) || at >= from;
  });
}

/**
 * 「확인이 필요한 발송」으로 셀 상태.
 *
 * 🔴 **`status !== 'COMPLETED'` 로 적으면 안 된다.** 그렇게 적었던 동안 **중단(`CANCELLED`)
 * 캠페인이 미완료로 섞여 올라왔다** — 운영에서 멈춰 세운 발송을 취소 처리했더니 그 3건이 전부
 * 「확인 필요」로 떴다. 중단은 사용자가 이미 결론을 낸 것이라 손볼 일이 없다.
 *
 * ⚠️ **막아 두는 쪽이 아니라 들여보내는 쪽을 적는다.** 새 상태가 생겼을 때 여기 이름을 적지
 * 않으면 목록에 나타나지 않는다 — 조용히 섞여 드는 것보다, 새 상태를 다룰 때 이 자리를 반드시
 * 지나가게 하는 편이 안전하다.
 */
const NEEDS_ATTENTION: readonly CampaignStatus[] = [
  'READY', // 만들어 두고 아직 보내지 않았다 — 보내거나 지워야 한다.
  'SENDING', // 보내는 중에 멈췄을 수 있다 — 어디까지 나갔는지 확인해야 한다.
  'PARTIAL_FAILED', // 일부가 실패했다 — 실패한 사람만 다시 보내야 한다.
];

export function needsAttention(campaign: { status: CampaignStatus }): boolean {
  return NEEDS_ATTENTION.includes(campaign.status);
}
