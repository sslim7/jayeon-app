import { expect, test, type Page } from '@playwright/test';

/**
 * 로그인 기기 관리 — **잃어버린 순간에 여는 화면.**
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 여기서 지키는 것은 「보기 좋게 그려졌나」가 아니라 **「이 화면이 거짓말을 하지          │
 * │ 않는가」**다. 이 화면의 고장은 전부 조용하다 — 잘못된 줄이 「이 기기」로 보이거나,       │
 * │ 살아 있는 세션에 한계 시각이 적히거나, 내 기기를 끊고도 로그아웃하지 않거나.            │
 * │ 셋 다 화면은 멀쩡해 보이고, 사용자는 **끊기지 않은 폰을 끊었다고 믿고 닫는다.**         │
 * └──────────────────────────────────────────────────────────────────────────────┘
 */

const tokens = { accessToken: 'test-access', refreshToken: 'test-refresh', expiresInSec: 3600 };
const profile = {
  userId: 'test-user', email: 'invite@example.com', userName: '초대 사용자',
  mustChangePassword: false, createdAt: '2026-09-16T00:00:00Z',
};

type MockSession = {
  sessionId: string;
  deviceLabel: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
  revokedAt: string | null;
  accessibleUntilAtMost: string | null;
  recentAccesses: { at: string; deviceLabel: string }[];
};

const DAY = 86_400_000;
/**
 * 지금을 기준으로 만든 시각.
 *
 * 🔴 **고정 날짜를 박지 않는다.** 화면의 날짜 표기(「오늘」·「어제」)는 **기기 시계와의 거리**로
 * 정해지므로, 박아 둔 날짜는 그 날이 지나는 순간 테스트만 빨갛게 만들고 아무것도 잡지 못한다.
 */
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

type Server = {
  sessions: MockSession[];
  /** 서버가 실제로 받은 끊기 요청. **누르기 전에 불리지 않았는지**를 여기서 본다. */
  deleted: string[];
  /** 목록 조회를 실패시킨다. */
  listFails: boolean;
  /** 끊기를 「그런 기기 없음」으로 거절한다(이미 끊긴 기기를 한 번 더 끊은 경우). */
  revokeMissing: boolean;
};

function freshServer(): Server {
  return {
    sessions: [
      {
        sessionId: 'sid-phone', deviceLabel: '네이처 앱 1.4.0 · 안드로이드',
        userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 NatureApp/1.4.0',
        createdAt: iso(-30 * DAY), lastSeenAt: iso(0), current: true,
        revokedAt: null, accessibleUntilAtMost: null,
        recentAccesses: [{ at: iso(0), deviceLabel: '네이처 앱 1.4.0 · 안드로이드' }, { at: iso(-2 * DAY), deviceLabel: '네이처 앱 1.3.0 · 안드로이드' }],
      },
      {
        sessionId: 'sid-mac', deviceLabel: 'Chrome · macOS',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0.0.0 Safari/537.36',
        createdAt: iso(-10 * DAY), lastSeenAt: iso(-DAY), current: false,
        revokedAt: null, accessibleUntilAtMost: null,
        recentAccesses: [{ at: iso(-DAY), deviceLabel: 'Chrome · macOS' }],
      },
      {
        // 🔴 **이름이 없을 수 있다.** 서버는 모르면 지어내지 않고 이렇게 보낸다.
        sessionId: 'sid-unknown', deviceLabel: '알 수 없는 기기',
        userAgent: '', createdAt: iso(-4 * DAY), lastSeenAt: iso(-3 * DAY), current: false,
        revokedAt: null, accessibleUntilAtMost: null, recentAccesses: [],
      },
    ],
    deleted: [],
    listFails: false,
    revokeMissing: false,
  };
}

async function setup(page: Page, server: Server) {
  await page.route('**/auth/login', (route) => route.fulfill({ json: { ...tokens, mustChangePassword: false } }));
  await page.route('**/users/me', (route) => route.fulfill({ json: profile }));
  await page.route('**/auth/refresh', (route) => route.fulfill({ json: tokens }));
  await page.route(/\/recipients\?.*$/, (route) => route.fulfill({ json: { items: [], nextCursor: null, total: 0 } }));
  await page.route(/\/sms\/campaigns\?.*$/, (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route('**/auth/sessions', (route) => {
    if (server.listFails) return route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', message: '서버 오류가 생겼어요' } });
    return route.fulfill({ json: { sessions: server.sessions } });
  });
  // 더 좁은 경로를 **뒤에** 건다 — Playwright 는 나중에 건 것을 먼저 본다.
  await page.route('**/auth/sessions/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    server.deleted.push(id);
    if (server.revokeMissing) return route.fulfill({ status: 404, json: { code: 'SESSION_NOT_FOUND', message: '기기를 찾을 수 없어요' } });
    const found = server.sessions.find((item) => item.sessionId === id)!;
    const revokedAt = iso(0);
    const accessibleUntilAtMost = iso(15 * 60_000);
    Object.assign(found, { revokedAt, accessibleUntilAtMost });
    return route.fulfill({ json: { sessionId: id, revokedAt, accessibleUntilAtMost, current: found.current } });
  });
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill(profile.email);
  await page.getByLabel('비밀번호', { exact: true }).fill('Temporary-password1!');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/sms\/new$/);
}

