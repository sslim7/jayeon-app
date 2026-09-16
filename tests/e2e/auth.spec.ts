import { expect, test, type Page } from '@playwright/test';

const tokens = { accessToken: 'test-access', refreshToken: 'test-refresh', expiresInSec: 3600 };
const profile = {
  userId: 'test-user', email: 'invite@example.com', userName: '초대 사용자',
  mustChangePassword: false, createdAt: '2026-09-16T00:00:00Z',
};

async function mockAuth(page: Page, forced = false) {
  // 서버가 없는 초기 단계에서도 UI 계약을 검증한다. 실제 계정/서버에는 요청하지 않는다.
  await page.route('**/auth/login', (route) => route.fulfill({
    json: { ...tokens, mustChangePassword: forced },
  }));
  await page.route('**/users/me', (route) => route.fulfill({
    json: { ...profile, mustChangePassword: forced },
  }));
  await page.route('**/auth/refresh', (route) => route.fulfill({ json: tokens }));
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill(profile.email);
  await page.getByLabel('비밀번호', { exact: true }).fill('Temporary-password1!');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
}

test('일반 로그인은 홈으로 이동하고 로그아웃은 새로고침 후에도 유지된다', async ({ page }) => {
  await mockAuth(page);
  await login(page);
  await expect(page.getByText(profile.email, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('jayeon.tokens'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
});

test('최초 변경은 직접 홈 주소와 새로고침으로 우회할 수 없다', async ({ page }) => {
  await mockAuth(page, true);
  await login(page);
  await expect(page.getByLabel('임시 비밀번호', { exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.getByLabel('임시 비밀번호', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.reload();
  await expect(page.getByLabel('임시 비밀번호', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '취소', exact: true })).toHaveCount(0);
});

test('현재 비밀번호 오류는 세션을 유지하며 변경 성공은 재로그인을 안내한다', async ({ page }) => {
  await mockAuth(page, true);
  let changes = 0;
  let refreshes = 0;
  await page.route('**/auth/refresh', (route) => {
    refreshes += 1;
    return route.fulfill({ json: tokens });
  });
  await page.route('**/auth/change-password', (route) => {
    changes += 1;
    return changes === 1
      ? route.fulfill({
          status: 401,
          json: { code: 'INVALID_CREDENTIALS', message: '현재 비밀번호가 맞지 않아요' },
        })
      : route.fulfill({ status: 204 });
  });
  await login(page);
  await page.getByLabel('임시 비밀번호', { exact: true }).fill('Wrong-password1!');
  await page.getByLabel('새 비밀번호', { exact: true }).fill('New-password1!');
  await page.getByLabel('새 비밀번호 확인', { exact: true }).fill('New-password1!');
  await page.getByRole('button', { name: '비밀번호 바꾸기', exact: true }).click();
  await expect(page.getByText('현재 비밀번호가 맞지 않아요', { exact: true })).toBeVisible();
  expect(refreshes).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('jayeon.tokens'))).not.toBeNull();
  await page.getByLabel('임시 비밀번호', { exact: true }).fill('Temporary-password1!');
  await page.getByRole('button', { name: '비밀번호 바꾸기', exact: true }).click();
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
  await expect(page.getByText(/새 비밀번호로.*로그인/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('jayeon.tokens'))).toBeNull();
});

test('서버 미구현 오류는 자격 오류와 구분하고 다시 제출할 수 있다', async ({ page }) => {
  await mockAuth(page);
  await page.route('**/auth/login', (route) => route.fulfill({ status: 404, body: 'Not Found' }));
  await login(page);
  await expect(page.getByRole('alert')).toContainText('서버에 연결할 수 없어요');
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeEnabled();
  await page.route('**/auth/login', (route) => route.fulfill({
    status: 401, json: { code: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 맞지 않아요' },
  }));
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('이메일 또는 비밀번호가 맞지 않아요');
});

test('필수 인증 플래그가 없는 응답으로 홈에 들어갈 수 없다', async ({ page }) => {
  await mockAuth(page);
  await page.route('**/auth/login', (route) => route.fulfill({ json: tokens }));
  await login(page);
  await expect(page.getByRole('alert')).toContainText('서버 응답');
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('jayeon.tokens'))).toBeNull();
});

test('입력 누락과 확인 불일치는 요청 전에 알린다', async ({ page }) => {
  await mockAuth(page, true);
  await page.goto('/login');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('모두 입력');
  await page.getByRole('button', { name: '비밀번호를 잊으셨나요' }).click();
  await expect(page.getByText(/관리자에게 문의/)).toBeVisible();
  await login(page);
  await page.getByLabel('임시 비밀번호', { exact: true }).fill('Temporary-password1!');
  await page.getByLabel('새 비밀번호', { exact: true }).fill('New-password1!');
  await page.getByLabel('새 비밀번호 확인', { exact: true }).fill('Different-password1!');
  await page.getByRole('button', { name: '비밀번호 바꾸기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('서로 달라요');
});

test('일시적인 부팅 장애는 토큰을 보존하고 연결 복구 후 강제 변경을 복구한다', async ({ page }) => {
  await mockAuth(page, true);
  await login(page);
  await expect(page.getByLabel('임시 비밀번호', { exact: true })).toBeVisible();
  let unavailable = true;
  await page.route('**/users/me', (route) => unavailable
    ? route.abort('failed')
    : route.fulfill({ json: { ...profile, mustChangePassword: true } }));
  await page.reload();
  await expect(page.getByText(/저장된 로그인을 확인하지 못했어요/)).toBeVisible();
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('jayeon.tokens'))).not.toBeNull();
  unavailable = false;
  await page.reload();
  await expect(page.getByLabel('임시 비밀번호', { exact: true })).toBeVisible();
});
