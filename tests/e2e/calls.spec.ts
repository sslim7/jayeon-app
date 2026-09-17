import { expect, test, type Page } from '@playwright/test';
import type { CallRecord } from '../../src/types/calls';

const call: CallRecord = { call_id: 'call-1', contact: { name: '김영국', phone: '+821012345678' }, call: { file_name: 'call.m4a', duration: 180, recorded_at: '2026-09-17T05:20:00Z' }, created_at: '2026-09-17T05:25:00Z', status: 'COMPLETED', progress: null, transcript: { text: '견적서를 보내 주세요.', segments: [{ start: 0, end: 4, text: '견적서를 보내 주세요.' }] }, analysis: { schema_version: 1, summary: '도입 견적을 요청한 통화입니다.', details: [{ title: '견적 문의', content: '도입 비용 견적서를 요청했습니다.' }], todos: [{ content: '견적서 전달', owner: null, due_date: null, source: '견적서를 보내 주세요.' }], decisions: [], consulting: { customer_needs: ['도입 비용 확인'], questions: [], concerns: [], objections: [], important_points: ['견적 요청'], followups: [] } } };
test.beforeEach(async ({ page }) => {
  await page.route('**/auth/login', route => route.fulfill({ json: { accessToken: 'a', refreshToken: 'r', expiresInSec: 3600, mustChangePassword: false } }));
  await page.route('**/sms/campaigns?*', route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route('**/sms/templates?*', route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route('**/users/me', route => route.fulfill({ json: { userId: 'call-test', email: 'call@example.com', userName: '통화 사용자', mustChangePassword: false, createdAt: call.created_at } }));
  await page.route(/\/recipients(?:\?.*)?$/, route => route.request().isNavigationRequest() ? route.fallback() : route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route(/\/calls\?.*$/, route => route.fulfill({ json: { items: [call], nextCursor: null } }));
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
