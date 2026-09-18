import { writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { CallRecord } from '../../src/types/calls';

/**
 * 통화분석 — **서버 처리 흐름.**
 *
 * 앱이 하는 일은 셋뿐이다: 파일을 올리고(`upload-url` → `PUT` → `complete`), 상태를 묻고,
 * 결과를 보여 준다. 그래서 여기서 흉내 내는 것도 그 셋이다 — 기기 브리지는 더 이상 없다.
 */

const done: CallRecord = {
  call_id: 'call-1', contact: { name: '김영국', phone: '+821012345678' },
  call: { file_name: 'call.m4a', duration: 180, recorded_at: '2026-09-17T05:20:00Z' }, created_at: '2026-09-17T05:25:00Z',
  status: 'COMPLETED', progress: 1, job_state: 'COMPLETED', stage: '분석 완료', has_audio: true,
  summary: '도입 견적을 요청한 통화입니다.',
  // 🔴 재생 주소는 **상세에만** 실린다. 목록으로 내보낼 때 `listed` 가 걷는다.
  audio_url: 'https://storage.test/calls/call-1/audio.m4a?sig=play',
  ai: { model: 'qwen-plus', model_version: '1', provider: 'alibaba' },
  // 🔴 금액은 **서버가 원화로 계산해서** 준다 — 앱은 단가를 모른다. 정수로 반올림되어 오지도 않는다.
  cost: { currency: 'KRW', transcription: 96.4, analysis: 14.2, total: 110.6, usage: { audio_seconds: 1706, input_tokens: 17800, output_tokens: 2200, reasoning_tokens: 1024 } },
  transcript: { text: '견적서를 보내 주세요.', segments: [{ start: 0, end: 4, text: '견적서를 보내 주세요.' }] },
  analysis: { schema_version: 1, summary: '도입 견적을 요청한 통화입니다.', details: [{ title: '견적 문의', content: '도입 비용 견적서를 요청했습니다.' }], todos: [{ content: '견적서 전달', owner: null, due_date: null, source: '견적서를 보내 주세요.' }], decisions: [], consulting: { customer_needs: ['도입 비용 확인'], questions: [], concerns: [], objections: [], important_points: ['견적 요청'], followups: [] } },
};
/**
 * 목록 응답은 원문·분석·재생 주소·비용을 빼고 온다(§`internal/calls/model.go` 의 `listRecord`).
 *
 * 비용이 빠지는 이유는 금액의 근거인 사용량이 **작업 문서에만** 있어서다 — 목록에 실으려면
 * 한 페이지마다 작업 문서를 그만큼 더 읽어야 한다. 비용을 보여 주려고 조회 비용을 키우는 셈이다.
 */
function listed(record: CallRecord): CallRecord {
  const { transcript: _t, analysis: _a, audio_url: _u, cost: _c, ...rest } = record;
  return rest;
}

type Server = {
  /** 목록·상세가 돌려줄 통화. 테스트가 중간에 갈아 끼울 수 있다. */
  rows: Map<string, CallRecord>;
  /** 오간 요청의 기록. 순서를 확인하는 데 쓴다. */
  seen: string[];
  /** 목록 요청에 실려 온 조건. 서버가 거르는지, 커서를 언제 버리는지 확인한다. */
  lists: { q: string; limit: string | null; cursor: string | null }[];
  /** 서명 URL 의 PUT 을 붙잡아 둘지. 업로드 중 화면을 보려면 필요하다. */
  holdPut: boolean;
};

/**
 * 서버의 검색 규칙을 흉내 낸다(§`internal/calls/store.go`). 이름에 들어 있거나 전화번호
 * 뒷자리가 맞으면 통과다 — 앱의 `recipient-search.ts` 와 같은 규칙을 서버가 구현했다.
 */
function matches(q: string, record: CallRecord): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (record.contact.name.toLowerCase().includes(needle)) return true;
  const digits = record.contact.phone.replace(/\D/g, '');
  const wanted = needle.replace(/\D/g, '');
  return wanted.length > 0 && digits.endsWith(wanted);
}

async function installCalls(page: Page, server: Server) {
  // holdPut 이면 저장소 PUT 을 붙잡아 둔다(업로드 중 화면을 보려고). 페이지가 닫히면 함께 정리된다.
  const held: Route[] = [];
  await page.route(/\/calls(?:\?.*)?$/, (route) => {
    if (route.request().isNavigationRequest()) return route.fallback();
    const params = new URL(route.request().url()).searchParams;
    const q = params.get('q') ?? '';
    server.seen.push('list');
    server.lists.push({ q, limit: params.get('limit'), cursor: params.get('cursor') });
    return route.fulfill({ json: { items: [...server.rows.values()].filter((row) => matches(q, row)).map(listed), nextCursor: null } });
  });
  await page.route(/\/calls\/[^/?]+$/, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    server.seen.push(`get:${id}`);
    const row = server.rows.get(id);
    return row ? route.fulfill({ json: row }) : route.fulfill({ status: 404, json: { code: 'CALL_NOT_FOUND', message: '통화를 찾을 수 없어요' } });
  });
  // ① 서명 주소 발급. 🔴 `headers` 를 그대로 PUT 에 실어야 한다는 계약을 여기서 흉내 낸다.
  await page.route(/\/calls\/[^/]+\/audio\/upload-url$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[2];
    server.seen.push(`upload-url:${id}`);
    await route.fulfill({ json: { call_id: id, method: 'PUT', url: `https://storage.test/calls/${id}/audio.m4a?signature=abc`, headers: { 'Content-Type': 'audio/m4a' }, object: `calls/u/${id}/audio.m4a`, expires_at: '2026-09-18T15:00:00Z', max_bytes: 104857600, retention_days: 366 } });
  });
  // ② 앱 → 저장소 직접. 서버를 거치지 않는다.
  await page.route('https://storage.test/**', async (route) => {
    server.seen.push(`put:${route.request().headers()['content-type']}`);
    if (server.holdPut) { held.push(route); return; }
    await route.fulfill({ status: 200, body: '' });
  });
  // ③ 큐잉. 이미 큐에 있으면 200 으로 현재 상태를 돌려준다.
  await page.route(/\/calls\/[^/]+\/audio\/complete$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[2];
    server.seen.push(`complete:${id}`);
    const queued: CallRecord = { call_id: id, contact: { name: '새통화', phone: '+821000000000' }, call: { file_name: 'call.m4a', duration: null, recorded_at: '2026-09-18T05:00:00Z' }, created_at: new Date().toISOString(), status: 'PREPARING', progress: 0.05, job_state: 'QUEUED', stage: '업로드 완료, 순서 기다리는 중', has_audio: true };
    server.rows.set(id, queued);
    await route.fulfill({ json: queued });
  });
  await page.route(/\/calls\/[^/]+\/reanalyze$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[2];
    server.seen.push(`reanalyze:${id}`);
    const current = server.rows.get(id)!;
    const again: CallRecord = { ...current, status: 'ANALYZING', progress: 0.8, job_state: 'ANALYZING', stage: '내용 정리하는 중', error: null };
    server.rows.set(id, again);
    await route.fulfill({ json: again });
  });
}

