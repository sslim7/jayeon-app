import { expect, test, type Page } from '@playwright/test';
import type { CallRecord } from '../../src/types/calls';

const call: CallRecord = { call_id: 'call-1', contact: { name: '김영국', phone: '+821012345678' }, call: { file_name: 'call.m4a', duration: 180, recorded_at: '2026-09-17T05:20:00Z' }, created_at: '2026-09-17T05:25:00Z', status: 'COMPLETED', progress: null, transcript: { text: '견적서를 보내 주세요.', segments: [{ start: 0, end: 4, text: '견적서를 보내 주세요.' }] }, analysis: { schema_version: 1, summary: '도입 견적을 요청한 통화입니다.', details: [{ title: '견적 문의', content: '도입 비용 견적서를 요청했습니다.' }], todos: [{ content: '견적서 전달', owner: null, due_date: null, source: '견적서를 보내 주세요.' }], decisions: [], consulting: { customer_needs: ['도입 비용 확인'], questions: [], concerns: [], objections: [], important_points: ['견적 요청'], followups: [] } } };
test.beforeEach(async ({ page }) => {
  await page.route('**/auth/login', route => route.fulfill({ json: { accessToken: 'a', refreshToken: 'r', expiresInSec: 3600, mustChangePassword: false } }));
  await page.route('**/sms/campaigns?*', route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route('**/sms/templates?*', route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route('**/users/me', route => route.fulfill({ json: { userId: 'call-test', email: 'call@example.com', userName: '통화 사용자', mustChangePassword: false, createdAt: call.created_at } }));
  await page.route(/\/recipients(?:\?.*)?$/, route => route.request().isNavigationRequest() ? route.fallback() : route.fulfill({ json: { items: [], nextCursor: null } }));
  // 첫 페이지 요청에는 cursor 가 없다. `?` 를 요구하면 그 요청이 실제 서버로 새어 나간다.
  // 같은 주소로 들어오는 화면 이동(`/calls`)은 그대로 흘려보낸다 — 가로채면 JSON 이 화면에 뜬다.
  await page.route(/\/calls(?:\?.*)?$/, route => route.request().isNavigationRequest() ? route.fallback() : route.fulfill({ json: { items: [call], nextCursor: null } }));
  await page.route('**/calls/call-1', route => route.fulfill({ json: call }));
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill('call@example.com');
  await page.getByLabel('비밀번호', { exact: true }).fill('test-pass');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '메뉴 열기' })).toBeVisible();
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  await page.getByRole('link', { name: '통화분석', exact: true }).click();
});
test('이름 필터와 저장된 분석 탭을 조회한다', async ({ page }) => {
  await expect(page.getByText('김영국', { exact: true })).toBeVisible();
  await page.getByLabel('이름으로 필터링').fill('없는 이름');
  await expect(page.getByText('이름에 해당하는 통화가 없습니다.')).toBeVisible();
  await page.getByLabel('이름으로 필터링').fill('김영');
  await page.getByRole('button', { name: '김영국 통화 요약 보기' }).click();
  await expect(page.getByRole('tab', { name: '통화 요약', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '상세 내용' }).click();
  await expect(page.getByText('도입 비용 견적서를 요청했습니다.')).toBeVisible();
  await page.getByRole('tab', { name: '할 일' }).click();
  await expect(page.getByText('☐ 견적서 전달')).toBeVisible();
  await page.getByRole('tab', { name: '상담 분석' }).click();
  await expect(page.getByText('• 도입 비용 확인')).toBeVisible();
  await page.getByRole('tab', { name: '통화 원문' }).click();
  await expect(page.getByText('견적서를 보내 주세요.', { exact: true })).toBeVisible();
});
test('일반 브라우저는 분석을 실행하지 않는다', async ({ page }) => {
  await page.getByRole('button', { name: '분석하기', exact: true }).click();
  await expect(page.getByText(/녹음파일 분석은 AI 기능을 지원하는 Nature 모바일 앱/)).toBeVisible();
  await expect(page.getByRole('button', { name: '통화파일 불러오기' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '분석하기', exact: true }).last()).toBeDisabled();
});

/**
 * 껍데기(네이티브) 브리지를 흉내 낸다. `sms.spec.ts` 와 같은 방식이다 — 웹은 postMessage 로
 * 요청을 던지고 `__NATURE_CALL_BRIDGE__.receive` 로 답을 받는다.
 *
 * 파일 시각은 「두 시간 전」으로 만들고, 화면이 채워야 할 값을 페이지 안에서 같은 시간대로
 * 미리 계산해 둔다. 테스트가 도는 기기의 시간대를 가정하지 않기 위해서다.
 */
async function installCallShell(page: Page, local: CallRecord[] = []) {
  await page.addInitScript((rows: CallRecord[]) => {
    Object.assign(window, { __NATURE_NATIVE__: { platform: 'android', appVersion: 'test', callApiVersion: 1 } });
    const fileTime = Date.now() - 2 * 60 * 60 * 1000;
    const pad = (value: number) => String(value).padStart(2, '0');
    const at = new Date(fileTime);
    const shell = window as unknown as Record<string, unknown>;
    shell.__TEST_FILE_TIME__ = fileTime;
    shell.__TEST_EXPECTED_DATE__ = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
    // 진행 중인 통화의 경과 시간은 「3분 12초 전에 시작」으로 고정한다.
    const runningSince = new Date(Date.now() - 192_000).toISOString();
    const stamp = (value?: string | null) => value === 'RUNNING' ? runningSince : value === 'NOW' ? new Date().toISOString() : value;
    const live = rows.map(row => row.timing ? { ...row, timing: {
      ...row.timing,
      started_at: stamp(row.timing.started_at)!,
      finished_at: stamp(row.timing.finished_at),
      stages: Object.fromEntries(Object.entries(row.timing.stages ?? {}).map(([key, value]) => [key, value ? { ...value, started_at: stamp(value.started_at) } : value])),
    } } : row);
    window.ReactNativeWebView = { postMessage(raw: string) {
      const request = JSON.parse(raw); if (request.type !== 'call') return;
      let value: unknown = null;
      if (request.method === 'models') value = { supported: true, installed: true, downloading: false, downloaded_bytes: 0, total_bytes: 787398153 };
      if (request.method === 'pickFile') value = { token: 'test-token', name: 'call.m4a', size: 2_000_000, modified_at: fileTime };
      if (request.method === 'list') value = live;
      if (request.method === 'get') value = live.find((row: CallRecord) => row.call_id === request.args?.id) ?? null;
      setTimeout(() => (window as unknown as { __NATURE_CALL_BRIDGE__?: { receive(reply: unknown): void } }).__NATURE_CALL_BRIDGE__?.receive({ requestId: request.requestId, value }), 10);
    } };
  }, local);
}
test('파일을 고르면 통화일시가 채워지고 값을 바꿀 수 있다', async ({ page }) => {
  await installCallShell(page);
  await page.goto('/calls');
  await page.getByRole('button', { name: '분석하기', exact: true }).first().click();
  const picker = page.getByRole('button', { name: '통화파일 불러오기' });
  await expect(picker).toBeEnabled();
  await picker.click();
  await expect(page.getByText('call.m4a · 2.0 MB')).toBeVisible();
  const field = page.getByLabel('통화일시', { exact: true });
  const expected = await page.evaluate(() => (window as unknown as { __TEST_EXPECTED_DATE__: string }).__TEST_EXPECTED_DATE__);
  await expect(field).toHaveValue(expected);
  // 값을 눌러 고를 수 있어야 한다. 고른 값은 파일을 다시 골라도 덮어쓰지 않는다.
  await field.fill('2026-09-16T10:30');
  await expect(field).toHaveValue('2026-09-16T10:30');
  await picker.click();
  await expect(field).toHaveValue('2026-09-16T10:30');
});
test('분석 중인 통화는 진행 막대와 경과 시간을 보여 준다', async ({ page }) => {
  const running: CallRecord = { call_id: 'call-2', contact: { name: '이진행', phone: '+821099998888' }, call: { file_name: 'live.m4a', duration: null, recorded_at: '2026-09-17T04:00:00Z' }, created_at: '2026-09-17T04:10:00Z', status: 'TRANSCRIBING', progress: 42, timing: { started_at: 'RUNNING', stages: { PREPARE: { started_at: null, ms: 3_000 }, TRANSCRIBE: { started_at: 'RUNNING', ms: 0 } } } };
  await installCallShell(page, [running]);
  await page.goto('/calls');
  await expect(page.getByText('이진행', { exact: true })).toBeVisible();
  // 행은 현재 단계와 경과 시간만 말한다.
  await expect(page.getByText(/^음성 변환 · 3분 \d{2}초 경과$/)).toBeVisible();
  // 네 단계 카드: 지난 단계는 걸린 시간, 도는 단계는 진행 막대, 남은 단계는 「예정」.
  await expect(page.getByText('분석 준비', { exact: true })).toBeVisible();
  await expect(page.getByText('3초', { exact: true })).toBeVisible();
  const bar = page.getByRole('progressbar', { name: '음성 변환 42%' });
  await expect(bar).toHaveAttribute('aria-valuenow', '42');
  await expect(page.getByText('통화 분석', { exact: true })).toBeVisible();
  await expect(page.getByText('예정', { exact: true }).first()).toBeVisible();
});
test('실패한 통화는 멈춘 단계와 이유·코드를 보여 준다', async ({ page }) => {
  const failed: CallRecord = {
    call_id: 'call-3', contact: { name: '최실패', phone: '+821077776666' },
    call: { file_name: 'broken.m4a', duration: 120, recorded_at: '2026-09-17T03:00:00Z' }, created_at: '2026-09-17T03:10:00Z',
    status: 'ANALYSIS_FAILED', progress: null,
    transcript: { text: '다음 주에 다시 연락드리겠습니다.', segments: [{ start: 0, end: 3, text: '다음 주에 다시 연락드리겠습니다.' }] },
    error: '음성 변환은 완료되었지만 AI 분석을 완료하지 못했습니다. AI가 출력 한도 안에 분석을 끝내지 못했습니다. (코드: INCOMPLETE_ANALYSIS)',
    timing: { started_at: 'RUNNING', finished_at: 'NOW', llm: { chunks: 3, completions: 6, skipped: 3, tokens: 6900, tokens_per_second: 1.4, stopped_limit: 6, merge_fallbacks: 0 }, stages: { PREPARE: { started_at: null, ms: 3_000 }, TRANSCRIBE: { started_at: null, ms: 35_000 }, ANALYZE: { started_at: 'RUNNING', ms: 0 } } },
  };
  await installCallShell(page, [failed]);
  await page.goto('/calls');
  await expect(page.getByText('최실패', { exact: true })).toBeVisible();
  // 이유와 내부 코드를 함께 보여 준다. 이게 없으면 다음에도 추측만 하게 된다.
  await expect(page.getByText(/코드: INCOMPLETE_ANALYSIS/)).toBeVisible();
  await expect(page.getByText(/^3분 \d{2}초에서 멈춤$/)).toBeVisible();
  await expect(page.getByText('구간 3개 중 3개는 분석하지 못해 결과에서 빠졌습니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '분석 다시 시도' })).toBeVisible();
  // 분석이 없는 통화에서도 다른 탭이 빈 화면이 되지 않는다.
  await page.getByRole('button', { name: '저장된 원문 보기' }).click();
  await expect(page.getByText('다음 주에 다시 연락드리겠습니다.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '통화 요약', exact: true }).click();
  await expect(page.getByText(/코드: INCOMPLETE_ANALYSIS\) 목록에서 다시 시도하면/)).toBeVisible();
  await page.getByRole('tab', { name: '할 일' }).click();
  await expect(page.getByText(/목록에서 다시 시도하면/)).toBeVisible();
});
