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
        campaign = { ...input, id: 'c1', status: 'READY', recipientCount: input.recipientIds.length, attachments: state.attachments.filter(a => (input.attachmentIds || []).includes(a.id)), createdAt: now };
        state.campaigns.push(campaign!);
        state.targets = input.recipientIds.map((id: string, i: number) => ({ ...state.people.find(p => p.id === id)!, id: `cr${i}`, recipientId: id, campaignId: 'c1', message: input.message, attachments: state.attachments.filter(a => (input.attachmentIds || []).includes(a.id)), status: 'READY' }));
      }
      if (state.failCreate) { state.failCreate = false; return route.abort('failed'); }
      return route.fulfill({ json: campaign });
    }
    const campaign = state.campaigns[0];
    if (path.endsWith('/start')) { campaign.status = 'SENDING'; return route.fulfill({ json: campaign }); }
    if (path.endsWith('/cancel')) { campaign.status = 'CANCELLED'; return route.fulfill({ json: campaign }); }
    if (path.endsWith('/recipients')) return route.fulfill({ json: { items: state.targets } });
    if (path.includes('/recipients/')) {
      const target = state.targets.find(r => r.id === path.split('/').pop())!;
      const input = request.postDataJSON();
      if (input.status !== 'SENDING' && state.failSave) return route.abort('failed');
      Object.assign(target, input);
      if (input.status === 'SENT') state.results.push(target.id);
      if (state.targets.every(r => r.status === 'SENT')) campaign.status = 'COMPLETED';
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
  await page.getByRole('button', { name: '2명에게 발송', exact: true }).click();
  await page.getByRole('button', { name: '직접 작성', exact: true }).click();
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
test('웹은 캠페인을 만들고 조회하지만 SMS를 발송하지 않는다', async ({ page }) => {
  const state = await setup(page); await compose(page);
  await expect(page.getByRole('heading', { name: '9월 모임 안내' })).toBeVisible();
  await expect(page.getByText(/이 기능은 Android 앱에서/)).toBeVisible();
  await expect(page.getByRole('button', { name: '2명에게 전송', exact: true })).toBeDisabled();
  expect(state.targets.every(r => r.status === 'READY')).toBeTruthy();
});
test('생성 응답 유실과 새로고침에도 같은 캠페인을 확인한다', async ({ page }) => {
  const state = await setup(page); state.failCreate = true; await compose(page);
  await expect(page.getByRole('button', { name: '같은 캠페인 생성 요청 다시 확인' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '같은 캠페인 생성 요청 다시 확인' }).click();
  await expect(page.getByRole('heading', { name: '9월 모임 안내' })).toBeVisible();
  expect(state.campaigns).toHaveLength(1);
});
test('모의 Android 발송은 명시 클릭 후 순차 저장하고 SENT를 다시 보내지 않는다', async ({ page }) => {
  const state = await setup(page, true); await compose(page);
  const send = page.getByRole('button', { name: '2명에게 전송', exact: true });
  await expect(send).toBeEnabled(); expect(state.results).toHaveLength(0);
  await send.click();
  await expect(page.getByText('성공 2 · 실패 0 · 대기 0', { exact: true })).toBeVisible();
  expect(state.results).toEqual(['cr0', 'cr1']);
  await page.reload();
  await expect(page.getByText('성공 2 · 실패 0 · 대기 0', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test.sms.calls') || '[]'))).toEqual(['cr0', 'cr1']);
});
test('결과 저장 실패는 다음 발송을 막고 재접속은 결과만 복원한다', async ({ page }) => {
  const state = await setup(page, true); await compose(page); state.failSave = true;
  await page.getByRole('button', { name: '2명에게 전송', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('test.sms.calls') || '[]').length)).toBe(1);
  await expect(page.getByRole('button', { name: '결과 동기화', exact: true })).toBeEnabled();
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

test('메뉴에는 문자 보내기와 하단 프로필만 표시하고 닫기·Escape로 복귀한다', async ({ page }) => {
  await setup(page);
  const open = page.getByRole('button', { name: '메뉴 열기', exact: true });
  await open.click();
  await expect(page.getByRole('dialog').getByRole('img', { name: 'Nature', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '문자 보내기', exact: true })).toBeVisible();
  for (const label of ['홈', '수신자 관리', '발송 이력', '발송 템플릿', '비밀번호 변경']) {
    await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: '문자 사용자 프로필', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '닫기', exact: true })).not.toBeVisible();
  await open.click();
  await page.getByRole('link', { name: '문자 보내기', exact: true }).click();
  await expect(page).toHaveURL(/\/sms\/new$/);
  await expect(page.getByRole('button', { name: '닫기', exact: true })).not.toBeVisible();
  await open.click();
  await page.getByRole('button', { name: '문자 사용자 프로필', exact: true }).click();
  await expect(page.getByRole('heading', { name: '프로필', exact: true })).toBeVisible();
  await expect(page.getByText('sms@example.com', { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/nature-profile-${test.info().project.name}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await open.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: `/tmp/nature-menu-${test.info().project.name}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(open).toBeVisible();
});

test('미발송 기본 조회·발송자 포함·전체 선택·최종 발송 이력', async ({ page }) => {
  const state = await setup(page);
  state.people[0].latestSentAt = now;
  state.people[1].groupId = '친구';
  await page.goto('/sms/new');
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toBeVisible();
  await page.getByRole('checkbox', { name: '발송한 수신자 포함', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toBeVisible();
  await page.getByLabel('수신자 이름', { exact: true }).fill('철수');
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toBeVisible();
  await page.getByLabel('수신자 이름', { exact: true }).fill('');
  await page.getByRole('button', { name: '모임', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toHaveCount(0);
  await page.getByRole('button', { name: '모든 그룹', exact: true }).click();
  await page.screenshot({ path: `/tmp/nature-recipients-table-${test.info().project.name}.png`, animations: 'disabled' });
  const all = page.getByRole('checkbox', { name: '전체 선택', exact: true });
  await all.click();
  await expect(page.getByRole('button', { name: '2명에게 발송', exact: true })).toBeEnabled();
  await all.click();
  await expect(page.getByRole('button', { name: '0명에게 발송', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /김영희/ }).click();
  await expect(all).toHaveAttribute('aria-checked', 'mixed');
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
  await page.getByRole('button', { name: '1명에게 발송', exact: true }).click();
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
  await page.getByRole('button', { name: '1명에게 전송', exact: true }).click();
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
  await page.getByRole('button', { name: '1명에게 발송', exact: true }).click();
  await page.getByRole('button', { name: '첨부 없는 안내 템플릿 선택', exact: true }).click();
  await expect(page.getByLabel('메시지', { exact: true })).toHaveValue(template.message);
  await expect(page.getByText('첨부 이미지 0 / 3', { exact: true })).toBeVisible();
});
test('조회한 125명 전체를 이름순으로 보여주고 화면별 모든정보 기본값을 적용한다', async ({ page }, info) => {
  const state = await setup(page);
  state.people.splice(0, state.people.length, ...Array.from({ length: 125 }, (_, i) => ({ id: `p${i + 1}`, name: `사람${String(125 - i).padStart(3, '0')}`, phone: `+8210${String(i).padStart(8, '0')}`, groupId: '모임', createdAt: now, updatedAt: now, customFields: [{ name: '부서', value: '영업부' }, { name: '우편번호', value: '00123' }, ...Array.from({ length: 10 }, (_, column) => ({ name: `추가정보${column + 1}`, value: `내용${column + 1}` }))] })));
  await page.goto('/sms/new');
  await expect(page.getByText('전체 125명', { exact: true })).toBeVisible();
  const table = page.getByRole('table', { name: '발송 수신자 목록' });
  await expect(table.getByRole('row')).toHaveCount(126);
  await expect(table.getByRole('row').nth(1)).toContainText('사람001');
  await expect(table.getByRole('row').last()).toContainText('사람125');
  const allInfo = page.getByRole('checkbox', { name: '모든정보', exact: true });
  if (info.project.name === 'mobile') {
    await expect(allInfo).not.toBeChecked();
    await expect(table.getByRole('columnheader', { name: '부서', exact: true })).toHaveCount(0);
    await allInfo.click();
  } else await expect(allInfo).toBeChecked();
  await expect(table.getByRole('columnheader', { name: '부서', exact: true })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: '우편번호', exact: true })).toBeAttached();
  const nameHeader = table.getByRole('columnheader', { name: '이름', exact: true });
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
  await page.getByLabel('수신자 이름', { exact: true }).fill('사람125');
  await expect(page.getByText('전체 1명', { exact: true })).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('row').nth(1)).toContainText('00123');
  await page.screenshot({ path: `/tmp/nature-all-columns-${info.project.name}.png`, animations: 'disabled' });
  await page.goto('/recipients');
  await page.getByLabel('수신자 이름', { exact: true }).fill('사람125');
  await expect(page.getByText('전체 1명', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /사람125/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /사람124/ })).toHaveCount(0);
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
  const texts = page.getByText(/^(최근|과거) 안내 문구$/);
  await expect(texts).toHaveText(['최근 안내 문구', '과거 안내 문구']);
  await page.getByLabel('발송 이력 이름', { exact: true }).fill('철수');
  await expect(page.getByText('전체 1건', { exact: true })).toBeVisible();
  await expect(page.getByText('최근 안내 문구', { exact: true })).toHaveCount(0);
  expect(queries).toContain('철수');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page).toHaveURL(/\/sms\/new$/);
  await expect(page.getByRole('checkbox', { name: /김영희/ })).toBeChecked();
  await page.getByLabel('수신자 이름', { exact: true }).fill('김영희');
  await expect(page.getByText('전체 1명', { exact: true })).toBeVisible();
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
  const send = page.getByRole('button', { name: '2명에게 전송', exact: true });
  await expect(send).toBeEnabled();
  expect(state.results).toHaveLength(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test.sms.calls') || '[]'))).toEqual([]);
  await expect(page).toHaveURL(/\/sms\/new$/);
  await send.click();
  await expect(page.getByText('성공 2 · 실패 0 · 대기 0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '발송 이력으로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByLabel('수신자 이름', { exact: true })).toBeEditable();
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
  await page.getByRole('checkbox', { name: '발송한 수신자 포함', exact: true }).click();
  await page.getByRole('button', { name: '김철수 수정', exact: true }).click();
  await page.getByRole('button', { name: '발송등록', exact: true }).click();
  await page.getByRole('button', { name: '같은 발송 기록 요청 다시 확인', exact: true }).click();
  await expect(page.getByText('외부 발송 기록 1건을 등록했습니다.', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(state.people[0].sentCount).toBe(1);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('button', { name: '김철수 발송 이력 보기', exact: true })).toContainText('1건');
  await page.getByRole('checkbox', { name: '발송한 수신자 포함', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /김철수/ })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '발송한 수신자 포함', exact: true }).click();
  await page.getByRole('button', { name: '김철수 발송 이력 보기', exact: true }).click();
  await expect(page.getByText('외부에서 발송한 기록입니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '발송 이력', exact: true }).click();
  await expect(page.getByText('외부에서 발송한 기록입니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '외부 발송 등록 발송 상세', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test.sms.calls') || '[]'))).toEqual([]);
  expect(state.campaigns).toHaveLength(0);
});