function server(rows: CallRecord[] = [done]): Server {
  return { rows: new Map(rows.map((row) => [row.call_id, row])), seen: [], lists: [], holdPut: false };
}

const isMobile = () => test.info().project.name === 'mobile';

/**
 * 간단뷰(기본)의 접히는 줄.
 *
 * 한 줄에 서는 것은 **통화일시 · 이름 · 상태**뿐이고, 줄의 접근성 이름은 그 셋에 「펼치기/
 * 접기」를 붙인 말이다. 일시는 기기 시간대에 따라 달라지므로 형태만 맞춘다 — 테스트가 도는
 * 기계의 시간대를 가정하면 CI 에서만 깨진다.
 */
function briefRow(page: Page, name: string) {
  return page.getByRole('button', { name: new RegExp(`^\\d{2}\\.\\d{2}\\.\\d{2} (오전|오후) \\d{1,2}:\\d{2} ${name} .+ (펼치기|접기)$`) });
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill('call@example.com');
  await page.getByLabel('비밀번호', { exact: true }).fill('test-pass');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '메뉴 열기' })).toBeVisible();
  await page.goto('/calls');
}

test.beforeEach(async ({ page }) => {
  await page.route('**/auth/login', route => route.fulfill({ json: { accessToken: 'a', refreshToken: 'r', expiresInSec: 3600, mustChangePassword: false } }));
  await page.route('**/sms/campaigns?*', route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route('**/sms/templates?*', route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route('**/users/me', route => route.fulfill({ json: { userId: 'call-test', email: 'call@example.com', userName: '통화 사용자', mustChangePassword: false, createdAt: done.created_at } }));
  await page.route(/\/recipients(?:\?.*)?$/, route => route.request().isNavigationRequest() ? route.fallback() : route.fulfill({ json: { items: [], nextCursor: null } }));
});

// 이 기록에는 상세 내용·할 일·상담 분석이 모두 들어 있다(서버 분석이 채운 모양이다).
// 내용이 있으면 그 탭이 그대로 보여야 한다.
test('내용이 있는 분석은 상세·할 일·상담 분석 탭까지 보여 준다', async ({ page }) => {
  await installCalls(page, server());
  await login(page);
  await expect(page.getByText('김영국', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '이름 또는 폰번호 뒷4자리', exact: true }).fill('없는 이름');
  await expect(page.getByText('검색어에 해당하는 통화가 없습니다.')).toBeVisible();
  await page.getByRole('textbox', { name: '이름 또는 폰번호 뒷4자리', exact: true }).fill('김영');
  // 분석을 여는 길은 줄을 펼친 뒤다 — 목록은 한 줄만 세운다.
  await briefRow(page, '김영국').click();
  await page.getByRole('button', { name: '김영국 분석 보기' }).click();
  await expect(page.getByRole('tab', { name: '통화 요약', exact: true })).toHaveAttribute('aria-selected', 'true');
  // 어떤 AI 가 만들었는지는 결과를 의심할 때 첫 단서다.
  await expect(page.getByText('분석: alibaba · qwen-plus')).toBeVisible();
  await page.getByRole('tab', { name: '상세 내용' }).click();
  await expect(page.getByText('도입 비용 견적서를 요청했습니다.')).toBeVisible();
  await page.getByRole('tab', { name: '할 일' }).click();
  await expect(page.getByText('☐ 견적서 전달')).toBeVisible();
  await page.getByRole('tab', { name: '상담 분석' }).click();
  await expect(page.getByText('• 도입 비용 확인')).toBeVisible();
  await page.getByRole('tab', { name: '통화 원문' }).click();
  await expect(page.getByText('견적서를 보내 주세요.', { exact: true })).toBeVisible();
});

/**
 * 🔴 **비용은 「합계」가 아니라 「받아쓰기와 분석」으로 보인다.**
 *
 * 이 파이프라인은 돈의 대부분이 받아쓰기에 나간다. 합계 한 줄만 적으면 그 사실이 가려져서
 * 「비싸다」까지는 알아도 **어느 단계를 바꿔야 싸지는지**는 알 수 없다 — 이 화면을 만든 이유가
 * 공급자를 바꿀지 판단하는 것이라, 나누지 않으면 화면이 목적을 잃는다.
 *
 * 금액은 서버가 원화로 계산해서 준다. 앱은 단가를 모르고 관례대로 적기만 한다.
 */
test('비용을 아는 통화는 받아쓰기와 분석을 나눠 보여 준다', async ({ page }) => {
  await installCalls(page, server());
  await login(page);
  await briefRow(page, '김영국').click();
  await page.getByRole('button', { name: '김영국 분석 보기' }).click();
  // 96.4원 → 96원, 14.2원 → 14원, 110.6원 → 111원. 원 단위 아래는 읽는 사람에게 쓸모가 없다.
  await expect(page.getByText('비용: 받아쓰기 96원 · 분석 14원 (합계 111원)')).toBeVisible();
  // 어떤 AI 로 이만큼 썼는지를 나란히 봐야 판단이 된다.
  await expect(page.getByText('분석: alibaba · qwen-plus')).toBeVisible();
});

/**
 * 🔴 **1원 미만을 「0원」으로 적지 않는다.** 공짜로 읽히기 때문이다.
 *
 * 서버는 정수로 반올림하지 않고 내려보낸다(§`internal/calls/cost.go` 의 `won`). 그 값을 앱이
 * 0원으로 뭉개면, 화면을 보고 「이 단계는 돈이 안 든다」고 판단하게 된다 — 실제로는 들었다.
 */
test('1원이 안 되는 비용은 소수점을 남겨 공짜로 읽히지 않게 한다', async ({ page }) => {
  const tiny: CallRecord = {
    ...done, call_id: 'call-tiny', contact: { name: '최짧게', phone: '+821044445555' },
    cost: { currency: 'KRW', transcription: 0.42, analysis: 0.03, total: 0.45, usage: { audio_seconds: 4, input_tokens: 30, output_tokens: 8, reasoning_tokens: 0 } },
  };
  await installCalls(page, server([tiny]));
  await login(page);
  await briefRow(page, '최짧게').click();
  await page.getByRole('button', { name: '최짧게 분석 보기' }).click();
  await expect(page.getByText('비용: 받아쓰기 0.42원 · 분석 0.03원 (합계 0.45원)')).toBeVisible();
});

/**
 * 🔴 **모르는 비용은 0원이 아니라 아무것도 아니다.**
 *
 * 서버가 `cost` 를 안 보내는 경우는 셋이고 전부 정상이다: 단가 설정이 없거나, 사용량이 없는
 * 옛 통화이거나, 기기 분석 시절 기록이다. 그때 「0원」을 그리면 **돈이 안 들었다는 거짓말**이
 * 된다 — 이 숫자는 공급자를 바꿀지 판단하는 근거라 거짓말 한 줄이 판단을 통째로 뒤집는다.
 */
test('비용을 모르는 옛 통화는 0원이 아니라 비용 칸 자체를 그리지 않는다', async ({ page }) => {
  const { cost: _gone, ...unknown } = done;
  await installCalls(page, server([{ ...unknown, call_id: 'call-old', contact: { name: '박옛날', phone: '+821011112222' } }]));
  await login(page);
  await briefRow(page, '박옛날').click();
  await page.getByRole('button', { name: '박옛날 분석 보기' }).click();
  // 나머지는 그대로 보인다 — 비용만 모르는 것이지 분석이 실패한 것이 아니다.
  // 비용 줄이 서는 자리가 바로 이 줄 아래라, 이것이 보이는데 비용이 없으면 걷힌 것이 맞다.
  await expect(page.getByText('분석: alibaba · qwen-plus')).toBeVisible();
  await expect(page.getByText(/^비용: /)).toHaveCount(0);
  // 🔴 「0원」이 어디에도 없어야 한다. 공짜로 읽히는 한 줄이 이 화면의 목적을 뒤집는다.
  await expect(page.getByText(/0원/)).toHaveCount(0);
});

/**
 * 🔴 **간단뷰는 목록이 먼저다.**
 *
 * 모든 줄을 펴 두면 진행 중인 통화 두세 건만으로 한 화면이 차서 「언제 누구와 통화했나」를
 * 훑을 수가 없다. 한 줄에는 통화일시·이름·상태만 세우고 나머지는 누른 줄에서만 편다
 * (발송 이력과 같은 규칙 — §`components/campaign-history-sheet.tsx`).
 */
test('간단뷰는 한 줄만 세우고 누른 줄을 펼쳤다 다시 눌러 접는다', async ({ page }) => {
  await installCalls(page, server());
  await login(page);
  const row = briefRow(page, '김영국');
  await expect(row).toBeVisible();
  // 한 줄에 서는 것은 셋뿐이다. 나머지는 접혀 있다.
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('010-1234-5678', { exact: true })).toHaveCount(0);
  await expect(page.getByText('3분 00초', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '김영국 분석 보기' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '김영국 통화 요약 보기' })).toHaveCount(0);
  // 누르면 그 줄 아래로 펼쳐진다 — 지금까지 목록이 보여 주던 것이 전부 이 안에 있다.
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('010-1234-5678', { exact: true })).toBeVisible();
  // 통화시간과 ▶ 는 한 칸에 선다(180초 = 3분 00초).
  await expect(page.getByText('3분 00초', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '김영국 분석 보기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '김영국 통화 요약 보기' })).toBeVisible();
  // 🔴 목록이 아는 것은 `has_audio` 뿐이다. 주소는 패널이 상세를 물어본 뒤 받는다.
  const listen = page.getByRole('button', { name: '김영국 녹음 듣기', exact: true });
  await expect(listen).toBeEnabled();
  await listen.click();
  await expect(page.locator('audio')).toHaveAttribute('src', /storage\.test/);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  // 같은 줄을 다시 누르면 닫힌다.
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('3분 00초', { exact: true })).toHaveCount(0);
});

