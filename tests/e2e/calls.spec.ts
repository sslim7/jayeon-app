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
  transcript: { text: '견적서를 보내 주세요.', segments: [{ start: 0, end: 4, text: '견적서를 보내 주세요.' }] },
  analysis: { schema_version: 1, summary: '도입 견적을 요청한 통화입니다.', details: [{ title: '견적 문의', content: '도입 비용 견적서를 요청했습니다.' }], todos: [{ content: '견적서 전달', owner: null, due_date: null, source: '견적서를 보내 주세요.' }], decisions: [], consulting: { customer_needs: ['도입 비용 확인'], questions: [], concerns: [], objections: [], important_points: ['견적 요청'], followups: [] } },
};
/** 목록 응답은 원문·분석·재생 주소를 빼고 온다(§`internal/calls/model.go` 의 `listRecord`). */
function listed(record: CallRecord): CallRecord {
  const { transcript: _t, analysis: _a, audio_url: _u, ...rest } = record;
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

// 열은 폰에서 좁다. 기본은 요약 보기이고, 요약 한 줄은 「전체정보뷰」에서만 편다.
test('목록은 요약·전체 보기를 오가고 녹음은 상세에서 받은 주소로 연다', async ({ page }) => {
  await installCalls(page, server());
  await login(page);
  await expect(page.getByText('김영국', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '김영국 통화 요약 보기' })).toHaveCount(0);
  // 분석이 끝난 통화의 상태 자리는 「분석 보기」다.
  await expect(page.getByRole('button', { name: '김영국 분석 보기' })).toBeVisible();
  // 통화시간과 ▶ 는 한 칸에 선다(180초 = 3분 00초).
  await expect(page.getByText('3분 00초', { exact: true })).toBeVisible();
  // 🔴 목록이 아는 것은 `has_audio` 뿐이다. 주소는 패널이 상세를 물어본 뒤 받는다.
  const listen = page.getByRole('button', { name: '김영국 녹음 듣기', exact: true });
  await expect(listen).toBeEnabled();
  await listen.click();
  await expect(page.locator('audio')).toHaveAttribute('src', /storage\.test/);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '전체정보뷰', exact: true }).click();
  await expect(page.getByRole('button', { name: '김영국 통화 요약 보기' })).toBeVisible();
  await page.getByRole('button', { name: '간단뷰', exact: true }).click();
  await expect(page.getByRole('button', { name: '김영국 통화 요약 보기' })).toHaveCount(0);
});

// 원본이 보관 기간을 지나 지워지면 `has_audio` 가 오지 않는다. **실패가 아니다** —
// 요약과 원문은 그대로 남으므로 그 사실만 말하고 버튼을 잠근다.
test('원본이 없는 통화는 재생 버튼을 잠그고 이유를 말한다', async ({ page }) => {
  const { has_audio: _gone, audio_url: _url, ...noAudio } = done;
  await installCalls(page, server([{ ...noAudio, call_id: 'call-old', contact: { name: '박옛날', phone: '+821011112222' }, ai: { model: 'qwen', model_version: '1', processed_on_device: true } }]));
  await login(page);
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
  // 끝난 뒤에는 폴링이 멈춘다.
  state.rows.set('call-2', { ...running, status: 'COMPLETED', progress: 1, job_state: 'COMPLETED', stage: '분석 완료', summary: '끝났습니다.' });
  await expect(page.getByRole('button', { name: '이진행 분석 보기' })).toBeVisible({ timeout: 15_000 });
  const settled = state.seen.length;
  await page.waitForTimeout(7_000);
  expect(state.seen.length).toBe(settled);
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

// 받아쓰기가 실패한 통화에는 다시 분석할 원문이 없다. 서버가 409 로 거절할 버튼을 세워 두지 않는다.
test('받아쓰기가 실패한 통화는 다시 등록하라고만 말한다', async ({ page }) => {
  await installCalls(page, server([{
    call_id: 'call-7', contact: { name: '한전사', phone: '+821055556666' },
    call: { file_name: 'noise.m4a', duration: null, recorded_at: '2026-09-17T02:00:00Z' }, created_at: '2026-09-17T02:05:00Z',
    status: 'TRANSCRIPTION_FAILED', progress: 0.4, job_state: 'TRANSCRIPTION_FAILED', stage: '받아쓰기에 실패했어요', error: 'EMPTY_TRANSCRIPT',
  }]));
  await login(page);
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