/** 줄을 여닫는 자리. 이름이 곧 낭독기가 읽는 전부라 그 모양까지 함께 잡는다. */
const rowToggle = (page: Page, label: string, seen: string, open = false) =>
  page.getByRole('button', { name: `${label} 마지막 접속 ${seen} ${open ? '접기' : '펼치기'}`, exact: true });

test('설정에서 열리고, 기기와 마지막 접속을 날짜로 세우며, 이 기기를 갈라 표시한다', async ({ page }) => {
  const server = freshServer();
  await setup(page, server);
  /*
    설정의 그 줄은 이제 **눌린다.** 예전의 「준비 중」 배지가 남아 있으면 이 화면으로 오는
    길이 없는 것과 같으므로 그 자리에서 잡는다.
  */
  await page.goto('/settings');
  await expect(page.getByText('준비 중', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '로그인 기기 관리', exact: true }).click();
  await expect(page).toHaveURL(/\/devices$/);
  await expect(page.getByRole('heading', { name: '로그인 기기 관리', exact: true })).toBeVisible();

  await expect(page.getByText('네이처 앱 1.4.0 · 안드로이드', { exact: true })).toBeVisible();
  await expect(page.getByText('Chrome · macOS', { exact: true })).toBeVisible();
  // 🔴 서버가 모른다고 한 기기를 앱이 아는 척 채우지 않는다.
  await expect(page.getByText('알 수 없는 기기', { exact: true })).toBeVisible();

  // 🔴 「이 기기」는 한 줄에만 선다 — 둘이면 어느 쪽이 나인지 알 수 없다.
  await expect(page.getByText('이 기기', { exact: true })).toHaveCount(1);
  await expect(rowToggle(page, '네이처 앱 1.4.0 · 안드로이드 이 기기', '오늘')).toBeVisible();
  await expect(rowToggle(page, 'Chrome · macOS', '어제')).toBeVisible();

  /*
    🔴 **날짜까지만 적는다.** 서버가 하루 한 번만 기록해서 시:분은 뒤처져 있다 — 「방금 전」·
    「5분 전」·「오후 2:31」이 뜨는 순간 이 화면은 모르는 것을 아는 척한 것이 된다.
  */
  await expect(page.getByText('마지막 접속 오늘', { exact: true })).toBeVisible();
  await expect(page.getByText('마지막 접속 어제', { exact: true })).toBeVisible();
  await expect(page.getByText(/마지막 접속.*(방금|분 전|시간 전|오전|오후|:)/)).toHaveCount(0);

  /*
    🔴 **살아 있는 세션에는 한계 시각을 적지 않는다.** 서버가 `accessibleUntilAtMost` 를
    `null` 로 주는 자리라, 여기에 시각이 뜬다면 그것은 앱이 지어낸 숫자다.
  */
  await expect(page.getByText(/늦어도/)).toHaveCount(0);
  await expect(page.getByText(/끊었어요/)).toHaveCount(0);
  expect(server.deleted).toEqual([]);

  // 뒤로는 들어온 자리(설정)로 돌아간다.
  await page.screenshot({ path: `/tmp/nature-devices-${test.info().project.name}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test('줄을 누르면 접속 기록과 이름의 근거가 펼쳐지고 한 번에 하나만 열린다', async ({ page }) => {
  const server = freshServer();
  await setup(page, server);
  await page.goto('/devices');
  const mac = rowToggle(page, 'Chrome · macOS', '어제');
  await expect(mac).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('접속 기록', { exact: true })).toHaveCount(0);
  await mac.click();
  await expect(rowToggle(page, 'Chrome · macOS', '어제', true)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('접속 기록', { exact: true })).toBeVisible();
  // 접속 기록도 날짜다(같은 제약이다). 🔴 시각이 붙으면 「15분마다 찍힌 목록」으로 읽힌다.
  await expect(page.getByText('· 어제', { exact: true })).toBeVisible();
  // 🔴 추정이 빗나갔을 때 사람이 직접 볼 원문. 같은 기종 두 대를 가르는 유일한 값이다.
  await expect(page.getByText(/Macintosh; Intel Mac OS X/)).toBeVisible();

  // 다른 줄을 열면 앞의 줄은 닫힌다 — 여러 줄이 펼쳐지면 목록으로 훑는 이유가 사라진다.
  await rowToggle(page, '네이처 앱 1.4.0 · 안드로이드 이 기기', '오늘').click();
  await expect(page.getByText(/Macintosh; Intel Mac OS X/)).toHaveCount(0);
  await expect(page.getByText(/SM-S911N/)).toBeVisible();
  // 그때의 기기 표시가 지금과 다르면 함께 적는다(앱을 새로 깐 흔적이다).
  await expect(page.getByText('· 네이처 앱 1.3.0 · 안드로이드', { exact: false })).toBeVisible();
  // 원문이 없는 기기는 없다고 말한다 — 빈 칸으로 두면 화면이 덜 그려진 것으로 읽힌다.
  await rowToggle(page, '알 수 없는 기기', sinceLabel(3)).click();
  await expect(page.getByText('기기가 보낸 정보가 없어요.', { exact: true })).toBeVisible();
});

/** 사흘 전처럼 「오늘·어제」를 벗어난 날의 표기. 화면과 같은 규칙으로 만든다. */
function sinceLabel(daysAgo: number): string {
  const date = new Date(Date.now() - daysAgo * DAY);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

test('다른 기기는 확인을 받은 뒤에만 끊기고 언제까지 쓸 수 있는지 적는다', async ({ page }) => {
  const server = freshServer();
  await setup(page, server);
  await page.goto('/devices');

  await page.getByRole('button', { name: 'Chrome · macOS 끊기', exact: true }).click();
  /*
    🔴 **누른 것만으로는 아무 일도 일어나지 않는다.** 끊기는 되돌릴 수 없으므로 확인이 한
    단계 있고, 그 확인 문구에는 **언제까지 쓸 수 있는지**가 들어간다 — 잃어버린 사람이
    알고 싶은 것이 그것이다. ⚠️ 「늦어도」가 빠지면 그 시각에 정확히 끊긴다고 읽힌다.
  */
  expect(server.deleted).toEqual([]);
  await expect(page.getByText(/되돌릴 수 없고, 이미 열려 있던 화면은 늦어도 (오전|오후|내일) .*까지 남아 있을 수 있어요/)).toBeVisible();
  // 🔴 브라우저 모달을 쓰지 않는다(WebView 안에서 화면이 멈춘다). 확인은 화면 안의 줄이다.
  await expect(page.getByRole('button', { name: 'Chrome · macOS 끊기 확인', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '취소', exact: true }).click();
  expect(server.deleted).toEqual([]);
  await expect(page.getByRole('button', { name: 'Chrome · macOS 끊기', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Chrome · macOS 끊기', exact: true }).click();
  await page.getByRole('button', { name: 'Chrome · macOS 끊기 확인', exact: true }).click();
  expect(server.deleted).toEqual(['sid-mac']);
  // 끊은 뒤의 시각은 **서버가 준 값**이다. 「끊었다」만 말하면 절반만 한 것이다.
  await expect(page.getByText(/끊었어요\. 이미 열려 있던 화면은 늦어도 .*까지 남아 있을 수 있어요\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chrome · macOS 끊기', exact: true })).toHaveCount(0);

  // 🔴 남의 기기를 끊은 것으로 이 기기가 로그아웃되지는 않는다.
  await expect(page).toHaveURL(/\/devices$/);
  expect(await page.evaluate(() => localStorage.getItem('jayeon.tokens'))).not.toBeNull();
});

test('이 기기를 끊으면 토큰을 버리고 로그인 화면으로 간다', async ({ page }) => {
  const server = freshServer();
  await setup(page, server);
  await page.goto('/devices');
  /*
    🔴 **남의 기기를 끊는 것과 내가 나가는 것은 다른 일이다.** 그래서 이 줄의 버튼은
    「끊기」가 아니라 「로그아웃」이다 — 잃어버린 폰을 끊으려던 사람이 자기 화면을 닫지
    않도록 이름으로도 갈라 둔다.
  */
  await expect(page.getByRole('button', { name: '네이처 앱 1.4.0 · 안드로이드 끊기', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '네이처 앱 1.4.0 · 안드로이드 로그아웃', exact: true }).click();
  await expect(page.getByText('이 기기에서 로그아웃해요. 보던 화면이 닫히고 다시 로그인해야 열려요.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '네이처 앱 1.4.0 · 안드로이드 로그아웃 확인', exact: true }).click();

  /*
    🔴 **여기서 로그아웃하지 않으면 남은 액세스 토큰으로 15분을 더 돈다.** 서버는 액세스
    토큰을 매 요청마다 검사하지 않으므로, 끊어 놓고 화면을 그대로 두면 「끊었다」는 말만
    참이고 실제로는 계속 쓰이는 상태가 된다.
  */
  expect(server.deleted).toEqual(['sid-phone']);
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('jayeon.tokens'))).toBeNull();
});

test('불러오기 실패는 사실대로 말하고 다시 부를 수 있다', async ({ page }) => {
  const server = freshServer();
  server.listFails = true;
  await setup(page, server);
  await page.goto('/devices');
  await expect(page.getByText(/지금 서버에 연결할 수 없어요|기기 목록을 불러오지 못했어요|서버 오류가 생겼어요/)).toBeVisible();
  /*
    🔴 **실패를 「기기 없음」으로 그리지 않는다.** 빈 목록은 「낯선 기기는 없다」로 읽히는데,
    실패했을 때 그렇게 보이면 사용자는 확인하지도 못한 것을 확인했다고 믿고 화면을 닫는다.
  */
  await expect(page.getByText(/낯선 기기는 없어요/)).toHaveCount(0);
  server.listFails = false;
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await expect(page.getByText('Chrome · macOS', { exact: true })).toBeVisible();
});

test('이미 끊긴 기기를 한 번 더 끊으면 다음에 할 일을 말한다', async ({ page }) => {
  const server = freshServer();
  server.revokeMissing = true;
  await setup(page, server);
  await page.goto('/devices');
  await page.getByRole('button', { name: 'Chrome · macOS 끊기', exact: true }).click();
  await page.getByRole('button', { name: 'Chrome · macOS 끊기 확인', exact: true }).click();
  /*
    ⚠️ 서버 문구(「기기를 찾을 수 없어요」)를 그대로 두면 사용자는 **끊기가 실패했다고 믿고
    계속 누른다.** 이 코드가 실제로 오는 경우는 대개 이미 끊긴 뒤다.
  */
  await expect(page.getByText('이미 끊겼거나 목록에서 사라진 기기예요. 목록을 다시 불러와 확인해 주세요.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chrome · macOS 끊기 확인', exact: true })).toBeVisible();
});

test('기기가 한 대뿐이거나 목록이 비면 그 상태를 말로 채운다', async ({ page }) => {
  const server = freshServer();
  server.sessions = [server.sessions[0]];
  await setup(page, server);
  await page.goto('/devices');
  // ⚠️ 한 줄짜리 목록은 「덜 불러온 화면」처럼 보인다. 그 한 줄이 곧 답이라는 것을 말해 준다.
  await expect(page.getByText('지금은 이 기기에서만 로그인되어 있어요. 낯선 기기는 없어요.', { exact: true })).toBeVisible();

  /*
    🔴 **빈 목록을 「기기가 없다」로 그리지 않는다.** 이 화면이 떠 있다는 것 자체가 로그인된
    기기가 하나는 있다는 뜻이다 — 세션 장치가 생기기 전에 로그인해 둔 기기는 서버가 셀 수
    없어서 목록에 없을 뿐이고, 그 사람이 할 수 있는 일(다시 로그인)을 함께 말해야 한다.
  */
  server.sessions = [];
  await page.getByRole('button', { name: '목록 새로 고치기', exact: true }).click();
  await expect(page.getByText(/아직 목록에 올라온 기기가 없어요/)).toBeVisible();
  await expect(page.getByText(/다시 로그인하면 그때부터 이 목록에 남아요/)).toBeVisible();
});

test('내 기기가 목록에 없으면 그 사실을 말한다', async ({ page }) => {
  const server = freshServer();
  // 세션 장치 이전에 발급된 액세스 토큰에는 세션 id 가 없어 서버가 어느 줄도 「이 기기」로 가리지 못한다.
  server.sessions = server.sessions.map((item) => ({ ...item, current: false }));
  await setup(page, server);
  await page.goto('/devices');
  await expect(page.getByText('이 기기', { exact: true })).toHaveCount(0);
  /*
    🔴 이 안내가 없으면 사용자는 **자기 기기를 낯선 기기로 알고 끊는다.** 「이 기기」 표시가
    어디에도 없는 화면은 「내 기기는 목록에 없다」가 아니라 「내 기기를 못 찾겠다」로 읽힌다.
  */
  await expect(page.getByText(/지금 보고 있는 이 기기는 아직 목록에 없어요/)).toBeVisible();
  // 이름이 갈리지 않으므로 모든 줄이 「끊기」다 — 「로그아웃」이 서면 그건 거짓이다.
  await expect(page.getByRole('button', { name: /로그아웃/ })).toHaveCount(0);
});