// 한 번에 하나만 편다. 여러 줄이 펼쳐지면 목록으로 되돌린 이유가 사라진다.
test('다른 줄을 누르면 앞서 펼친 줄이 닫힌다', async ({ page }) => {
  const other: CallRecord = { ...done, call_id: 'call-b', contact: { name: '이둘째', phone: '+821022223333' }, call: { ...done.call, duration: 65, recorded_at: '2026-09-17T01:00:00Z' } };
  await installCalls(page, server([done, other]));
  await login(page);
  await briefRow(page, '김영국').click();
  await expect(page.getByText('010-1234-5678', { exact: true })).toBeVisible();
  await briefRow(page, '이둘째').click();
  await expect(page.getByText('010-2222-3333', { exact: true })).toBeVisible();
  await expect(page.getByText('010-1234-5678', { exact: true })).toHaveCount(0);
  await expect(briefRow(page, '김영국')).toHaveAttribute('aria-expanded', 'false');
});

/**
 * 전체정보뷰는 **접지 않는다** — 「자세히 보겠다」고 고른 화면에서 다시 눌러 펴게 하면
 * 고른 의미가 없다. 넓은 화면에서는 열로, 폰에서는 줄로 쌓아 같은 값을 모두 보인다.
 */
test('전체정보뷰는 모든 칸을 편 채 보여 주고 넓은 화면에서는 열로 세운다', async ({ page }) => {
  await installCalls(page, server());
  await login(page);
  await page.getByRole('button', { name: '전체정보뷰', exact: true }).click();
  // 접히는 줄 자체가 사라진다.
  await expect(briefRow(page, '김영국')).toHaveCount(0);
  await expect(page.getByText('010-1234-5678', { exact: true })).toBeVisible();
  await expect(page.getByText('3분 00초', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '김영국 분석 보기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '김영국 통화 요약 보기' })).toBeVisible();
  // 표 머리글은 넓은 화면에만 선다. 폰에서 가로 스크롤은 한 손으로 쓰기 어렵다.
  for (const column of ['통화일시', '이름', '전화번호', '통화시간', '상태', '요약 한 줄']) {
    await expect(page.getByText(column, { exact: true })).toHaveCount(isMobile() ? 0 : 1);
  }
  await page.getByRole('button', { name: '간단뷰', exact: true }).click();
  await expect(briefRow(page, '김영국')).toBeVisible();
  await expect(page.getByRole('button', { name: '김영국 통화 요약 보기' })).toHaveCount(0);
});

// 원본이 보관 기간을 지나 지워지면 `has_audio` 가 오지 않는다. **실패가 아니다** —
// 요약과 원문은 그대로 남으므로 그 사실만 말하고 버튼을 잠근다.
test('원본이 없는 통화는 재생 버튼을 잠그고 이유를 말한다', async ({ page }) => {
  const { has_audio: _gone, audio_url: _url, ...noAudio } = done;
  await installCalls(page, server([{ ...noAudio, call_id: 'call-old', contact: { name: '박옛날', phone: '+821011112222' }, ai: { model: 'qwen', model_version: '1', processed_on_device: true } }]));
  await login(page);
  await briefRow(page, '박옛날').click();
  const listen = page.getByRole('button', { name: /^박옛날 녹음 듣기 · / });
  await expect(listen).toBeVisible();
  await expect(listen).toBeDisabled();
  await expect(listen).toHaveAccessibleName(/기기에서 분석한 옛 통화라 서버에 원본 녹음이 없습니다/);
});

test('서버가 처리 중인 통화는 단계와 서버 문구·전체 진행률을 보여 준다', async ({ page }) => {
  const running: CallRecord = {
    call_id: 'call-2', contact: { name: '이진행', phone: '+821099998888' },
    call: { file_name: 'live.m4a', duration: null, recorded_at: '2026-09-17T04:00:00Z' },
    created_at: new Date(Date.now() - 192_000).toISOString(),
    status: 'TRANSCRIBING', progress: 0.4, job_state: 'ASR_POLLING', stage: '받아쓰는 중', has_audio: true,
  };
  const state = server([running]);
  await installCalls(page, state);
  await login(page);
  await expect(page.getByText('이진행', { exact: true })).toBeVisible();
  // 단계 카드는 펼친 줄에만 선다. 접힌 줄은 상태 한 낱말로 말한다.
  await expect(page.getByText('음성 변환 중', { exact: true })).toBeVisible();
  await expect(page.getByText('받아쓰는 중', { exact: true })).toHaveCount(0);
  await briefRow(page, '이진행').click();
  // 네 단계: 업로드는 끝났고(서버에 기록이 있다는 것이 그 증거다), 음성 변환이 돈다.
  await expect(page.getByText('업로드', { exact: true })).toBeVisible();
  await expect(page.getByText('음성 변환', { exact: true })).toBeVisible();
  await expect(page.getByText('받아쓰는 중', { exact: true })).toBeVisible();
  await expect(page.getByText(/^진행 중 · 3분 \d{2}초 경과 · 40%$/)).toBeVisible();
  // 🔴 서버 진행률은 0~1 이다. 40% 로 읽혀야 한다(0.4 를 그대로 그리면 0% 로 멈춰 보인다).
  await expect(page.getByRole('progressbar', { name: '전체 진행률 40%' })).toHaveAttribute('aria-valuenow', '40');
  await expect(page.getByText('예정', { exact: true }).first()).toBeVisible();
  // 폴링(5초)이 상세를 다시 물어 단계를 갱신한다. 목록을 통째로 다시 받지 않는다.
  state.rows.set('call-2', { ...running, status: 'ANALYZING', progress: 0.8, job_state: 'ANALYZING', stage: '내용 정리하는 중' });
  await expect(page.getByText('내용 정리하는 중', { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(state.seen.filter((entry) => entry === 'get:call-2').length).toBeGreaterThan(0);
  // 🔴 펼친 줄은 폴링으로 목록이 갱신돼도 **열린 채** 남는다(펼침을 `call_id` 로 들고 있다).
  await expect(briefRow(page, '이진행')).toHaveAttribute('aria-expanded', 'true');
  // 끝난 뒤에는 폴링이 멈춘다.
  state.rows.set('call-2', { ...running, status: 'COMPLETED', progress: 1, job_state: 'COMPLETED', stage: '분석 완료', summary: '끝났습니다.' });
  await expect(page.getByRole('button', { name: '이진행 분석 보기' })).toBeVisible({ timeout: 15_000 });
  await expect(briefRow(page, '이진행')).toHaveAttribute('aria-expanded', 'true');
  const settled = state.seen.length;
  await page.waitForTimeout(7_000);
  expect(state.seen.length).toBe(settled);
});

/**
 * 🔴 **접힌 줄도 살아 있다.**
 *
 * 폴링은 화면이 무엇을 펼쳤는지 보지 않고 `isActive` 인 통화를 묻는다 — 접힌 줄을 폴링에서
 * 빼면 사용자가 열어 보기 전까지 「음성 변환 중」이 영원히 그대로 남는다.
 */
test('접힌 줄도 폴링으로 상태가 갱신된다', async ({ page }) => {
  const running: CallRecord = {
    call_id: 'call-8', contact: { name: '박접힘', phone: '+821044445555' },
    call: { file_name: 'live.m4a', duration: null, recorded_at: '2026-09-17T04:00:00Z' },
    created_at: new Date(Date.now() - 60_000).toISOString(),
    status: 'TRANSCRIBING', progress: 0.4, job_state: 'ASR_POLLING', stage: '받아쓰는 중', has_audio: true,
  };
  const state = server([running]);
  await installCalls(page, state);
  await login(page);
  const row = briefRow(page, '박접힘');
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(row).toHaveAccessibleName(/ 박접힘 음성 변환 중 펼치기$/);
  // 한 번도 펼치지 않았는데도 상태가 따라온다.
  state.rows.set('call-8', { ...running, status: 'ANALYZING', progress: 0.8, job_state: 'ANALYZING', stage: '내용 정리하는 중' });
  await expect(row).toHaveAccessibleName(/ 박접힘 분석 중 펼치기$/, { timeout: 15_000 });
  state.rows.set('call-8', { ...running, status: 'COMPLETED', progress: 1, job_state: 'COMPLETED', stage: '분석 완료', summary: '끝났습니다.' });
  await expect(row).toHaveAccessibleName(/ 박접힘 분석 완료 펼치기$/, { timeout: 15_000 });
  expect(state.seen.filter((entry) => entry === 'get:call-8').length).toBeGreaterThan(0);
});

test('분석이 실패한 통화는 이유·코드를 보이고 재분석을 부른다', async ({ page }) => {
  const failed: CallRecord = {
    call_id: 'call-3', contact: { name: '최실패', phone: '+821077776666' },
    call: { file_name: 'broken.m4a', duration: 120, recorded_at: '2026-09-17T03:00:00Z' }, created_at: '2026-09-17T03:10:00Z',
    status: 'ANALYSIS_FAILED', progress: 0.8, job_state: 'ANALYSIS_FAILED', stage: '내용 정리에 실패했어요', has_audio: true,
    error: 'DataInspectionFailed',
    transcript: { text: '다음 주에 다시 연락드리겠습니다.', segments: [{ start: 0, end: 3, text: '다음 주에 다시 연락드리겠습니다.' }] },
  };
  const state = server([failed]);
  await installCalls(page, state);
  await login(page);
  // 접힌 줄은 「분석 실패」한 낱말로 말하고, 이유와 코드는 펼친 칸에 있다.
  await expect(briefRow(page, '최실패')).toHaveAccessibleName(/ 최실패 분석 실패 펼치기$/);
  await briefRow(page, '최실패').click();
  // 🔴 뜻을 모르는 공급자 코드라도 **코드는 보여 준다.** 이것이 없으면 다음에도 추측뿐이다.
  await expect(page.getByText(/코드: DataInspectionFailed/)).toHaveCount(1);
  await expect(page.getByText('멈춤', { exact: true })).toBeVisible();
  // 저장된 원문은 상세에서 그대로 볼 수 있다.
  await page.getByRole('button', { name: '저장된 원문 보기' }).click();
  await expect(page.getByText('다음 주에 다시 연락드리겠습니다.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '통화 요약', exact: true }).click();
  await expect(page.getByText(/코드: DataInspectionFailed\) 목록에서 다시 시도하면/)).toBeVisible();
  // 분석이 없으면 요약과 원문 말고 누를 탭이 없다. 빈 탭을 띄워 두고 헛걸음시키지 않는다.
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  // 다시 시도는 `reanalyze` 다 — 오디오를 다시 전사하지 않고 분석만 다시 돈다.
  await page.getByRole('button', { name: '분석 다시 시도' }).click();
  await expect(page.getByText('내용 정리하는 중', { exact: true })).toBeVisible();
  expect(state.seen).toContain('reanalyze:call-3');
});

/**
 * 🔴 **다시 눌러도 같은 실패에는 버튼을 세우지 않는다.**
 *
 * 서버 v0.1.4 는 종료 상태에서 왜 멈췄는지를 코드로 말한다(§`internal/calls/pipeline.go` 의
 * `userCode`). 그중 `BUDGET_TOO_SMALL` 은 **우리가 고쳐야 하는 실패**라 사용자가 몇 번을
 * 눌러도 같은 자리에서 멈춘다 — 「분석 다시 시도」를 세워 두면 요금만 나가고 결과는 같다.
 * 반대로 `RETRIES_EXHAUSTED` 는 서버가 자동 시도를 다 쓴 것뿐이라 사람이 한 번 더 돌릴
 * 길은 남아 있어야 한다. 이 둘이 같은 화면에서 다르게 보이는 것을 여기서 고정한다.
 */
test('서버가 고쳐야 할 실패에는 다시 시도 버튼이 서지 않고, 시도를 다 쓴 실패에는 선다', async ({ page }) => {
  const base = {
    contact: { name: '박예산', phone: '+821033334444' },
    call: { file_name: 'long.m4a', duration: 1500, recorded_at: '2026-09-17T01:00:00Z' }, created_at: '2026-09-17T01:30:00Z',
    status: 'ANALYSIS_FAILED' as const, progress: 0.8, job_state: 'ANALYSIS_FAILED', stage: '내용 정리에 실패했어요', has_audio: true,
    transcript: { text: '이번 달 안에 결정하겠습니다.', segments: [{ start: 0, end: 3, text: '이번 달 안에 결정하겠습니다.' }] },
  };
  const state = server([
    { ...base, call_id: 'call-budget', error: 'BUDGET_TOO_SMALL' },
    { ...base, call_id: 'call-exhausted', contact: { name: '이소진', phone: '+821033335555' }, error: 'RETRIES_EXHAUSTED' },
  ]);
  await installCalls(page, state);
  await login(page);

  await briefRow(page, '박예산').click();
  // 무엇이 잘못됐는지와 **고칠 사람이 우리라는 것**을 말한다. 기다리라는 말은 하지 않는다.
  await expect(page.getByText(/서버에 정해 둔 시간이 모자랍니다\. 다시 시도해도 같으니 저희가 고쳐야 합니다\. \(코드: BUDGET_TOO_SMALL\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: '분석 다시 시도' })).toHaveCount(0);
  // ⚠️ 버튼이 없다고 원문까지 잠그지는 않는다 — 받아쓰기는 끝난 통화다.
  await expect(page.getByRole('button', { name: '저장된 원문 보기' })).toBeVisible();
  // 상세의 요약 탭도 있지도 않은 버튼을 찾아가라고 말하지 않는다.
  await page.getByRole('button', { name: '저장된 원문 보기' }).click();
  await page.getByRole('tab', { name: '통화 요약', exact: true }).click();
  await expect(page.getByText(/\(코드: BUDGET_TOO_SMALL\)/).first()).toBeVisible();
  await expect(page.getByText(/목록에서 다시 시도하면/)).toHaveCount(0);
  await page.getByRole('button', { name: '닫기', exact: true }).click();

  // 한 줄에 하나만 펴진다 — 이 줄을 펴면 위 통화는 저절로 접힌다.
  await briefRow(page, '이소진').click();
  await expect(page.getByText(/서버가 여러 번 다시 시도했지만 끝내 실패했습니다\. \(코드: RETRIES_EXHAUSTED\)/)).toBeVisible();
  // 자동 재시도를 다 쓴 뒤 사람이 판단해 다시 돌리는 길은 남는다.
  await page.getByRole('button', { name: '분석 다시 시도' }).click();
  await expect(page.getByText('내용 정리하는 중', { exact: true })).toBeVisible();
  expect(state.seen).toContain('reanalyze:call-exhausted');
});

// 받아쓰기가 실패한 통화에는 다시 분석할 원문이 없다. 서버가 409 로 거절할 버튼을 세워 두지 않는다.
test('받아쓰기가 실패한 통화는 다시 등록하라고만 말한다', async ({ page }) => {
  await installCalls(page, server([{
    call_id: 'call-7', contact: { name: '한전사', phone: '+821055556666' },
    call: { file_name: 'noise.m4a', duration: null, recorded_at: '2026-09-17T02:00:00Z' }, created_at: '2026-09-17T02:05:00Z',
    status: 'TRANSCRIPTION_FAILED', progress: 0.4, job_state: 'TRANSCRIPTION_FAILED', stage: '받아쓰기에 실패했어요', error: 'EMPTY_TRANSCRIPT',
  }]));
  await login(page);
  await briefRow(page, '한전사').click();
  await expect(page.getByText(/녹음에서 사람 말소리를 찾지 못했습니다\. \(코드: EMPTY_TRANSCRIPT\)/)).toBeVisible();
  await expect(page.getByText('다른 녹음 파일로 다시 등록해 주세요.')).toBeVisible();
  await expect(page.getByRole('button', { name: '분석 다시 시도' })).toHaveCount(0);
});

/** 등록 한 번. 세 걸음이 **순서대로** 일어나야 한다. */
test('파일을 고르면 업로드 주소를 받아 저장소에 올리고 등록을 마친다', async ({ page }) => {
  const state = server([]);
  await installCalls(page, state);
  await login(page);
  await page.getByRole('button', { name: '통화분석 등록하기', exact: true }).click();
  await page.getByLabel('통화파일 불러오기', { exact: true }).setInputFiles({ name: 'call.m4a', mimeType: 'audio/x-m4a', buffer: Buffer.alloc(2_000_000, 7) });
  await expect(page.getByText('call.m4a · 2.0 MB')).toBeVisible();
  await page.getByRole('button', { name: '직접 입력', exact: true }).click();
  await page.getByLabel('통화 상대 이름', { exact: true }).fill('새통화');
  await page.getByLabel('통화 상대 전화번호', { exact: true }).fill('021234567');
  await page.getByRole('button', { name: '등록하기', exact: true }).click();
  // 등록이 끝나면 시트가 닫히고 목록에 그 통화가 선다.
  await expect(page.getByText('새통화', { exact: true })).toBeVisible();
  // 새 줄도 접힌 채로 선다. 서버가 보낸 한 줄은 펼쳐야 나온다.
  await expect(briefRow(page, '새통화')).toHaveAccessibleName(/ 새통화 분석 준비 펼치기$/);
  await briefRow(page, '새통화').click();
  await expect(page.getByText('업로드 완료, 순서 기다리는 중', { exact: true })).toBeVisible();
  const flow = state.seen.filter((entry) => !entry.startsWith('get:') && entry !== 'list');
  expect(flow[0]).toMatch(/^upload-url:/);
  // 🔴 브라우저가 알려 준 `audio/x-m4a` 가 아니라 **서버가 서명에 쓴 값**을 실어야 한다.
  expect(flow[1]).toBe('put:audio/m4a');
  expect(flow[2]).toMatch(/^complete:/);
  // 업로드 주소를 받은 ID 와 큐잉한 ID 가 같아야 한다(객체 경로가 ID 로 정해진다).
  expect(flow[0].slice('upload-url:'.length)).toBe(flow[2].slice('complete:'.length));
});

test('업로드 중에는 진행 막대와 취소가 서고, 취소하면 그 사실을 말한다', async ({ page }) => {
  const state = server([]);
  state.holdPut = true;
  await installCalls(page, state);
  await login(page);
  await page.getByRole('button', { name: '통화분석 등록하기', exact: true }).click();
  await page.getByLabel('통화파일 불러오기', { exact: true }).setInputFiles({ name: 'call.m4a', mimeType: 'audio/x-m4a', buffer: Buffer.alloc(2_000_000, 7) });
  await page.getByRole('button', { name: '직접 입력', exact: true }).click();
  await page.getByLabel('통화 상대 이름', { exact: true }).fill('새통화');
  await page.getByLabel('통화 상대 전화번호', { exact: true }).fill('021234567');
  await page.getByRole('button', { name: '등록하기', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: /^업로드 \d+%$/ })).toBeVisible();
  const cancel = page.getByRole('button', { name: '업로드 취소', exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(page.getByText('업로드를 취소했습니다.')).toBeVisible();
  // 취소했으므로 큐잉까지 가지 않는다.
  expect(state.seen.some((entry) => entry.startsWith('complete:'))).toBe(false);
});

// 100MB 를 올린 뒤에 400 을 받는 것이 가장 나쁘다. 고르는 자리에서 거른다.
test('서버가 받지 않을 파일은 고르는 자리에서 거른다', async ({ page }) => {
  await installCalls(page, server([]));
  await login(page);
  await page.getByRole('button', { name: '통화분석 등록하기', exact: true }).click();
  await page.getByLabel('통화파일 불러오기', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') });
  await expect(page.getByText('지원하지 않는 형식의 녹음 파일입니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '등록하기', exact: true })).toBeDisabled();
});

/**
 * 폰 폭에서 시트 하나에 **파일 선택 → 상대 선택 → 통화일시 → 등록하기**가 모두 들어와야
 * 한다. 수신자를 그대로 쌓던 때는 아래 둘이 화면 밖으로 밀려 스크롤하지 않으면 보이지 않았다.
 */
test('폰 폭에서 등록 시트에 통화일시와 등록하기가 함께 보인다', async ({ page }) => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `r-${i}`, name: `수신자${i}`, phone: `+8210111122${String(i).padStart(2, '0')}`, groupId: '', customFields: [], sentCount: 0, createdAt: done.created_at, updatedAt: done.created_at }));
  await page.route(/\/recipients(?:\?.*)?$/, route => route.request().isNavigationRequest() ? route.fallback() : route.fulfill({ json: { items: many, nextCursor: null } }));
  await installCalls(page, server([]));
  await page.setViewportSize({ width: 384, height: 832 });
  await login(page);
  const fab = page.getByRole('button', { name: '통화분석 등록하기', exact: true });
  await expect(fab).toBeInViewport();
  await fab.click();
  await expect(page.getByLabel('통화파일 불러오기', { exact: true })).toBeInViewport();
  // 검색하기 전에는 후보를 세우지 않는다 — 수신자가 많은 계정에서는 이름 더미가 될 뿐이다.
  await expect(page.getByRole('button', { name: /^수신자\d+ · / })).toHaveCount(0);
  await expect(page.getByText('이름 또는 폰번호 뒷4자리로 검색해 주세요.')).toBeVisible();
  // 스크롤하지 않아도 통화일시와 제출 버튼이 한 화면에 있다.
  await expect(page.getByLabel('통화일시', { exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '등록하기', exact: true })).toBeInViewport();
  // 같은 이름의 검색칸이 목록에도 있다(시트가 그 위에 뜬다). 뒤에 붙는 시트 쪽을 고른다.
  const search = page.getByRole('textbox', { name: '이름 또는 폰번호 뒷4자리', exact: true }).last();
  // 뒷4자리로도 같은 칸에서 찾는다(수신자1 +821011112201).
  await search.fill('2201');
  await expect(page.getByRole('button', { name: /^수신자\d+ · / })).toHaveCount(1);
  await search.fill('수신자');
  // 후보가 많으면 세 줄 높이 안에서만 스크롤한다. 뒤쪽 줄은 화면 밖으로 밀리지 않는다.
  await expect(page.getByRole('button', { name: /^수신자\d+ · / })).toHaveCount(12);
  await expect(page.getByRole('button', { name: /^수신자0 · / })).toBeInViewport();
  await expect(page.getByRole('button', { name: /^수신자11 · / })).not.toBeInViewport();
  await expect(page.getByLabel('통화일시', { exact: true })).toBeInViewport();
  await search.fill('수신자7');
  await page.getByRole('button', { name: /^수신자7 · / }).click();
  await expect(page.getByText(/^선택: 수신자7 · /)).toBeVisible();
  await expect(page.getByRole('button', { name: '등록하기', exact: true })).toBeInViewport();
});

// 파일 시각으로 통화일시를 채운다. 테스트가 도는 기기의 시간대를 가정하지 않기 위해 같은
// 시간대에서 기대값을 계산한다.
test('파일을 고르면 통화일시가 채워지고 값을 바꿀 수 있다', async ({ page }) => {
  await installCalls(page, server([]));
  await login(page);
  await page.getByRole('button', { name: '통화분석 등록하기', exact: true }).click();
  // 파일 시각은 **디스크의 수정 시각**에서 온다. 인메모리 버퍼로는 그 값을 정할 수 없어
  // 실제 파일을 만들어 시각을 박아 둔다.
  const fileTime = Date.now() - 2 * 60 * 60 * 1000;
  const path = join(tmpdir(), `nature-call-${process.pid}-${test.info().workerIndex}.m4a`);
  writeFileSync(path, Buffer.alloc(1024, 1));
  utimesSync(path, new Date(fileTime), new Date(fileTime));
  const picker = page.getByLabel('통화파일 불러오기', { exact: true });
  await picker.setInputFiles(path);
  const expected = await page.evaluate((at: number) => {
    const pad = (value: number) => String(value).padStart(2, '0');
    const date = new Date(at);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, fileTime);
  const field = page.getByLabel('통화일시', { exact: true });
  await expect(field).toHaveValue(expected);
  // 값을 눌러 고를 수 있어야 한다. 고른 값은 파일을 다시 골라도 덮어쓰지 않는다.
  await field.fill('2026-09-16T10:30');
  await expect(field).toHaveValue('2026-09-16T10:30');
  await picker.setInputFiles(path);
  await expect(field).toHaveValue('2026-09-16T10:30');
});

/**
 * 무한 스크롤. 서버가 `limit` 을 받으므로 한 화면을 **한 번에** 채운다 — 예전에는 30건 고정이라
 * 같은 화면을 두 번에 나눠 불렀다.
 */
test('목록은 limit 만큼 한 번에 받고 아래로 내리면 이어 붙인다', async ({ page }) => {
  const made = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => listed({ ...done, call_id: `${prefix}-${i}`, contact: { name: `${prefix}통화${i}`, phone: '+821012345678' }, call: { ...done.call, recorded_at: new Date(Date.parse('2026-09-17T05:20:00Z') - (prefix === 'a' ? 0 : 3_600_000) - i * 60_000).toISOString() } }));
  const asked: { limit: string | null; cursor: string | null }[] = [];
  await page.route(/\/calls(?:\?.*)?$/, route => {
    if (route.request().isNavigationRequest()) return route.fallback();
    const params = new URL(route.request().url()).searchParams;
    asked.push({ limit: params.get('limit'), cursor: params.get('cursor') });
    if (!params.get('cursor')) return route.fulfill({ json: { items: made('a', 50), nextCursor: 'p1' } });
    return route.fulfill({ json: { items: made('b', 10), nextCursor: null } });
  });
  await login(page);
  // 한 번에 50건. 예전처럼 30+30 으로 나눠 부르지 않는다.
  await expect(page.getByText('불러온 50건', { exact: true })).toBeVisible();
  expect(asked).toEqual([{ limit: '50', cursor: null }]);
  await expect(page.getByText('b통화0', { exact: true })).toHaveCount(0);
  // 바닥이 가까워지면 다음 묶음이 붙는다.
  await page.getByText('a통화49', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText('불러온 60건', { exact: true })).toBeVisible();
  await expect(page.getByText('b통화9', { exact: true })).toBeVisible();
  await expect(page.getByText('마지막 통화까지 모두 불러왔습니다.')).toBeVisible();
  expect(asked[1]).toEqual({ limit: '50', cursor: 'p1' });
});

// 🔴 거르기는 **서버가** 한다. 앱이 한 번 더 거르면 서버가 찾아 준 통화를 조용히 떨어뜨린다.
test('검색어는 서버로 보내고 앱은 받은 결과를 다시 거르지 않는다', async ({ page }) => {
  const asked: { q: string; limit: string | null }[] = [];
  await page.route(/\/calls(?:\?.*)?$/, route => {
    if (route.request().isNavigationRequest()) return route.fallback();
    const params = new URL(route.request().url()).searchParams;
    const q = params.get('q') ?? '';
    asked.push({ q, limit: params.get('limit') });
    // 앱의 규칙만 보면 「5678」에 걸리지 않을 이름이다. 서버가 줬으면 그대로 보여야 한다 —
    // 매칭 규칙의 정본은 서버이고, 앱이 한 번 더 거르면 그 차이만큼 결과가 조용히 사라진다.
    const found = q ? [listed({ ...done, call_id: 'call-9', contact: { name: '서버가찾아준사람', phone: '+821000001111' } })] : [listed(done)];
    return route.fulfill({ json: { items: found, nextCursor: null } });
  });
  await login(page);
  await expect(page.getByText('김영국', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '이름 또는 폰번호 뒷4자리', exact: true }).fill('5678');
  await expect(page.getByText('서버가찾아준사람', { exact: true })).toBeVisible();
  await expect(page.getByText('김영국', { exact: true })).toHaveCount(0);
  const search = asked.filter((entry) => entry.q);
  // 🔴 타이핑마다 부르지 않는다 — 네 글자를 쳤는데 요청이 네 번 나가면 그만큼 서버가 문서를 훑는다.
  expect(search.length).toBe(1);
  expect(search[0]).toEqual({ q: '5678', limit: '50' });
  expect(asked[0]).toEqual({ q: '', limit: '50' });
});

test('검색어가 바뀌면 커서를 버리고 처음부터 받는다', async ({ page }) => {
  const asked: { q: string; cursor: string | null }[] = [];
  await page.route(/\/calls(?:\?.*)?$/, route => {
    if (route.request().isNavigationRequest()) return route.fallback();
    const params = new URL(route.request().url()).searchParams;
    const q = params.get('q') ?? '';
    const cursor = params.get('cursor');
    asked.push({ q, cursor });
    const row = q === '박'
      ? listed({ ...done, call_id: 'call-p', contact: { name: '박검색', phone: '+821011112222' } })
      : listed(done);
    // 첫 장에는 커서를 남긴다. 검색어가 바뀔 때 이 커서를 그대로 보내면 서버는 400 을 준다
    // (커서 안에 그 검색어가 들어 있다 — §`internal/calls/store.go` 의 `cursorData.Q`).
    return route.fulfill({ json: { items: [row], nextCursor: cursor ? null : `c-${q}` } });
  });
  await login(page);
  await expect(page.getByText('김영국', { exact: true })).toBeVisible();
  const box = page.getByRole('textbox', { name: '이름 또는 폰번호 뒷4자리', exact: true });
  await box.fill('김');
  await expect(page.getByText(/^검색 결과 \d+건/)).toBeVisible();
  await box.fill('박');
  await expect(page.getByText('박검색', { exact: true })).toBeVisible();
  // 검색어별 **첫 요청**에는 커서가 붙지 않는다. 이어 받는 요청만 그 검색어의 커서를 쓴다.
  for (const q of ['', '김', '박']) {
    const mine = asked.filter((entry) => entry.q === q);
    expect(mine.length, `q=${q} 요청이 있어야 한다`).toBeGreaterThan(0);
    expect(mine[0].cursor, `q=${q} 의 첫 요청에는 커서가 없어야 한다`).toBeNull();
    for (const entry of mine.slice(1)) expect(entry.cursor).toBe(`c-${q}`);
  }
});

/**
 * 🔴 **0건 + 커서는 정상 응답이다.** 서버가 스캔 상한(300건)에 걸리면 찾은 만큼만 주고
 * 커서를 남긴다. 그대로 그리면 「결과 없음」이 뜨고 목록이 짧아 스크롤도 안 생기므로 다음
 * 요청이 영영 나가지 않는다 — 앱이 스스로 이어 불러야 한다.
 */
test('검색 결과가 0건이어도 커서가 있으면 스스로 이어 부른다', async ({ page }) => {
  const cursors: (string | null)[] = [];
  await page.route(/\/calls(?:\?.*)?$/, route => {
    if (route.request().isNavigationRequest()) return route.fallback();
    const params = new URL(route.request().url()).searchParams;
    if (!params.get('q')) return route.fulfill({ json: { items: [], nextCursor: null } });
    const cursor = params.get('cursor');
    cursors.push(cursor);
    // 두 번은 훑기만 하고 못 찾는다. 세 번째에 나온다.
    if (!cursor) return route.fulfill({ json: { items: [], nextCursor: 's1' } });
    if (cursor === 's1') return route.fulfill({ json: { items: [], nextCursor: 's2' } });
    return route.fulfill({ json: { items: [listed({ ...done, call_id: 'call-far', contact: { name: '멀리있는사람', phone: '+821033334444' } })], nextCursor: null } });
  });
  await login(page);
  await page.getByRole('textbox', { name: '이름 또는 폰번호 뒷4자리', exact: true }).fill('멀리');
  // 사용자가 스크롤하지 않아도 세 번째 페이지까지 이어 받아 찾아낸다.
  await expect(page.getByText('멀리있는사람', { exact: true })).toBeVisible();
  expect(cursors).toEqual([null, 's1', 's2']);
  // 중간에 「검색어에 해당하는 통화가 없습니다」를 띄우지 않는다 — 아직 찾는 중이었다.
  await expect(page.getByText('검색어에 해당하는 통화가 없습니다.')).toHaveCount(0);
});

test('정말 없으면 그때는 없다고 말한다', async ({ page }) => {
  await installCalls(page, server());
  await login(page);
  await expect(page.getByText('김영국', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '이름 또는 폰번호 뒷4자리', exact: true }).fill('없는 이름');
  await expect(page.getByText('검색어에 해당하는 통화가 없습니다.')).toBeVisible();
});
