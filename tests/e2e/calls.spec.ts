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
// 이 기록에는 상세 내용·할 일·상담 분석이 모두 들어 있다(옛 기기 분석이 만든 기록이자, 서버
// 분석이 붙은 뒤 받게 될 모양이다). 내용이 있으면 그 탭이 그대로 보여야 한다.
test('내용이 있는 분석은 상세·할 일·상담 분석 탭까지 보여 준다', async ({ page }) => {
  await expect(page.getByText('김영국', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '이름 또는 폰번호 뒷4자리', exact: true }).fill('없는 이름');
  await expect(page.getByText('검색어에 해당하는 통화가 없습니다.')).toBeVisible();
  await page.getByRole('textbox', { name: '이름 또는 폰번호 뒷4자리', exact: true }).fill('김영');
  await page.getByRole('button', { name: '김영국 분석 보기' }).click();
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
// 「AI 기능이 깔렸나」로 화면을 막지 않는다. 파일 고르기는 언제나 눌리고, 아직 올릴 곳이 없는
// 자리에서는 눌렀을 때 **그 사실만** 오류로 말한다.
test('일반 브라우저에서도 시트는 열리고 고를 수 없는 이유만 말한다', async ({ page }) => {
  // 등록은 오른쪽 아래 「+」 하나로 연다(헤더 버튼은 없앴다).
  await expect(page.getByRole('button', { name: '분석하기', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '통화분석 등록하기', exact: true }).click();
  const picker = page.getByRole('button', { name: '통화파일 불러오기' });
  await expect(picker).toBeEnabled();
  await picker.click();
  await expect(page.getByText('지금은 Nature 앱에서만 녹음파일을 고를 수 있어요.')).toBeVisible();
  await expect(page.getByRole('button', { name: '등록하기', exact: true })).toBeDisabled();
});

// 열은 폰에서 좁다. 기본은 요약 보기이고, 요약 한 줄은 「전체정보뷰」에서만 편다.
test('목록은 요약·전체 보기를 오가고 녹음은 준비되기 전까지 잠긴다', async ({ page }) => {
  await expect(page.getByText('김영국', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '김영국 통화 요약 보기' })).toHaveCount(0);
  // 분석이 끝난 통화의 상태 자리는 「분석 보기」다.
  await expect(page.getByRole('button', { name: '김영국 분석 보기' })).toBeVisible();
  // 녹음은 서버에 올라가기 전이라 들을 수 없다. 이유는 버튼 이름이 들고 있다.
  const listen = page.getByRole('button', { name: /^김영국 녹음 듣기/ });
  await expect(listen).toBeDisabled();
  await expect(listen).toHaveAccessibleName('김영국 녹음 듣기 · 녹음이 아직 준비되지 않았습니다.');
  await page.getByRole('button', { name: '전체정보뷰', exact: true }).click();
  await expect(page.getByRole('button', { name: '김영국 통화 요약 보기' })).toBeVisible();
  await page.getByRole('button', { name: '간단뷰', exact: true }).click();
  await expect(page.getByRole('button', { name: '김영국 통화 요약 보기' })).toHaveCount(0);
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
  await page.getByRole('button', { name: '통화분석 등록하기', exact: true }).click();
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
/**
 * 폰 폭에서 시트 하나에 **파일 선택 → 상대 선택 → 통화일시 → 분석하기**가 모두 들어와야
 * 한다. 수신자를 그대로 쌓던 때는 아래 둘이 화면 밖으로 밀려 스크롤하지 않으면 보이지
 * 않았다 — 후보는 세 줄 높이 안에서만 스크롤한다.
 */
test('폰 폭에서 등록 시트에 통화일시와 등록하기가 함께 보인다', async ({ page }) => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `r-${i}`, name: `수신자${i}`, phone: `+8210111122${String(i).padStart(2, '0')}`, groupId: '', customFields: [], sentCount: 0, createdAt: call.created_at, updatedAt: call.created_at }));
  await page.route(/\/recipients(?:\?.*)?$/, route => route.request().isNavigationRequest() ? route.fallback() : route.fulfill({ json: { items: many, nextCursor: null } }));
  await installCallShell(page);
  await page.setViewportSize({ width: 384, height: 832 });
  await page.goto('/calls');
  const fab = page.getByRole('button', { name: '통화분석 등록하기', exact: true });
  await expect(fab).toBeInViewport();
  await fab.click();
  await expect(page.getByRole('button', { name: '통화파일 불러오기' })).toBeInViewport();
  // 검색하기 전에는 후보를 세우지 않는다 — 수신자가 많은 계정에서는 이름 더미가 될 뿐이다.
  await expect(page.getByRole('button', { name: /^수신자\d+ · / })).toHaveCount(0);
  await expect(page.getByText('이름 또는 폰번호 뒷4자리로 검색해 주세요.')).toBeVisible();
  // 스크롤하지 않아도 통화일시와 제출 버튼이 한 화면에 있다.
  await expect(page.getByLabel('통화일시', { exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '등록하기', exact: true })).toBeInViewport();
  // 검색으로 좁히면 그 안에서 고른다.
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
// 녹음 주소가 붙으면 ▶ 가 열리고 재생 패널이 브라우저 재생기를 세운다.
test('녹음이 준비된 통화는 재생 패널을 연다', async ({ page }) => {
  const withAudio: CallRecord = { ...call, call_id: 'call-6', contact: { name: '정녹음', phone: '+821011112222' }, audio_url: 'https://example.com/a.m4a' };
  await installCallShell(page, [withAudio]);
  await page.goto('/calls');
  const listen = page.getByRole('button', { name: '정녹음 녹음 듣기', exact: true });
  await expect(listen).toBeEnabled();
  await listen.click();
  await expect(page.getByRole('heading', { name: '녹음 듣기', exact: true })).toBeVisible();
  await expect(page.locator('audio')).toHaveAttribute('src', 'https://example.com/a.m4a');
});
test('분석 중인 통화는 진행 막대와 경과 시간을 보여 준다', async ({ page }) => {
  const running: CallRecord = { call_id: 'call-2', contact: { name: '이진행', phone: '+821099998888' }, call: { file_name: 'live.m4a', duration: null, recorded_at: '2026-09-17T04:00:00Z' }, created_at: '2026-09-17T04:10:00Z', status: 'TRANSCRIBING', progress: 42, timing: { started_at: 'RUNNING', stages: { PREPARE: { started_at: null, ms: 3_000 }, TRANSCRIBE: { started_at: 'RUNNING', ms: 0 } } } };
  await installCallShell(page, [running]);
  await page.goto('/calls');
  await expect(page.getByText('이진행', { exact: true })).toBeVisible();
  // 네 단계 카드: 지난 단계는 걸린 시간, 도는 단계는 진행 막대, 남은 단계는 「예정」.
  await expect(page.getByText('분석 준비', { exact: true })).toBeVisible();
  await expect(page.getByText('완료 · 3초', { exact: true })).toBeVisible();
  await expect(page.getByText(/^진행 중 · 3분 \d{2}초 경과 · 42%$/)).toBeVisible();
  const bar = page.getByRole('progressbar', { name: '음성 변환 42%' });
  await expect(bar).toHaveAttribute('aria-valuenow', '42');
  await expect(page.getByText('요약 생성', { exact: true })).toBeVisible();
  await expect(page.getByText('예정', { exact: true }).first()).toBeVisible();
  // 카드가 펴진 행에는 같은 단계·경과 시간을 다시 적는 한 줄 요약이 없다.
  await expect(page.getByText(/^음성 변환 · /)).toHaveCount(0);
  await expect(page.getByText('음성 변환', { exact: true })).toHaveCount(1);
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
  // 이유는 한 곳에만 적는다. 카드는 어디서 멈췄는지만 말한다.
  await expect(page.getByText(/코드: INCOMPLETE_ANALYSIS/)).toHaveCount(1);
  await expect(page.getByText(/^멈춤 · 3분 \d{2}초$/)).toBeVisible();
  await expect(page.getByText(/걸렸습니다$/)).toHaveCount(0);
  await expect(page.getByText('구간 3개 중 3개는 요약하지 못해 결과에서 빠졌습니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '분석 다시 시도' })).toBeVisible();
  // 분석이 없는 통화에서도 다른 탭이 빈 화면이 되지 않는다.
  await page.getByRole('button', { name: '저장된 원문 보기' }).click();
  await expect(page.getByText('다음 주에 다시 연락드리겠습니다.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '통화 요약', exact: true }).click();
  await expect(page.getByText(/코드: INCOMPLETE_ANALYSIS\) 목록에서 다시 시도하면/)).toBeVisible();
  // 분석이 없으면 요약과 원문 말고 누를 탭이 없다. 빈 탭을 띄워 두고 헛걸음시키지 않는다.
  await expect(page.getByRole('tab')).toHaveCount(2);
});
test('요약만 만든 기록은 요약과 원문 탭만 보여 준다', async ({ page }) => {
  // 이 버전의 기기 분석은 요약만 만든다. 나머지 필드는 서버 계약을 맞추려고 빈 배열로 채워
  // 보내는데, 그 탭을 띄워 두면 누를 것이 없는 탭에 사용자를 헛걸음시킨다. 그래서 걷는다.
  const reduced: CallRecord = {
    call_id: 'call-5', contact: { name: '정요약', phone: '+821033332222' },
    call: { file_name: 'short.m4a', duration: 150, recorded_at: '2026-09-17T01:00:00Z' }, created_at: '2026-09-17T01:05:00Z',
    status: 'COMPLETED', progress: null, summary: '견적 전달을 요청한 통화입니다.',
    transcript: { text: '견적서를 보내 주세요.', segments: [{ start: 0, end: 4, text: '견적서를 보내 주세요.' }] },
    analysis: { schema_version: 1, summary: '견적 전달을 요청한 통화입니다.', details: [], todos: [], decisions: [], consulting: { customer_needs: [], questions: [], concerns: [], objections: [], important_points: [], followups: [] } },
    timing: { started_at: 'RUNNING', finished_at: 'NOW', llm: { chunks: 1, completions: 1, skipped: 0, tokens: 260, tokens_per_second: 9.4, stopped_limit: 0, merge_fallbacks: 0 } },
  };
  await installCallShell(page, [reduced]);
  await page.goto('/calls');
  // 요약 한 줄은 「전체정보뷰」에서 선다.
  await page.getByRole('button', { name: '전체정보뷰', exact: true }).click();
  await page.getByRole('button', { name: '정요약 통화 요약 보기' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: '통화 요약', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('견적 전달을 요청한 통화입니다.').first()).toBeVisible();
  for (const gone of ['상세 내용', '할 일', '상담 분석']) await expect(page.getByRole('tab', { name: gone })).toHaveCount(0);
  // 진단 숫자는 그대로 남는다 — 다음에 느리거나 실패했을 때 짚을 수 있는 유일한 단서다.
  await expect(page.getByText('AI 호출 1회 · 생성 260 토큰 · 9.4 토큰/초')).toBeVisible();
  // 원문은 지금처럼 기기에 남고 서버에도 올라간다.
  await page.getByRole('tab', { name: '통화 원문' }).click();
  await expect(page.getByText('견적서를 보내 주세요.', { exact: true })).toBeVisible();
});
test('구간 하나를 도는 동안 토큰 수와 속도로 살아 있음을 보여 준다', async ({ page }) => {
  const single: CallRecord = {
    call_id: 'call-4', contact: { name: '박구간', phone: '+821055554444' },
    call: { file_name: 'one.m4a', duration: 90, recorded_at: '2026-09-17T02:00:00Z' }, created_at: '2026-09-17T02:05:00Z',
    status: 'ANALYZING', progress: null,
    live: { chunk: 1, chunks: 1, tokens: 1240, tokens_per_second: 2.4 },
    timing: { started_at: 'RUNNING', stages: { PREPARE: { started_at: null, ms: 3_000 }, TRANSCRIBE: { started_at: null, ms: 35_000 }, ANALYZE: { started_at: 'RUNNING', ms: 0 } } },
  };
  await installCallShell(page, [single]);
  await page.goto('/calls');
  await expect(page.getByText('박구간', { exact: true })).toBeVisible();
  // 구간이 하나면 백분율을 만들 수 없다. 대신 실제로 센 숫자를 보여 준다.
  await expect(page.getByText('1,240 토큰 · 2.4 토큰/초', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByText(/^진행 중 · 3분 \d{2}초 경과$/)).toBeVisible();
});
