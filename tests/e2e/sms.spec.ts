/// <reference types="node" />
import { Buffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';

type Row = { id: string; name: string; phone: string; groupId: string; createdAt: string; updatedAt: string; latestSentAt?: string | null; sentCount?: number; customFields?: { name: string; value: string }[] };
type Target = Row & { campaignId: string; recipientId: string; message: string; status: string; attemptId?: string; errorCode?: string | null; errorMessage?: string | null };
type MockAttachment = { id: string; name: string; mimeType: string; size: number; dataBase64: string; createdAt: string };
type MockTemplate = { id: string; name: string; message: string; attachments: MockAttachment[]; createdAt: string; updatedAt: string };
const now = '2026-09-16T00:00:00Z';
async function setup(page: Page, native = false) {
  const people: Row[] = [{ id: 'p1', name: '김철수', phone: '+821012345678', groupId: '모임', createdAt: now, updatedAt: now }, { id: 'p2', name: '김영희', phone: '+821087654321', groupId: '모임', createdAt: now, updatedAt: now }];
  const state = { people, campaigns: [] as Record<string, unknown>[], targets: [] as Target[], results: [] as string[], failCreate: false, failSave: false, attachments: [] as MockAttachment[], templates: [] as MockTemplate[], importConfirmed: false };
  await page.route('**/auth/login', route => route.fulfill({ json: { accessToken: 'a', refreshToken: 'r', expiresInSec: 3600, mustChangePassword: false } }));
  await page.route('**/users/me', route => route.fulfill({ json: { userId: 'sms-test', email: 'sms@example.com', userName: '문자 사용자', mustChangePassword: false, createdAt: now } }));
  await page.route(/\/recipients(?:\?.*)?$/, async route => {
    if (route.request().isNavigationRequest()) return route.fallback();
    if (new URL(route.request().url()).pathname.startsWith('/sms/')) return route.fallback();
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON();
      const row = { ...data, id: `p${state.people.length + 1}`, createdAt: now, updatedAt: now };
      state.people.push(row); return route.fulfill({ status: 201, json: row });
    }
    const params = new URL(route.request().url()).searchParams;
    const includeSent = params.get('includeSent') !== 'false';
    const matched = state.people.filter(person => includeSent || !person.latestSentAt).sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id));
    const start = Number(params.get('cursor') || '0');
    const end = start + Number(params.get('limit') || '100');
    return route.fulfill({ json: { items: matched.slice(start, end), total: matched.length, nextCursor: end < matched.length ? String(end) : null } });
  });
  await page.route(/\/recipients\/p\d+$/, async route => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const index = state.people.findIndex(r => r.id === id);
    if (route.request().method() === 'DELETE') { state.people.splice(index, 1); return route.fulfill({ status: 204 }); }
    Object.assign(state.people[index], route.request().postDataJSON());
    return route.fulfill({ json: state.people[index] });
  });
  await page.route('**/sms/templates**', async route => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/')[3];
    if (request.method() === 'GET') return route.fulfill({ json: id ? state.templates.find(t => t.id === id) : { items: state.templates, nextCursor: null } });
    if (request.method() === 'DELETE') { state.templates = state.templates.filter(t => t.id !== id); return route.fulfill({ status: 204 }); }
    const input = request.postDataJSON();
    const template = { id: id || 't1', name: input.name, message: input.message, attachments: state.attachments.filter(a => input.attachmentIds.includes(a.id)), createdAt: now, updatedAt: now };
    state.templates = [...state.templates.filter(t => t.id !== template.id), template];
    return route.fulfill({ json: template });
  });
  await page.route('**/sms/attachments**', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const input = request.postDataJSON();
      const file = { ...input, id: `a${state.attachments.length + 1}`, size: Buffer.from(input.dataBase64, 'base64').length, createdAt: now };
      state.attachments.push(file); return route.fulfill({ status: 201, json: file });
    }
    const id = new URL(request.url()).pathname.split('/')[3];
    return route.fulfill({ json: state.attachments.find(a => a.id === id) });
  });
  await page.route('**/recipients/p1/history?*', route => route.fulfill({ json: { items: [{ id: 'old-r1', campaignId: 'old-c1', campaignTitle: '이전 모임', recipientId: 'p1', name: '김철수', phone: state.people[0].phone, message: '이전에 보낸 안내입니다.', status: 'SENT', sentAt: now, createdAt: now, updatedAt: now, attachments: [] }] } }));
  await page.route('**/recipients/imports/**', route => {
    const confirmed = route.request().url().endsWith('/confirm');
    if (confirmed && !state.importConfirmed) { state.people.push({ id: 'p3', name: '박영수', phone: '+821011112222', groupId: '신규', customFields: [{ name: '직책', value: '총무' }, { name: '우편번호', value: '00123' }], createdAt: now, updatedAt: now }); state.importConfirmed = true; }
    return route.fulfill({ json: { id: 'import1', addedCount: 1, excludedCount: 2, createdAt: now, items: [
      { row: 2, name: '박영수', phone: '+821011112222', groupId: '신규', customFields: [{ name: '직책', value: '총무' }, { name: '우편번호', value: '00123' }], status: 'ADD', reason: '' },
      { row: 3, name: '김철수', phone: '+821012345678', groupId: '모임', status: 'EXCLUDED', reason: '이미 등록된 전화번호' },
      { row: 4, name: '이순신', phone: '+821012345678', groupId: '', status: 'EXCLUDED', reason: '파일 내 중복 전화번호' },
    ] } });
  });
  await page.route('**/sms/campaigns**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/sms/campaigns') {
      if (request.method() === 'GET') return route.fulfill({ json: { items: state.campaigns, nextCursor: null } });
      const input = request.postDataJSON();
      if (input.recipientIds.some((id: string) => !state.people.some(p => p.id === id))) return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: '수신자를 찾을 수 없습니다.' } });
      let campaign = state.campaigns.find(c => c.requestId === input.requestId);
      if (!campaign) {
        // 예약은 캠페인을 여러 개 만든다. 첫 캠페인만 기존 테스트가 쓰는 c1/cr0 이름을 유지한다.
        const cid = `c${state.campaigns.length + 1}`;
        const prefix = state.campaigns.length ? `${cid}r` : 'cr';
        // 서버 계약: 예약으로 만든 것만 reserved=true, 나머지는 false 로 응답한다.
        campaign = { ...input, id: cid, status: 'READY', reserved: input.reserved === true, recipientCount: input.recipientIds.length, attachments: state.attachments.filter(a => (input.attachmentIds || []).includes(a.id)), createdAt: now };
        state.campaigns.push(campaign!);
        state.targets.push(...input.recipientIds.map((id: string, i: number) => ({ ...state.people.find(p => p.id === id)!, id: `${prefix}${i}`, recipientId: id, campaignId: cid, message: input.message, attachments: state.attachments.filter(a => (input.attachmentIds || []).includes(a.id)), status: 'READY' })));
      }
      if (state.failCreate) { state.failCreate = false; return route.abort('failed'); }
      return route.fulfill({ json: campaign });
    }
    const campaign = state.campaigns.find(c => c.id === path.split('/')[3]) ?? state.campaigns[0];
    const targets = state.targets.filter(r => r.campaignId === campaign.id);
    if (path.endsWith('/start')) { campaign.status = 'SENDING'; return route.fulfill({ json: campaign }); }
    if (path.endsWith('/cancel')) { campaign.status = 'CANCELLED'; return route.fulfill({ json: campaign }); }
    if (path.endsWith('/recipients')) return route.fulfill({ json: { items: targets } });
    if (path.includes('/recipients/')) {
      const target = targets.find(r => r.id === path.split('/').pop())!;
      const input = request.postDataJSON();
      if (input.status !== 'SENDING' && state.failSave) return route.abort('failed');
      Object.assign(target, input);
      if (input.status === 'SENT') state.results.push(target.id);
      if (targets.every(r => r.status === 'SENT')) campaign.status = 'COMPLETED';
      return route.fulfill({ json: { campaign, recipient: target, dispatchAllowed: input.status === 'SENDING' } });
    }
    return route.fulfill({ json: campaign });
  });
  // Desktop은 기존 껍데기, mobile은 Nature 껍데기와의 브리지 호환을 함께 검증한다.
  if (native) await page.addInitScript((legacyShell) => {
    Object.assign(window, { [legacyShell ? '__JAYEON_NATIVE__' : '__NATURE_NATIVE__']: { platform: 'android', appVersion: 'test', smsApiVersion: 1 } });
    const reply = (requestId: string, value: unknown) => {
      const globals = window as unknown as Record<string, { receive(value: unknown): void } | undefined>;
      const bridge = globals[legacyShell ? '__JAYEON_SMS_BRIDGE__' : '__NATURE_SMS_BRIDGE__'];
      bridge?.receive({ requestId, value });
    };
    window.ReactNativeWebView = { postMessage(raw: string) {
      const request = JSON.parse(raw); if (request.type !== 'sms') return;
      const ledger = JSON.parse(localStorage.getItem('test.sms.results') || '[]');
      let value: unknown;
      if (request.method === 'capabilities' || request.method === 'permissions') value = { supported: true, mmsSupported: true, lmsSupported: true, permissionGranted: true, subscriptions: [{ id: 1, label: 'SIM 1 테스트 회선' }], defaultSubscriptionId: 1 };
      if (request.method === 'send') {
        value = { ...request.args, status: 'SENT', success: true, errorCode: null, errorMessage: null };
        ledger.push(value); localStorage.setItem('test.sms.results', JSON.stringify(ledger));
        const calls = JSON.parse(localStorage.getItem('test.sms.calls') || '[]'); calls.push(request.args.campaignRecipientId); localStorage.setItem('test.sms.calls', JSON.stringify(calls));
      }
      if (request.method === 'results') value = ledger;
      if (request.method === 'acknowledge') localStorage.setItem('test.sms.results', JSON.stringify(ledger.filter((r: { attemptId: string }) => r.attemptId !== request.args.attemptId)));
      setTimeout(() => reply(request.requestId, value), 10);
    } };
  }, test.info().project.name === 'desktop');
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill('sms@example.com');
  await page.getByLabel('비밀번호', { exact: true }).fill('test-pass');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/sms\/new$/);
  await expect(page.getByRole('button', { name: '메뉴 열기', exact: true })).toBeVisible();
  return state;
}
async function prepareCompose(page: Page) {
  await page.goto('/sms/new');
  await page.getByRole('checkbox', { name: /김철수/ }).click();
  await page.getByRole('checkbox', { name: /김영희/ }).click();
  await page.getByRole('button', { name: '발송하기', exact: true }).click();
  await page.getByRole('button', { name: '직접 작성', exact: true }).click();
}
// 폰 폭은 선택 수를 (M/N)로 줄이므로 스크린리더용 이름으로 찾는다.
const isMobile = () => test.info().project.name === 'mobile';
function totalCount(page: Page, total: number) {
  return isMobile() ? page.getByLabel(new RegExp(`^전체 ${total}명 중 \\d+명 선택$`)) : page.getByText(`전체 ${total}명`, { exact: true });
}
function selectedCount(page: Page, selected: number) {
  return isMobile() ? page.getByLabel(new RegExp(`^전체 \\d+명 중 ${selected}명 선택$`)) : page.getByText(`선택 ${selected}명`, { exact: true });
}
async function compose(page: Page) {
  await prepareCompose(page);
  await page.getByLabel('발송 제목').fill('9월 모임 안내');
  await page.getByLabel('메시지', { exact: true }).fill('안녕하세요. 이번 주 모임 안내드립니다.');
  await page.getByRole('button', { name: '2명 발송 준비', exact: true }).click();
}
test('수신자 번호 정규화·수정·삭제', async ({ page }) => {
  const state = await setup(page); await page.goto('/recipients');
  await page.getByRole('button', { name: '수신자 등록', exact: true }).click();
  await page.getByLabel('이름', { exact: true }).fill('박영수');
  await page.getByLabel('전화번호', { exact: true }).fill('010-1111-2222');
  await page.getByLabel('그룹', { exact: true }).fill('모임');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /박영수.*010-1111-2222/ })).toBeVisible();
  expect(state.people[2].phone).toBe('01011112222');
  await page.getByRole('button', { name: '박영수 수정', exact: true }).click();
  await page.getByLabel('이름', { exact: true }).fill('박영수 수정됨');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '박영수 수정됨 삭제', exact: true }).click();
  await page.getByRole('button', { name: '삭제 확인', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /박영수/ })).toHaveCount(0);
});
test('웹은 문자를 준비하고 조회하지만 SMS를 발송하지 않는다', async ({ page }) => {
  const state = await setup(page); await compose(page);
  await expect(page.getByRole('heading', { name: '9월 모임 안내' })).toBeVisible();
  await expect(page.getByText(/이 기능은 Android 앱에서/)).toBeVisible();
  await expect(page.getByRole('button', { name: '2명에게 발송하기', exact: true })).toHaveCount(0);
  await expect(page.getByText('첨부 발송을 지원하는 최신 Android 앱을 설치해 주세요.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '닫기', exact: true })).toBeVisible();
  expect(state.targets.every(r => r.status === 'READY')).toBeTruthy();
});
test('생성 응답 유실과 새로고침에도 같은 문자를 확인한다', async ({ page }) => {
  const state = await setup(page); state.failCreate = true; await compose(page);
  await expect(page.getByRole('button', { name: '같은 요청 다시 확인' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '같은 요청 다시 확인' }).click();
  await expect(page.getByRole('heading', { name: '9월 모임 안내' })).toBeVisible();
  expect(state.campaigns).toHaveLength(1);
});
test('모의 Android 발송은 명시 클릭 후 순차 저장하고 SENT를 다시 보내지 않는다', async ({ page }) => {
  const state = await setup(page, true); await compose(page);
  const send = page.getByRole('button', { name: '2명에게 발송하기', exact: true });
  await expect(send).toBeEnabled(); expect(state.results).toHaveLength(0);
  await send.click();
  await expect(page.getByText('성공 2 · 실패 0 · 대기 0', { exact: true })).toBeVisible();
  expect(state.results).toEqual(['cr0', 'cr1']);
  await page.reload();
  await expect(page.getByText('성공 2 · 실패 0 · 대기 0', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test.sms.calls') || '[]'))).toEqual(['cr0', 'cr1']);
  await expect(page.getByRole('button', { name: '발송 중단', exact: true })).toHaveCount(0);
  await expect(page.getByText('발신 SIM 회선', { exact: true })).toHaveCount(0);
  const statuses = state.campaigns.map((c) => c.status);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page).toHaveURL(/\/sms\/new$/);
  expect(state.campaigns.map((c) => c.status)).toEqual(statuses);
});
test('결과 저장 실패는 다음 발송을 막고 재접속은 결과만 복원한다', async ({ page }) => {
  const state = await setup(page, true); await compose(page); state.failSave = true;
  await page.getByRole('button', { name: '2명에게 발송하기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('test.sms.calls') || '[]').length)).toBe(1);
  await expect(page.getByRole('button', { name: '결과 다시 확인', exact: true })).toBeEnabled();
  state.failSave = false; await page.reload();
  await expect(page.getByText('성공 1 · 실패 0 · 대기 1', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test.sms.calls') || '[]'))).toEqual(['cr0']);
  await page.getByRole('button', { name: '미발송 1건 계속 보내기', exact: true }).click();
  await expect(page.getByText('성공 2 · 실패 0 · 대기 0', { exact: true })).toBeVisible();
});

test('삭제된 수신자 생성 거절은 잠금을 해제하고 없는 선택을 제거한다', async ({ page }) => {
  const state = await setup(page);
  await prepareCompose(page);
  await page.getByLabel('발송 제목').fill('삭제 회귀');
  await page.getByLabel('메시지', { exact: true }).fill('안내');
  state.people.splice(0, 1);
  await page.getByRole('button', { name: '2명 발송 준비', exact: true }).click();
  await expect(page.getByRole('button', { name: '1명 발송 준비', exact: true })).toBeVisible();
  await expect(page.getByLabel('발송 제목')).toBeEditable();
  await page.getByRole('button', { name: '1명 발송 준비', exact: true }).click();
  await expect(page.getByRole('heading', { name: '삭제 회귀' })).toBeVisible();
  expect(state.targets).toHaveLength(1);
  expect(state.targets[0].recipientId).toBe('p2');
});

test('메뉴는 본문을 축소하고 선택을 유지하며 화면 탭·Escape로 복귀한다', async ({ page }) => {
  await setup(page);
  await page.getByRole('checkbox', { name: /김영희/ }).click();
  const main = page.getByTestId('navigation-main');
  const original = (await main.boundingBox())!;
  const open = page.getByRole('button', { name: '메뉴 열기', exact: true });
  const close = page.getByRole('button', { name: '메뉴 닫기', exact: true });
  await open.click();
  await expect(page.getByRole('img', { name: 'Nature', exact: true })).toBeVisible();
  await expect.poll(async () => (await main.boundingBox())!.width / original.width).toBeCloseTo(0.92, 2);
  expect((await main.boundingBox())!.x).toBeGreaterThan(original.x + 200);
  await expect(page.getByRole('button', { name: '닫기', exact: true })).toHaveCount(0);
  const link = page.getByRole('link', { name: '문자 보내기', exact: true });
  await expect(link).toBeVisible();
  await expect(link.locator('svg')).toBeVisible();
  for (const label of ['홈', '수신자 관리', '발송 이력', '발송 템플릿', '비밀번호 변경']) {
    await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: '문자 사용자 프로필', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(close).toHaveCount(0);
  await expect.poll(async () => (await main.boundingBox())!.width / original.width).toBeCloseTo(1, 2);
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toBeChecked();
  await open.click();
  await link.click();
  await expect(page).toHaveURL(/\/sms\/new$/);
  await expect(close).toHaveCount(0);
  await open.click();
  await page.getByRole('button', { name: '문자 사용자 프로필', exact: true }).click();
  await expect(page.getByRole('heading', { name: '프로필', exact: true })).toBeVisible();
  await expect(page.getByText('sms@example.com', { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/nature-profile-${test.info().project.name}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(close).toBeVisible();
  await expect.poll(async () => (await main.boundingBox())!.width / original.width).toBeCloseTo(0.92, 2);
  await page.screenshot({ path: `/tmp/nature-menu-${test.info().project.name}.png`, animations: 'disabled' });
  const shifted = (await main.boundingBox())!;
  const dragStartX = Math.min(page.viewportSize()!.width - 12, shifted.x + 40);
  await page.mouse.move(dragStartX, shifted.y + 100);
  await page.mouse.down();
  await page.mouse.move(dragStartX - 240, shifted.y + 100, { steps: 12 });
  await page.mouse.up();
  await expect(close).toHaveCount(0);
  await open.click();
  await expect.poll(async () => (await main.boundingBox())!.width / original.width).toBeCloseTo(0.92, 2);
  await close.click({ position: { x: 10, y: 80 } });
  await expect(open).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toBeChecked();
});

/**
 * 서랍 발치의 **두 원** — 왼쪽이 「나」(프로필 시트), 오른쪽이 「앱」(설정 화면).
 *
 * 🔴 **이름을 지키는 것이 이 테스트의 몫이다.** 아이콘뿐인 버튼이라 낭독기에는
 * `accessibilityLabel` 이 전부인데, 그 이름이 사라져도 화면은 멀쩡해 보인다 —
 * 눈으로는 끝까지 안 잡히는 고장이라 여기서 붙잡는다.
 *
 * 설정은 **쌓인 화면**이라 머리가 ☰ 가 아니라 「뒤로」다(→ `components/app-navigation.tsx`).
 */
test('서랍 발치의 두 원은 프로필과 설정으로 갈라지고 설정은 뒤로 돌아온다', async ({ page }) => {
  await setup(page);
  const open = page.getByRole('button', { name: '메뉴 열기', exact: true });
  await open.click();
  await expect(page.getByRole('button', { name: '문자 사용자 프로필', exact: true })).toBeVisible();
  const settings = page.getByRole('link', { name: '설정', exact: true });
  await expect(settings).toBeVisible();
  await settings.click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '뒤로', exact: true })).toBeVisible();
  await expect(open).toHaveCount(0);
  /*
    이제 눌리는 줄이다 — 서버가 기기 목록을 주면서 「준비 중」 배지를 걷었다.
    🔴 **배지가 사라졌는지도 함께 본다.** 배지만 남고 링크가 끊기면 화면은 멀쩡해 보이는데
    잃어버린 폰을 끊으러 온 사람은 들어갈 길이 없다(그 화면 자체는 → `tests/e2e/devices.spec.ts`).
  */
  await expect(page.getByRole('button', { name: '로그인 기기 관리', exact: true })).toBeVisible();
  await expect(page.getByText('준비 중', { exact: true })).toHaveCount(0);
  // 문의를 받을 때 「어느 버전 쓰세요?」에 답할 수 있어야 하는 줄. 껍데기 밖이라 한 줄이다.
  await expect(page.getByText('앱 버전', { exact: true })).toBeVisible();
  await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  await expect(page.getByText(/^© 20\d\d(-20\d\d)? REDHEAD — Open by Nature\.$/)).toBeVisible();
  await page.screenshot({ path: `/tmp/nature-settings-${test.info().project.name}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  await expect(page).toHaveURL(/\/sms\/new$/);
  await expect(open).toBeVisible();
});

test('미발송 기본 조회·발송자 포함·전체 선택·최종 발송 이력', async ({ page }) => {
  const state = await setup(page);
  state.people[0].latestSentAt = now;
  state.people[0].sentCount = 1;
  state.people[1].groupId = '친구';
  await page.goto('/sms/new');
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '김영희 발송 이력 보기', exact: true })).toHaveCount(0);
  const groupBox = (await page.getByRole('button', { name: '모든그룹', exact: true }).boundingBox())!;
  const nameFilter = page.getByRole('textbox', { name: '이름,전화번호 뒷자리 4자', exact: true });
  await expect(nameFilter).toHaveAttribute('placeholder', '이름,전화번호 뒷자리 4자');
  const nameBox = (await nameFilter.boundingBox())!;
  expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(nameBox.x);
  expect(Math.abs(groupBox.y + groupBox.height / 2 - nameBox.y - nameBox.height / 2)).toBeLessThan(2);
  await expect(page.getByRole('checkbox', { name: '기발신자포함', exact: true })).toHaveCSS('border-top-width', '0px');
  await expect(page.getByRole('checkbox', { name: '기발신자포함', exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const includeBox = (await page.getByRole('checkbox', { name: '기발신자포함', exact: true }).boundingBox())!;
  const compactBox = (await page.getByRole('button', { name: '간단뷰', exact: true }).boundingBox())!;
  const expandedBox = (await page.getByRole('button', { name: '전체정보뷰', exact: true }).boundingBox())!;
  expect(includeBox.x + includeBox.width).toBeLessThanOrEqual(compactBox.x);
  expect(compactBox.x).toBeLessThan(expandedBox.x);
  await page.getByRole('checkbox', { name: '기발신자포함', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toBeVisible();
  await page.getByLabel('이름,전화번호 뒷자리 4자', { exact: true }).fill('철수');
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toBeVisible();
  // 이름 대신 번호 뒷자리로도 같은 칸에서 찾는다(김영희 +821087654321). 하이픈을 섞어 쳐도 같다.
  await page.getByLabel('이름,전화번호 뒷자리 4자', { exact: true }).fill('4321');
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toBeVisible();
  await page.getByLabel('이름,전화번호 뒷자리 4자', { exact: true }).fill('8765-4321');
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toBeVisible();
  await page.getByLabel('이름,전화번호 뒷자리 4자', { exact: true }).fill('');
  await page.getByRole('button', { name: '모든그룹', exact: true }).click();
  await page.getByRole('menuitem', { name: '모임', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toHaveCount(0);
  await page.getByRole('button', { name: '모임', exact: true }).click();
  await page.getByRole('menuitem', { name: '모든그룹', exact: true }).click();
  await page.screenshot({ path: `/tmp/nature-recipients-table-${test.info().project.name}.png`, animations: 'disabled' });
  const all = page.getByRole('checkbox', { name: '전체 선택', exact: true });
  await all.click();
  await expect(page.getByRole('button', { name: '발송하기', exact: true })).toBeEnabled();
  await expect(selectedCount(page, 2)).toBeVisible();
  if (!isMobile()) {
    const totalBox = (await page.getByText('전체 2명', { exact: true }).boundingBox())!;
    const selectedBox = (await page.getByText('선택 2명', { exact: true }).boundingBox())!;
    expect(selectedBox.x).toBeGreaterThan(totalBox.x);
    expect(selectedBox.y).toBeCloseTo(totalBox.y, 0);
  }
  await all.click();
  await expect(page.getByRole('button', { name: '발송하기', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /김영희/ }).click();
  await expect(all).toHaveAttribute('aria-checked', 'mixed');
  await expect(selectedCount(page, 1)).toBeVisible();
  await page.getByRole('button', { name: '김철수 발송 이력 보기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '김철수 발송 이력', exact: true })).toBeVisible();
  await expect(page.getByText('이전에 보낸 안내입니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
});
test('이미지 템플릿을 편집하고 이미지 단독 MMS를 모의 발송한다', async ({ page }) => {
  const state = await setup(page, true);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=', 'base64');
  await page.goto('/templates');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByLabel('템플릿 이름', { exact: true }).fill('명함 안내');
  await page.getByLabel('템플릿 메시지', { exact: true }).fill('제 명함을 보내드립니다.');
  await page.getByLabel('첨부 이미지 추가', { exact: true }).setInputFiles({ name: '명함.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('button', { name: '명함.png 첨부 삭제', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '명함 안내 수정', exact: true })).toBeVisible();
  await page.goto('/sms/new');
  await page.getByRole('checkbox', { name: /김영희/ }).click();
  await page.getByRole('button', { name: '발송하기', exact: true }).click();
  await page.getByRole('button', { name: '명함 안내 템플릿 선택', exact: true }).click();
  await expect(page.getByLabel('메시지', { exact: true })).toHaveValue('제 명함을 보내드립니다.');
  await page.getByRole('button', { name: '명함.png 첨부 삭제', exact: true }).click();
  await page.getByLabel('첨부 이미지 추가', { exact: true }).setInputFiles({ name: '새명함.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('button', { name: '새명함.png 첨부 삭제', exact: true })).toBeVisible();
  await page.getByLabel('메시지', { exact: true }).focus();
  await page.getByLabel('메시지', { exact: true }).press('ControlOrMeta+A');
  await page.getByLabel('메시지', { exact: true }).press('Backspace');
  await expect(page.getByText('0 / 2,000자 · UTF-8 0 bytes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '1명 발송 준비', exact: true }).click();
  await expect(page.getByRole('heading', { name: '명함 안내', exact: true })).toBeVisible();
  expect(state.targets[0]).toMatchObject({ attachments: [{ name: '새명함.png' }] });
  expect(state.templates[0].attachments[0].name).toBe('명함.png');
  await page.getByRole('button', { name: '1명에게 발송하기', exact: true }).click();
  await expect(page.getByText('성공 1 · 실패 0 · 대기 0', { exact: true })).toBeVisible();
  expect(state.targets[0].message).toBe('');
});
test('엑셀 추가·제외 미리보기를 확인한 뒤 확정 저장한다', async ({ page }) => {
  const state = await setup(page); await page.goto('/recipients');
  await page.getByRole('button', { name: '엑셀 등록', exact: true }).click();
  await page.getByLabel('수신자 엑셀 파일 선택', { exact: true }).setInputFiles({ name: '수신자.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('mock workbook') });
  await expect(page.getByText('등록 미리보기 · 추가 1명 / 제외 2명', { exact: true })).toBeVisible();
  await expect(page.getByText('제외: 김철수, 이순신', { exact: true })).toBeVisible();
  expect(state.people).toHaveLength(2);
  await page.getByRole('button', { name: '추가 1명 확정 저장', exact: true }).click();
  await expect(page.getByText('저장 완료 · 추가 1명 / 제외 2명', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /박영수/ })).toBeVisible();
  expect(state.people).toHaveLength(3);
});

test('첨부 없는 템플릿의 실제 서버 null 응답을 등록·조회·선택한다', async ({ page }) => {
  await setup(page);
  const template = { id: 'legacy-template', name: '첨부 없는 안내', message: '모임 안내입니다.', attachments: null, createdAt: now, updatedAt: now };
  await page.route('**/sms/templates**', route => route.fulfill({ json: route.request().method() === 'GET' ? { items: [template], nextCursor: null } : template }));
  await page.goto('/templates');
  await expect(page.getByRole('button', { name: '첨부 없는 안내 수정', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByLabel('템플릿 이름', { exact: true }).fill('첨부 없는 안내');
  await page.getByLabel('템플릿 메시지', { exact: true }).fill(template.message);
  await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '추가', exact: true })).toBeVisible();
  await page.goto('/sms/new');
  await page.getByRole('checkbox', { name: /김철수/ }).click();
  await page.getByRole('button', { name: '발송하기', exact: true }).click();
  await page.getByRole('button', { name: '첨부 없는 안내 템플릿 선택', exact: true }).click();
  await expect(page.getByLabel('메시지', { exact: true })).toHaveValue(template.message);
  await expect(page.getByText('첨부 이미지 0 / 3', { exact: true })).toBeVisible();
});
test('조회한 125명 전체를 이름순으로 보여주고 화면별 뷰 기본값을 적용한다', async ({ page }, info) => {
  const state = await setup(page);
  state.people.splice(0, state.people.length, ...Array.from({ length: 125 }, (_, i) => ({ id: `p${i + 1}`, name: `사람${String(125 - i).padStart(3, '0')}`, phone: `+8210${String(i).padStart(8, '0')}`, groupId: '모임', createdAt: now, updatedAt: now, customFields: [{ name: '부서', value: '영업부' }, { name: '우편번호', value: '00123' }, ...Array.from({ length: 10 }, (_, column) => ({ name: `추가정보${column + 1}`, value: `내용${column + 1}` }))] })));
  await page.goto('/sms/new');
  await expect(totalCount(page, 125)).toBeVisible();
  const table = page.getByRole('table', { name: '발송 수신자 목록' });
  await expect(table.getByRole('row')).toHaveCount(126);
  await expect(table.getByRole('row').nth(1)).toContainText('사람001');
  await expect(table.getByRole('row').last()).toContainText('사람125');
  const allInfo = page.getByRole('button', { name: '전체정보뷰', exact: true });
  const compact = page.getByRole('button', { name: '간단뷰', exact: true });
  await expect(allInfo).toHaveAttribute('title', '전체정보뷰');
  await expect(compact).toHaveAttribute('title', '간단뷰');
  if (info.project.name === 'mobile') {
    await expect(allInfo).toHaveAttribute('aria-pressed', 'false');
    await expect(compact).toHaveAttribute('aria-pressed', 'true');
    await expect(table.getByRole('columnheader', { name: /^부서/ })).toHaveCount(0);
    await allInfo.click();
  } else await expect(allInfo).toHaveAttribute('aria-pressed', 'true');
  await expect(allInfo).toHaveAttribute('aria-pressed', 'true');
  await expect(compact).toHaveAttribute('aria-pressed', 'false');
  await expect(table.getByRole('columnheader', { name: /^부서/ })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: /^우편번호/ })).toBeAttached();
  const nameHeader = table.getByRole('columnheader', { name: /^이름/ });
  const firstRow = table.getByRole('row').nth(1);
  const nameButton = firstRow.getByRole('button', { name: '사람001 수정', exact: true });
  const rowCheckbox = firstRow.getByRole('checkbox');
  const phoneCell = firstRow.getByRole('cell').nth(2);
  const initial = await Promise.all([nameHeader.boundingBox(), nameButton.boundingBox(), rowCheckbox.boundingBox(), phoneCell.boundingBox()]);
  expect(initial.every(Boolean)).toBe(true);
  const scroll = await table.evaluate((node) => {
    const viewport = node.parentElement!;
    viewport.scrollLeft = 240;
    return { left: viewport.scrollLeft, width: viewport.clientWidth, content: viewport.scrollWidth };
  });
  expect(scroll.content).toBeGreaterThan(scroll.width + 240);
  expect(scroll.left).toBe(240);
  await expect.poll(async () => (await nameHeader.boundingBox())!.x).toBeCloseTo(initial[0]!.x, 0);
  expect((await nameButton.boundingBox())!.x).toBeCloseTo(initial[1]!.x, 0);
  expect((await rowCheckbox.boundingBox())!.x).toBeCloseTo(initial[2]!.x, 0);
  expect((await phoneCell.boundingBox())!.x).toBeCloseTo(initial[3]!.x - scroll.left, 0);
  await rowCheckbox.click();
  await expect(rowCheckbox).toBeChecked();
  await nameButton.click();
  await expect(page.getByLabel('이름', { exact: true })).toHaveValue('사람001');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(rowCheckbox).toBeChecked();
  const beforeVertical = (await nameHeader.boundingBox())!;
  await table.evaluate((node) => { node.parentElement!.scrollTop = 200; });
  await expect.poll(async () => (await nameHeader.boundingBox())!.y).toBeCloseTo(beforeVertical.y, 0);
  expect((await nameHeader.boundingBox())!.x).toBeCloseTo(beforeVertical.x, 0);
  await table.evaluate((node) => { node.parentElement!.scrollTop = 0; node.parentElement!.scrollLeft = 0; });
  await page.getByLabel('이름,전화번호 뒷자리 4자', { exact: true }).fill('사람125');
  await expect(totalCount(page, 1)).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('row').nth(1)).toContainText('00123');
  await page.screenshot({ path: `/tmp/nature-all-columns-${info.project.name}.png`, animations: 'disabled' });
  await page.goto('/recipients');
  await page.getByLabel('이름,전화번호 뒷자리 4자', { exact: true }).fill('사람125');
  await expect(page.getByText('전체 1명', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /사람125/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /사람124/ })).toHaveCount(0);
});

test('열 제목을 눌러 정렬하고 선택은 그대로 둔다', async ({ page }, info) => {
  const state = await setup(page);
  // latestSentAt 을 두면 미발송 기본 조회에서 빠지므로 건수만 준다.
  state.people.push({ id: 'p3', name: '박영수', phone: '+821000000000', groupId: '신규', createdAt: now, updatedAt: now, sentCount: 2 });
  await page.goto('/sms/new');
  const table = page.getByRole('table', { name: '발송 수신자 목록' });
  const firstName = () => table.getByRole('row').nth(1);
  const nameHeader = table.getByRole('columnheader', { name: /^이름/ });
  const nameSort = nameHeader.getByRole('button');
  // 기본은 이름 오름차순이고 현재 열에만 방향 표시가 붙는다.
  await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(nameSort).toHaveAccessibleName('이름, 오름차순 정렬됨. 누르면 내림차순');
  await expect(nameHeader).toContainText('▲');
  await expect(firstName()).toContainText('김영희');
  const selected = page.getByRole('checkbox', { name: /김철수/ });
  await selected.click();
  await nameSort.click();
  await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(nameHeader).toContainText('▼');
  await expect(firstName()).toContainText('박영수');
  await expect(selected).toBeChecked();
  await expect(selectedCount(page, 1)).toBeVisible();
  const phoneHeader = table.getByRole('columnheader', { name: /^전화번호/ });
  await phoneHeader.getByRole('button').click();
  await expect(phoneHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(nameHeader).toHaveAttribute('aria-sort', 'none');
  await expect(firstName()).toContainText('010-0000-0000');
  await expect(table.getByRole('row').last()).toContainText('010-8765-4321');
  await expect(selected).toBeChecked();
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 384, height: 832 });
  await page.screenshot({ path: `/tmp/nature-sort-${info.project.name}.png`, animations: 'disabled' });
  // 0건도 숫자로 함께 줄 선다 — 오름차순이면 맨 앞, 내림차순이면 맨 뒤.
  await page.goto('/recipients');
  const sentHeader = page.getByRole('columnheader', { name: /^발송건수/ });
  await sentHeader.getByRole('button').click();
  await expect(sentHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.getByRole('row').last()).toContainText('박영수');
  await sentHeader.getByRole('button').click();
  await expect(sentHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(page.getByRole('row').nth(1)).toContainText('박영수');
});

test('문자 보내기 헤더의 등록·템플릿·이력 시트에서 작업해도 선택과 페이지를 유지한다', async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByRole('columnheader', { name: '관리', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `/tmp/nature-compose-header-${test.info().project.name}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: '김영희 수정', exact: true }).click();
  await expect(page.getByLabel('이름', { exact: true })).toHaveValue('김영희');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('checkbox', { name: /김영희/ }).click();
  await page.getByRole('button', { name: '수신자 등록', exact: true }).click();
  await expect(page.getByRole('heading', { name: '수신자 등록', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '엑셀 가져오기', exact: true }).click();
  await expect(page.getByLabel('수신자 엑셀 파일 선택', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '엑셀 가져오기', exact: true }).click();
  await page.getByLabel('이름', { exact: true }).fill('새 수신자');
  await page.getByLabel('전화번호', { exact: true }).fill('010-7777-8888');
  await page.getByLabel('그룹', { exact: true }).fill('추가');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('수신자를 등록했습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /새 수신자/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toBeChecked();
  await page.getByRole('button', { name: '템플릿', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '추가', exact: true }).click();
  await page.getByLabel('템플릿 이름', { exact: true }).fill('시트 안내');
  await page.getByLabel('템플릿 메시지', { exact: true }).fill('최초 문구');
  await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
  await page.getByRole('button', { name: '시트 안내 수정', exact: true }).click();
  await expect(page.getByLabel('템플릿 메시지', { exact: true })).toHaveValue('최초 문구');
  await page.getByLabel('템플릿 메시지', { exact: true }).fill('수정 문구');
  await page.getByRole('button', { name: '템플릿 저장', exact: true }).click();
  await expect(page.getByText('수정 문구', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  expect(state.templates).toHaveLength(1);
  expect(state.templates[0].message).toBe('수정 문구');

  const queries: string[] = [];
  const recent = { id: 'history-new', campaignId: 'c-new', campaignTitle: '최근 발송', recipientId: 'p2', name: '김영희', phone: '01087654321', message: '최근 안내 문구', status: 'SENT', sentAt: '2026-09-17T01:00:00Z', createdAt: now, updatedAt: now, attachments: null };
  const older = { ...recent, id: 'history-old', campaignId: 'c-old', campaignTitle: '과거 발송', recipientId: 'p1', name: '김철수', message: '과거 안내 문구', sentAt: now };
  await page.route('**/sms/history?*', route => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    queries.push(q);
    return route.fulfill({ json: { items: q === '철수' ? [older] : [recent, older], nextCursor: null, total: q ? 1 : 2 } });
  });
  await page.getByRole('button', { name: '발송 이력', exact: true }).click();
  await expect(page.getByRole('heading', { name: '발송 이력', exact: true })).toBeVisible();
  await expect(page.getByText('전체 2건', { exact: true })).toBeVisible();
  // 처음에는 한 줄짜리 목록이다(최신순) — 본문은 그 줄을 눌러야 펼쳐진다.
  await expect(page.getByText(/^(최근|과거) 안내 문구$/)).toHaveCount(0);
  const lines = page.getByRole('button', { name: /발송 이력 펼치기$/ });
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toContainText('김영희');
  await expect(lines.first()).toContainText('최근 발송');
  await expect(lines.first()).toContainText('성공');
  await page.getByRole('button', { name: '김철수 과거 발송 발송 이력 펼치기', exact: true }).click();
  await expect(page.getByText('과거 안내 문구', { exact: true })).toBeVisible();
  await expect(page.getByText('최근 안내 문구', { exact: true })).toHaveCount(0);
  const openedLine = page.getByRole('button', { name: '김철수 과거 발송 발송 이력 접기', exact: true });
  await expect(openedLine).toHaveAttribute('aria-expanded', 'true');
  // 같은 줄을 다시 누르면 접힌다.
  await openedLine.click();
  await expect(page.getByText('과거 안내 문구', { exact: true })).toHaveCount(0);
  await page.getByLabel('이름,전화번호 뒷자리 4자', { exact: true }).last().fill('철수');
  await expect(page.getByText('전체 1건', { exact: true })).toBeVisible();
  await expect(lines).toHaveCount(1);
  expect(queries).toContain('철수');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page).toHaveURL(/\/sms\/new$/);
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toBeChecked();
  await page.getByLabel('이름,전화번호 뒷자리 4자', { exact: true }).fill('김영희');
  await expect(totalCount(page, 1)).toBeVisible();
  expect(state.results).toHaveLength(0);
});

test('미완료 캠페인은 이력 시트에서 복구하되 상세 열기만으로 발송하지 않는다', async ({ page }) => {
  const state = await setup(page, true);
  await compose(page);
  await page.route('**/sms/history?*', route => route.fulfill({ json: { items: [], nextCursor: null, total: 0 } }));
  await page.goto('/sms/new');
  await page.getByRole('button', { name: '발송 이력', exact: true }).click();
  await page.getByRole('button', { name: '미완료 발송 확인', exact: true }).click();
  await page.getByRole('button', { name: '9월 모임 안내 발송 상세', exact: true }).click();
  await expect(page.getByRole('button', { name: '닫기', exact: true })).toBeVisible();
  const send = page.getByRole('button', { name: '2명에게 발송하기', exact: true });
  await expect(send).toBeEnabled();
  expect(state.results).toHaveLength(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test.sms.calls') || '[]'))).toEqual([]);
  await expect(page).toHaveURL(/\/sms\/new$/);
  await send.click();
  await expect(page.getByText('성공 2 · 실패 0 · 대기 0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '발송 이력으로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByLabel('이름,전화번호 뒷자리 4자', { exact: true })).toBeEditable();
  expect(state.results).toEqual(['cr0', 'cr1']);
});

test('외부 발송 등록은 응답 유실 후에도 한 건만 저장하고 SMS 없이 집계와 이력을 갱신한다', async ({ page }) => {
  const state = await setup(page, true);
  const requests: { requestId: string; sentAt: string }[] = [];
  let entry: Record<string, unknown> | null = null;
  let loseResponse = true;
  await page.route('**/recipients/p1/external-sends', route => {
    const input = route.request().postDataJSON();
    requests.push(input);
    if (!entry) {
      state.people[0].sentCount = 1;
      state.people[0].latestSentAt = input.sentAt;
      entry = { id: 'external-1', source: 'EXTERNAL', campaignTitle: '외부 발송 등록', recipientId: 'p1', name: '김철수', phone: '01012345678', message: '', status: 'SENT', sentAt: input.sentAt, createdAt: now, updatedAt: now, attachments: [] };
    }
    if (loseResponse) { loseResponse = false; return route.abort('failed'); }
    return route.fulfill({ json: { recipient: state.people[0], history: entry } });
  });
  await page.route('**/recipients/p1/history?*', route => route.fulfill({ json: { items: entry ? [entry] : [], nextCursor: null } }));
  await page.route('**/sms/history?*', route => route.fulfill({ json: { items: entry ? [entry] : [], nextCursor: null, total: entry ? 1 : 0 } }));
  await page.getByRole('button', { name: '김철수 수정', exact: true }).click();
  await page.getByRole('button', { name: '발송등록', exact: true }).click();
  await page.getByLabel('발송일시', { exact: true }).fill('2999-01-01 12:00');
  await page.getByRole('button', { name: '발송 기록 저장', exact: true }).click();
  await expect(page.getByText('미래의 발송일시는 등록할 수 없어요.', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByLabel('발송일시', { exact: true }).fill('2026-09-15 14:30');
  await page.getByRole('button', { name: '발송 기록 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '같은 발송 기록 요청 다시 확인', exact: true })).toBeEnabled();
  await expect(page.getByLabel('발송일시', { exact: true })).not.toBeEditable();
  expect(requests).toHaveLength(1);
  await page.reload();
  await page.getByRole('checkbox', { name: '기발신자포함', exact: true }).click();
  await page.getByRole('button', { name: '김철수 수정', exact: true }).click();
  await page.getByRole('button', { name: '발송등록', exact: true }).click();
  await page.getByRole('button', { name: '같은 발송 기록 요청 다시 확인', exact: true }).click();
  await expect(page.getByText('외부 발송 기록 1건을 등록했습니다.', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(state.people[0].sentCount).toBe(1);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('button', { name: '김철수 발송 이력 보기', exact: true })).toContainText('1건');
  await page.getByRole('checkbox', { name: '기발신자포함', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '기발신자포함', exact: true }).click();
  await page.getByRole('button', { name: '김철수 발송 이력 보기', exact: true }).click();
  await expect(page.getByText('외부에서 발송한 기록입니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '발송 이력', exact: true }).click();
  // 이력은 한 줄로 서고, 누르면 그 자리에서 펼쳐진다.
  await page.getByRole('button', { name: '김철수 외부 발송 등록 발송 이력 펼치기', exact: true }).click();
  await expect(page.getByText('외부에서 발송한 기록입니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '외부 발송 등록 발송 상세', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test.sms.calls') || '[]'))).toEqual([]);
  expect(state.campaigns).toHaveLength(0);
});


test('50명은 발송 가능하고 51명은 버튼 안의 빨간 제한 안내로 막는다', async ({ page }) => {
  const state = await setup(page);
  state.people.splice(0, state.people.length, ...Array.from({ length: 51 }, (_, i) => ({ id: `limit-${i}`, name: `대상${String(i + 1).padStart(2, '0')}`, phone: `010${String(i).padStart(8, '0')}`, groupId: i < 50 ? '첫 50명' : '추가', createdAt: now, updatedAt: now, customFields: [] })));
  await page.goto('/sms/new');
  await page.getByRole('button', { name: '모든그룹', exact: true }).click();
  await page.getByRole('menuitem', { name: '첫 50명', exact: true }).click();
  await page.getByRole('checkbox', { name: '전체 선택', exact: true }).click();
  await expect(page.getByRole('button', { name: '발송하기', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '첫 50명', exact: true }).click();
  await page.getByRole('menuitem', { name: '모든그룹', exact: true }).click();
  await expect(selectedCount(page, 50)).toBeVisible();
  await page.getByRole('checkbox', { name: /대상51/ }).click();
  const warning = '51명을 선택했어요. 한 번에 50명까지 발송·예약할 수 있어요.';
  await expect(page.getByRole('button', { name: '발송하기', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '예약하기', exact: true })).toBeDisabled();
  // 50명을 넘겨도 삭제는 막지 않는다 — 인원 제한은 캠페인 생성 쪽 제약이다.
  await expect(page.getByRole('button', { name: '삭제', exact: true })).toBeEnabled();
  const rgb = await page.getByText(warning, { exact: true }).evaluate(node => getComputedStyle(node).color.match(/\d+/g)!.map(Number));
  expect(rgb[0]).toBeGreaterThan(rgb[1] * 2);
  expect(rgb[0]).toBeGreaterThan(rgb[2] * 2);
  expect(state.campaigns).toHaveLength(0);
  await page.getByRole('checkbox', { name: /대상51/ }).click();
  await expect(page.getByText(warning, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '발송하기', exact: true })).toBeEnabled();
});

const autumn = { id: 't-autumn', name: '가을 안내', message: '가을 모임 안내입니다.', attachments: [], createdAt: now, updatedAt: now };
async function reserve(page: Page, names: RegExp[], template = '가을 안내') {
  await page.goto('/sms/new');
  for (const name of names) await page.getByRole('checkbox', { name }).click();
  await page.getByRole('button', { name: '예약하기', exact: true }).click();
  await page.getByRole('checkbox', { name: template, exact: true }).click();
  await page.getByRole('button', { name: '예약 확인', exact: true }).click();
}

test('선택한 수신자를 템플릿으로 예약하고 예약함에서 발송으로 넘어간다', async ({ page }) => {
  const state = await setup(page);
  state.templates.push({ ...autumn });
  await page.goto('/sms/new');
  await page.getByRole('checkbox', { name: /김철수/ }).click();
  await page.getByRole('button', { name: '예약하기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '예약하기', exact: true })).toBeVisible();
  await expect(page.getByText('수신자 1명 선택', { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/nature-reserve-sheet-${test.info().project.name}.png`, animations: 'disabled' });
  await page.getByRole('checkbox', { name: '가을 안내', exact: true }).click();
  await page.getByRole('button', { name: '예약 확인', exact: true }).click();
  await expect(page.getByText('1명을 「가을 안내」 템플릿으로 예약했어요.', { exact: true })).toBeVisible();
  expect(state.campaigns).toHaveLength(1);
  expect(state.campaigns[0].status).toBe('READY');
  expect(state.results).toHaveLength(0);
  // 예약한 사람만 목록 이름 왼쪽에 표시가 붙는다.
  await expect(page.getByRole('img', { name: '예약됨', exact: true })).toHaveCount(1);
  await page.screenshot({ path: `/tmp/nature-reserve-mark-${test.info().project.name}.png`, animations: 'disabled' });
  // 이미 예약된 사람만 고르면 새 예약을 만들지 않는다.
  await page.getByRole('checkbox', { name: /김철수/ }).click();
  await page.getByRole('button', { name: '예약하기', exact: true }).click();
  await page.getByRole('checkbox', { name: '가을 안내', exact: true }).click();
  await page.getByRole('button', { name: '예약 확인', exact: true }).click();
  await expect(page.getByText('선택한 1명은 이미 예약되어 있어요. 새로 예약하지 않았어요.', { exact: true })).toBeVisible();
  expect(state.campaigns).toHaveLength(1);
  // 예약함에서 같은 사람을 확인하고 발송 상세로 넘어간다.
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await page.getByRole('link', { name: '예약 문자 보내기', exact: true }).click();
  await expect(page).toHaveURL(/\/sms\/reserved$/);
  // 템플릿 태그가 하나면 그 태그가 자동으로 골라져 있고 목록은 그 템플릿만 보여 준다.
  await expect(page.getByRole('button', { name: '가을 안내 예약 1명', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('columnheader', { name: '템플릿명' })).toHaveCount(0);
  const row = page.getByRole('checkbox', { name: '김철수 · 010-1234-5678', exact: true });
  await expect(row).toBeVisible();
  await expect(page.getByRole('button', { name: '발송', exact: true })).toBeDisabled();
  await row.click();
  await page.screenshot({ path: `/tmp/nature-reserved-screen-${test.info().project.name}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: '발송', exact: true }).click();
  await expect(page).toHaveURL(/\/sms\/c1$/);
  await expect(page.getByRole('heading', { name: '가을 안내', exact: true })).toBeVisible();
  expect(state.campaigns[0].status).toBe('READY');
});

test('예약함은 고른 태그 안에서 이름·폰번호 뒷4자리로 좁힌다', async ({ page }) => {
  const state = await setup(page);
  state.people.push({ id: 'p3', name: '박영수', phone: '+821011112222', groupId: '모임', createdAt: now, updatedAt: now });
  state.templates.push({ ...autumn });
  state.templates.push({ ...autumn, id: 't-fee', name: '회비 안내', message: '회비 안내드립니다.' });
  await reserve(page, [/김철수/, /김영희/]);
  await reserve(page, [/박영수/], '회비 안내');
  await page.goto('/sms/reserved');
  const search = page.getByRole('textbox', { name: '이름,전화번호 뒷자리 4자', exact: true });
  // 뒷4자리로 찾는다(김영희 +821087654321).
  await search.fill('4321');
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toHaveCount(0);
  await expect(page.getByText('가을 안내 1명 · 선택 0명', { exact: true })).toBeVisible();
  // 전체 선택은 보이는 줄만 고른다.
  await page.getByRole('checkbox', { name: '전체 선택', exact: true }).click();
  await expect(page.getByText('가을 안내 1명 · 선택 1명', { exact: true })).toBeVisible();
  // 검색은 고른 태그 안에서만 좁힌다 — 다른 태그의 박영수는 올라오지 않는다.
  await search.fill('박영수');
  await expect(page.getByRole('checkbox', { name: /박영수/ })).toHaveCount(0);
  await expect(page.getByText('검색어에 해당하는 예약이 없습니다.', { exact: true })).toBeVisible();
  await expect(page.getByText('가을 안내 0명 · 선택 0명', { exact: true })).toBeVisible();
  // 태그를 옮기면 검색어도 지운다. 남겨 두면 옮긴 태그가 통째로 빈 것처럼 보인다.
  await page.getByRole('button', { name: '회비 안내 예약 1명', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: /박영수/ })).toBeVisible();
});

test('예약함 삭제는 수신자를 남기고 예약만 취소한다', async ({ page }) => {
  const state = await setup(page);
  state.people.push({ id: 'p3', name: '박영수', phone: '+821011112222', groupId: '모임', createdAt: now, updatedAt: now });
  state.templates.push({ ...autumn });
  state.templates.push({ ...autumn, id: 't-fee', name: '회비 안내', message: '회비 안내드립니다.' });
  await reserve(page, [/김철수/, /김영희/]);
  await expect(page.getByText('2명을 「가을 안내」 템플릿으로 예약했어요.', { exact: true })).toBeVisible();
  await reserve(page, [/박영수/], '회비 안내');
  await page.goto('/sms/reserved');
  // 인원수가 많은 태그가 먼저 오고 자동으로 골라진다. 다른 템플릿의 예약은 보이지 않는다.
  const autumnTag = page.getByRole('button', { name: '가을 안내 예약 2명', exact: true });
  const feeTag = page.getByRole('button', { name: '회비 안내 예약 1명', exact: true });
  await expect(autumnTag).toHaveAttribute('aria-pressed', 'true');
  await expect(feeTag).toHaveAttribute('aria-pressed', 'false');
  expect((await autumnTag.boundingBox())!.x).toBeLessThan((await feeTag.boundingBox())!.x);
  await expect(page.getByRole('checkbox', { name: /박영수/ })).toHaveCount(0);
  // 태그를 바꾸면 목록도 선택도 바뀐다.
  await page.getByRole('checkbox', { name: /김영희/ }).click();
  await feeTag.click();
  await expect(feeTag).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('checkbox', { name: /박영수/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toHaveCount(0);
  await expect(page.getByText('회비 안내 1명 · 선택 0명', { exact: true })).toBeVisible();
  await autumnTag.click();
  await expect(page.getByRole('checkbox', { name: /김영희/ })).not.toBeChecked();
  await page.getByRole('checkbox', { name: /김영희/ }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByText('선택한 1명을 예약에서 뺄까요?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '예약 취소 되돌리기', exact: true }).click();
  expect(state.campaigns).toHaveLength(2);
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('button', { name: '예약 취소 확인', exact: true }).click();
  await expect(page.getByText('1명의 예약을 취소했어요.', { exact: true })).toBeVisible();
  // 남는 사람으로 새 예약을 먼저 만든 뒤 기존 예약을 취소한다(가을 c1 → c3, 회비 c2 는 그대로).
  expect(state.campaigns.map(c => c.status)).toEqual(['CANCELLED', 'READY', 'READY']);
  expect(state.campaigns[2]).toMatchObject({ title: '가을 안내', recipientCount: 1 });
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toHaveCount(0);
  // 수신자 자체는 그대로 남는다.
  expect(state.people).toHaveLength(3);
  // 마지막 한 명까지 빼면 새 예약 없이 기존 예약만 취소한다.
  await page.getByRole('checkbox', { name: /김철수/ }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('button', { name: '예약 취소 확인', exact: true }).click();
  // 「가을 안내」 태그가 사라지면 남은 태그로 넘어간다.
  await expect(feeTag).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('checkbox', { name: /박영수/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /박영수/ }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('button', { name: '예약 취소 확인', exact: true }).click();
  // 예약이 하나도 없으면 태그 줄도 조작도 없이 빈 상태 문구만 남는다.
  await expect(page.getByText('예약된 문자가 없어요. 「문자 보내기」에서 수신자를 고르고 예약하기를 눌러 주세요.', { exact: true })).toBeVisible();
  await expect(feeTag).toHaveCount(0);
  await expect(page.getByRole('button', { name: '발송', exact: true })).toHaveCount(0);
  expect(state.campaigns.map(c => c.status)).toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED']);
  expect(state.people).toHaveLength(3);
});

test('헤더 아이콘은 마우스를 올리면 이름 말풍선을 띄운다', async ({ page }) => {
  // 터치 기기에는 hover 가 없어 말풍선도 뜨지 않는 것이 맞다.
  test.skip(isMobile(), 'hover 가 없는 기기');
  await setup(page);
  await page.setViewportSize({ width: 384, height: 832 });
  const button = page.getByRole('button', { name: '발송 이력', exact: true });
  await expect(button).toBeVisible();
  const tooltip = page.getByText('발송 이력', { exact: true });
  await expect(tooltip).toHaveCount(0);
  await button.hover();
  await expect(tooltip).toBeVisible();
  // 브라우저 기본 툴팁(title)은 뜨는 데 1초 넘게 걸려 쓰지 않는다.
  await expect(button).not.toHaveAttribute('title', /./);
  await page.screenshot({ path: `/tmp/nature-header-tooltip-${test.info().project.name}.png`, animations: 'disabled' });
  await page.mouse.move(5, 400);
  await expect(tooltip).toHaveCount(0);
});

test('문자 보내기의 삭제는 확인을 거치고 예약이 남는다는 것을 알린다', async ({ page }) => {
  const state = await setup(page);
  state.templates.push({ ...autumn });
  await page.goto('/sms/new');
  await page.getByRole('checkbox', { name: /김영희/ }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('heading', { name: '수신자 삭제', exact: true })).toBeVisible();
  await expect(page.getByText('선택한 1명을 영구 삭제할까요? 되돌릴 수 없어요.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '수신자 삭제 취소', exact: true }).click();
  expect(state.people).toHaveLength(2);
  // 예약된 사람을 지우면 예약이 남는다는 경고를 함께 준다.
  await reserve(page, [/김철수/]);
  await page.getByRole('checkbox', { name: /김철수/ }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByText(/이 중 1명은 예약되어 있어요\./)).toBeVisible();
  await page.getByRole('button', { name: '수신자 삭제 취소', exact: true }).click();
  // 예약되지 않은 사람만 남기면 경고도 사라진다.
  await page.getByRole('checkbox', { name: /김철수/ }).click();
  await page.getByRole('checkbox', { name: /김영희/ }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByText(/이 중 1명은 예약되어 있어요\./)).toHaveCount(0);
  await page.getByRole('button', { name: '수신자 삭제 확인', exact: true }).click();
  await expect(page.getByText('1명을 삭제했어요.', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toHaveCount(0);
  expect(state.people).toHaveLength(1);
});

test('같은 템플릿으로 다시 예약하면 기존 예약과 합치고 50명이 넘으면 나눈다', async ({ page }) => {
  const state = await setup(page);
  state.templates.push({ ...autumn });
  state.people.splice(0, state.people.length, ...Array.from({ length: 55 }, (_, i) => ({ id: `m${i}`, name: `대상${String(i + 1).padStart(2, '0')}`, phone: `010${String(i).padStart(8, '0')}`, groupId: i < 50 ? '앞50' : '뒤5', createdAt: now, updatedAt: now, customFields: [] })));
  async function reserveGroup(from: string, to: string) {
    await page.getByRole('button', { name: from, exact: true }).click();
    await page.getByRole('menuitem', { name: to, exact: true }).click();
    await page.getByRole('checkbox', { name: '전체 선택', exact: true }).click();
    await page.getByRole('button', { name: '예약하기', exact: true }).click();
    await page.getByRole('checkbox', { name: '가을 안내', exact: true }).click();
    await page.getByRole('button', { name: '예약 확인', exact: true }).click();
  }
  await page.goto('/sms/new');
  await reserveGroup('모든그룹', '앞50');
  await expect(page.getByText('50명을 「가을 안내」 템플릿으로 예약했어요.', { exact: true })).toBeVisible();
  expect(state.campaigns).toHaveLength(1);
  expect(state.campaigns[0]).toMatchObject({ reserved: true, recipientCount: 50 });
  // 같은 템플릿으로 5명을 더 예약하면 기존 건을 흡수해 50 + 5 두 건으로 다시 만든다.
  await reserveGroup('앞50', '뒤5');
  await expect(page.getByText('5명을 「가을 안내」 템플릿으로 예약했어요. 이미 예약돼 있던 50명과 합쳤어요. 한 건은 50명까지라 50명씩 2건으로 나눠 예약했어요.', { exact: true })).toBeVisible();
  expect(state.campaigns.map(c => c.status)).toEqual(['CANCELLED', 'READY', 'READY']);
  expect(state.campaigns.slice(1).map(c => c.recipientCount)).toEqual([50, 5]);
  // 예약함에서는 태그 하나로 55명이 모여 보이고, 보내기만 건별로 한다.
  await page.goto('/sms/reserved');
  await expect(page.getByRole('button', { name: '가을 안내 예약 55명', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: '전체 선택', exact: true }).click();
  await expect(page.getByText('「가을 안내」 예약은 인원이 많아 2건으로 나뉘어 있어요. 보내기는 한 건씩 하면 되니 한 건 안에서 골라 주세요.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '발송', exact: true })).toBeDisabled();
});

test('발송 준비만 해 둔 문자는 예약으로 보지 않는다', async ({ page }) => {
  const state = await setup(page);
  await compose(page);
  expect(state.campaigns[0]).toMatchObject({ status: 'READY', reserved: false });
  await page.goto('/sms/reserved');
  await expect(page.getByText('예약된 문자가 없어요. 「문자 보내기」에서 수신자를 고르고 예약하기를 눌러 주세요.', { exact: true })).toBeVisible();
  await page.goto('/sms/new');
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toBeVisible();
  await expect(page.getByRole('img', { name: '예약됨', exact: true })).toHaveCount(0);
});
