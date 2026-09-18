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
    /*
      🔴 **브라우저 주소창으로 연 `/calls/<id>` 는 앱 화면 요청이지 API 요청이 아니다.**
      이 갈래가 없으면 보고서를 주소로 직접 열 때(북마크·새로고침·테스트의 `page.goto`)
      HTML 대신 JSON 이 그려져 **빈 화면**이 나온다. 목록 갈래도 같은 이유로 먼저 거른다.
    */
    if (route.request().isNavigationRequest()) return route.fallback();
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
    // 🔴 서버가 돌려주는 것은 **목록용 요약**이다(§`internal/calls/audio.go` 의 `summaryRecord`).
    // 원문·분석이 실려 오지 않으므로, 앱이 이 답으로 화면을 통째로 갈아 끼우면 열어 둔
    // 원문 탭이 빈 화면이 된다. 그 실수를 테스트가 잡을 수 있게 같은 모양으로 돌려준다.
    await route.fulfill({ json: listed(again) });
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

/**
 * 🔴 **보고서는 한 장이다.**
 *
 * 예전에는 요약·상세·할 일·상담 분석이 탭 넷으로 갈라져 있어서, 전부 읽으려면 버튼을 네 번
 * 눌러야 했다. 그 네 번을 다 누르는 사람은 없다 — 읽히지 않는 분석은 만들지 않은 것과 같다.
 * 이제는 **아래로 내리는 것만으로** 전부 읽힌다. 이 테스트가 지키는 것이 그 「한 장」이다.
 *
 * 함께 고정하는 것 셋:
 * - 시트가 아니라 **화면**이다(주소가 바뀌고 제목이 「이름 + 상담 분석」이다).
 * - 비어 있는 갈래는 **제목을 남기지 않고**, 비었다는 사실만 한 줄로 말한다.
 * - 만 자짜리 **원문은 이 문서에 섞이지 않는다**(기본 접힘).
 */
test('분석 보기는 보고서 화면으로 넘어가 요약·상세·할 일·상담 분석을 한 화면에서 보여 준다', async ({ page }) => {
  await installCalls(page, server());
  await login(page);
  await expect(page.getByText('김영국', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '이름,전화번호 뒷자리 4자', exact: true }).fill('없는 이름');
  await expect(page.getByText('검색어에 해당하는 통화가 없습니다.')).toBeVisible();
  await page.getByRole('textbox', { name: '이름,전화번호 뒷자리 4자', exact: true }).fill('김영');
  // 분석을 여는 길은 줄을 펼친 뒤다 — 목록은 한 줄만 세운다.
  await briefRow(page, '김영국').click();
  await page.getByRole('button', { name: '김영국 분석 보기' }).click();
  await expect(page).toHaveURL(/\/calls\/call-1$/);
  /*
    🔴 **제목과 나가는 길은 앱 상단 바에 있다.** 이 화면은 메뉴가 세운 화면이 아니라 목록 위에
    쌓인 문서라, ☰ 가 아니라 「뒤로」가 서야 한다 — ☰ 를 누르면 메뉴가 열려 밑에 깔린 목록으로
    **이동**해 버리고, 그때 사용자는 쌓아 둔 스크롤과 펼친 줄을 잃는다.
  */
  await expect(page.getByRole('heading', { name: '김영국 상담 분석' })).toBeVisible();
  await expect(page.getByRole('button', { name: '뒤로', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '메뉴 열기' })).toHaveCount(0);
  // 🔴 누를 탭이 하나도 없다. 하나라도 남아 있으면 그만큼 읽히지 않는 구획이 생긴 것이다.
  await expect(page.getByRole('tab')).toHaveCount(0);
  /*
    🔴 **머리말에 남는 것은 「누구와 언제 얼마나」 한 줄뿐이다.**

    분석 모델 이름·이 통화에 든 비용·「서버 AI로 다시 분석」이 여기 함께 서 있었는데, 셋 다
    보고서를 읽으러 온 사람의 질문이 아니라 **우리(운영)의 질문**이라 걷었다. 기능은 지우지
    않았고(→ `components/call-reanalyze.tsx`·`lib/call-cost.ts`) 이 화면에서 그리지 않을 뿐이다.
  */
  // 🔧 머리말(전화번호·통화일시·통화시간)을 두지 않는다(사용자 결정). 본문은 바로 「요약」이다 —
  // 누구와 언제 한 통화인지는 목록에서 고르고 들어온 사람이 알고, 상단 바가 이름을 한 번 더 말한다.
  await expect(page.getByText(/^010-1234-5678 · /)).toHaveCount(0);
  await expect(page.getByText(/^분석: /)).toHaveCount(0);
  await expect(page.getByText(/^비용: /)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /서버 AI로 다시 분석$/ })).toHaveCount(0);
  // 🔴 다섯 구획이 **동시에** 보인다. 하나를 보려고 다른 하나를 덮지 않는다.
  for (const title of ['요약', '상세 내용', '할 일', '고객이 원한 것', '중요 발언']) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  /*
    🔴 **「할 일」이 마지막 구획이다.**

    앞의 구획들은 끝난 통화의 기록이고 할 일만 앞으로 할 일이라, 기록 한가운데에 끼워 두면
    읽던 사람이 거기서 손을 떼고 움직였다가 나머지를 못 읽는다. 순서는 눈으로만 확인되는
    성질이라 **여기서 고정하지 않으면 다음 수정에서 조용히 뒤바뀐다.**
    (통화 원문은 보고서 밖이다 — 문서를 덮은 뒤에 오는 부록이라 이 세기에서 뺀다.)
  */
  const order = await page.getByRole('heading').allInnerTexts();
  expect(order.filter((title) => title !== '통화 원문').at(-1)).toBe('할 일');
  await expect(page.getByText('도입 견적을 요청한 통화입니다.').last()).toBeVisible();
  await expect(page.getByText('도입 비용 견적서를 요청했습니다.')).toBeVisible();
  /*
    🔴 **할 일 앞에 `☐` 를 달지 않는다.** 체크박스처럼 보이는데 누를 수가 없어서, 눌러 본
    사람에게는 고장난 화면이 된다("이 ㅁ은 뭐지"를 실제로 들었다).
  */
  await expect(page.getByText('견적서 전달', { exact: true })).toBeVisible();
  await expect(page.getByText(/☐/)).toHaveCount(0);
  await expect(page.getByText('• 도입 비용 확인')).toBeVisible();
  await expect(page.getByText('• 견적 요청')).toBeVisible();
  // 결정사항 0건 · consulting 의 우려/반대 0건. 빈 제목을 세우지 않고 한 줄로 말한다.
  await expect(page.getByRole('heading', { name: '결정사항' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '걸림돌' })).toHaveCount(0);
  await expect(page.getByText('이 통화에서 확인되지 않은 항목: 결정사항 · 걸림돌')).toBeVisible();
  /*
    🔴 **통화 원문은 이 문서에 없다.** 264조각·만 자짜리 원문은 접어 두더라도 보고서의 끝이
    어디인지 흐리고, 무엇보다 **원문만 보러 온 사람이 보고서를 지나쳐 내려와야** 했다.
    지금은 형제 화면이다(→ 아래 「목록의 통화 원문 버튼…」 테스트).
  */
  await expect(page.getByRole('heading', { name: '통화 원문', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '통화 원문 펼치기' })).toHaveCount(0);
  await expect(page.getByText('견적서를 보내 주세요.', { exact: true })).toHaveCount(0);
});

/**
 * 🔴 **원문은 보고서와 형제다.** 목록에서 곧장 갈 수 있고, 들어가면 **바로** 대화가 보인다.
 *
 * 여닫기도 글자 수 표시도 없다 — 그것들은 「펼까 말까」를 묻던 장치인데 이 화면에 들어온
 * 것이 이미 그 답이다. 화면 머리는 보고서와 같은 모양(「‹ 뒤로」 + 문서 이름)이다.
 */
test('목록의 통화 원문 버튼이 원문 화면으로 보낸다', async ({ page }) => {
  await installCalls(page, server());
  await login(page);
  await briefRow(page, '김영국').click();
  await page.getByRole('button', { name: '김영국 통화 원문' }).click();
  await expect(page).toHaveURL(/\/calls\/call-1\/transcript$/);
  await expect(page.getByRole('heading', { name: '김영국 통화 원문' })).toBeVisible();
  await expect(page.getByRole('button', { name: '뒤로', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '메뉴 열기' })).toHaveCount(0);
  // 펼칠 것이 없다. 들어온 것이 곧 「펼친다」는 답이다.
  await expect(page.getByRole('button', { name: '통화 원문 펼치기' })).toHaveCount(0);
  await expect(page.getByText('12자', { exact: true })).toHaveCount(0);
  /*
    ⚠️ 이 통화의 원문에는 **화자가 없다**(폰·맥북 whisper 로 만든 원문이 그렇다). 그때는
    좌우로 가르지 않고 시각과 내용만 흐르게 두며, 가정을 설명하는 줄도 세우지 않는다 —
    없는 정보를 있는 것처럼 그리지 않는다.
  */
  await expect(page.getByText('견적서를 보내 주세요.', { exact: true })).toBeVisible();
  await expect(page.getByText('00:00', { exact: true })).toBeVisible();
  await expect(page.getByText(/화자/)).toHaveCount(0);
  // 돌아가는 길은 보고서와 같다 — 목록은 이 화면 아래에 살아 있다.
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  await expect(page).toHaveURL(/\/calls$/);
  await expect(briefRow(page, '김영국')).toHaveAccessibleName(/ 접기$/);
});

/**
 * 🔴 **통화 원문은 목록이 아니라 대화다.**
 *
 * 한쪽에 몰아 세운 264줄은 「누가 무엇을 말했는가」를 보여 주지 못한다 — 상담 원문을 읽는
 * 이유가 바로 그 한 가지인데도. 좌우로 가르면 말이 오간 모양이 형태로 남는다.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **그런데 어느 번호가 상담사인지는 우리가 모른다.**                              │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * ASR 은 화자를 `"0"`/`"1"` 로만 준다. 우리가 가진 통화에서는 상담사가 `"0"` 이었지만 보장이
 * 없고, 짧은 대답이 반대쪽 화자로 새는 오류도 실제로 있다. 그래서 오른쪽에 `"0"` 을 두되
 * **이름표는 번호 그대로** 달고, 그것이 가정이라는 사실을 화면이 스스로 말한다.
 * 「상담사」「고객」이라고 박으면 **틀렸을 때 거짓이 확신에 차 보인다** — 보고서를 읽은 사람이
 * 하지도 않은 말을 상담사가 했다고 믿게 된다. 이 테스트가 막는 것이 그것이다.
 */
test('화자가 있는 원문은 좌우로 갈린 말풍선이 되고, 화자를 이름으로 단정하지 않는다', async ({ page }) => {
  const talk: CallRecord = {
    ...done, call_id: 'call-talk', contact: { name: '권자현', phone: '+821012349999' },
    transcript: {
      text: '여보세요? 아, 네, 안녕하세요. 네, 더메이의 권자현 팀장입니다.',
      segments: [
        { start: 0, end: 2, text: '여보세요?', speaker: '0' },
        { start: 3, end: 5, text: '아, 네, 안녕하세요.', speaker: '1' },
        { start: 134, end: 138, text: '네, 더메이의 권자현 팀장입니다.', speaker: '0' },
      ],
    },
  };
  await installCalls(page, server([talk]));
  await login(page);
  await briefRow(page, '권자현').click();
  await page.getByRole('button', { name: '권자현 통화 원문' }).click();
  await expect(page.getByRole('heading', { name: '권자현 통화 원문' })).toBeVisible();
  /*
    🔴 **말풍선 안에는 말한 내용만 들어간다.** 시각을 같은 덩어리에 넣으면 눈이 264번
    「00:02 · 」을 먼저 밟고 지나가야 해서, 좌우로 갈라 놓고도 원문이 읽히지 않는다.
    시각은 말풍선 **바깥**의 형제 글자다 — 그래서 `exact` 로 잡힌다.
  */
  await expect(page.getByText('00:00', { exact: true })).toBeVisible();
  await expect(page.getByText('00:03', { exact: true })).toBeVisible();
  await expect(page.getByText('02:14', { exact: true })).toBeVisible();
  await expect(page.getByText('여보세요?', { exact: true })).toBeVisible();
  /*
    🔧 **화자 이름표와 안내 문장을 두지 않는다**(사용자 결정). 왼쪽·오른쪽이라는 자리만으로
    두 사람이 번갈아 말한다는 것이 읽히고, 「화자 0」 같은 번호는 읽는 사람에게 아무것도
    알려 주지 않는다. 좌우가 실제로 갈렸는지는 아래에서 **자리로** 잰다.
  */
  await expect(page.getByText(/^화자 /)).toHaveCount(0);
  // 🔴 이름표는 번호뿐이다. 말풍선 머리에 사람 이름이 붙는 순간 화면이 거짓말을 한다.
  await expect(page.getByText('상담사', { exact: true })).toHaveCount(0);
  await expect(page.getByText('고객', { exact: true })).toHaveCount(0);
  /*
    🔴 **실제로 좌우로 갈렸는지는 자리로 잰다.** 말풍선 색과 모서리만 바뀌고 둘 다 왼쪽에
    서 있어도 위의 글자 검사는 전부 통과한다 — 그러면 대화가 다시 한 줄짜리 목록이 된다.
  */
  const right = (await page.getByText('여보세요?', { exact: true }).boundingBox())!;
  const left = (await page.getByText('아, 네, 안녕하세요.', { exact: true }).boundingBox())!;
  expect(right.x).toBeGreaterThan(left.x + 50);
  /*
    🔴 **말풍선이 가로로 선다.** 가로 묶음 안에서 `flex` 를 잘못 주면 말풍선이 한 글자 폭으로
    찌그러진 채 글자가 세로로 쏟아지는데(react-native-web 이 `flex-basis: 0` 을 남긴다),
    위의 글자·자리 검사는 그래도 전부 통과한다. 폭을 직접 재야 잡힌다.
  */
  expect(right.width).toBeGreaterThan(40);
  expect(left.width).toBeGreaterThan(40);
  /*
    🔴 **시각은 말풍선의 안쪽(화면 가운데) 방향에 붙는다.** 바깥쪽에 붙이면 화면 가장자리에
    숫자가 줄줄이 서서, 좌우로 가른 것보다 시각이 먼저 눈에 들어온다.
  */
  const rightTime = (await page.getByText('00:00', { exact: true }).boundingBox())!;
  const leftTime = (await page.getByText('00:03', { exact: true }).boundingBox())!;
  expect(rightTime.x).toBeLessThan(right.x);
  expect(leftTime.x).toBeGreaterThan(left.x);
});

/**
 * 🔴 **돌아왔을 때 보던 자리가 남아 있어야 한다.**
 *
 * 목록은 무한 스크롤로 쌓은 페이지와 검색어, 펼쳐 둔 줄을 **컴포넌트 상태로** 들고 있다.
 * 보고서를 시트가 아니라 화면으로 만들면서 이 상태가 통째로 날아갈 수 있는 길이 둘 생겼다:
 * ①목록을 `replace` 로 갈아 끼우거나 ②돌아올 때 목록을 처음부터 다시 받거나. 둘 중 하나라도
 * 하면 30건쯤 내려간 뒤 보고서를 열었다 닫은 사용자가 **맨 위로 튕긴다.**
 *
 * 그래서 여기서 세는 것이 목록 요청 횟수다 — 돌아오는 길에 목록을 다시 받으면 실패한다.
 */
test('보고서에서 목록으로 돌아오면 쌓아 둔 목록과 펼쳐 둔 줄이 그대로 남는다', async ({ page }) => {
  const made = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => listed({ ...done, call_id: `${prefix}-${i}`, contact: { name: `${prefix}통화${i}`, phone: '+821012345678' }, call: { ...done.call, recorded_at: new Date(Date.parse('2026-09-17T05:20:00Z') - (prefix === 'a' ? 0 : 3_600_000) - i * 60_000).toISOString() } }));
  let lists = 0;
  await page.route(/\/calls(?:\?.*)?$/, route => {
    if (route.request().isNavigationRequest()) return route.fallback();
    lists += 1;
    const params = new URL(route.request().url()).searchParams;
    if (!params.get('cursor')) return route.fulfill({ json: { items: made('a', 50), nextCursor: 'p1' } });
    return route.fulfill({ json: { items: made('b', 10), nextCursor: null } });
  });
  // 🔴 상세 응답은 **목록이 아는 그 통화와 같은 통화**여야 한다. 통화일시가 다르면 목록이
  // 다시 정렬되면서 줄이 통째로 움직이는데, 그것은 여기서 재려는 것(보던 자리)과 다른 문제다.
  await page.route(/\/calls\/[^/?]+$/, route => route.fulfill({ json: { ...made('b', 10)[9], ...done, call_id: 'b-9', contact: { name: 'b통화9', phone: '+821012345678' }, call: made('b', 10)[9].call } }));
  await login(page);
  // 아래까지 내려 두 묶음을 쌓는다. 이 60건이 곧 「보던 자리」다.
  await expect(page.getByText('50건', { exact: true })).toBeVisible();
  await page.getByText('a통화49', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText('60건', { exact: true })).toBeVisible();
  expect(lists).toBe(2);
  await briefRow(page, 'b통화9').click();
  /*
    **스크롤 위치.** 목록은 `SmsPage` 안쪽 `ScrollView`(= 스크롤되는 div)가 들고 있다.
    상태가 남아 있어도 이 값이 0 으로 돌아가면 사용자 눈에는 「맨 위로 튕겼다」로 똑같이 보인다.
  */
  const scrolled = await page.evaluate(() => [...document.querySelectorAll('div')].find((el) => el.scrollTop > 0)?.scrollTop ?? 0);
  expect(scrolled).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'b통화9 분석 보기' }).click();
  await expect(page.getByRole('heading', { name: 'b통화9 상담 분석' })).toBeVisible();
  // 상단 바의 뒤로 가기. 하드웨어 뒤로가기와 브라우저 뒤로가기도 같은 길을 쓴다(아래).
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  await expect(page.getByText('60건', { exact: true })).toBeVisible();
  // 🔴 목록을 다시 받지 않았다. 받았다면 60건이 50건으로 잘리고 사용자는 자리를 잃는다.
  expect(lists).toBe(2);
  // 펼쳐 둔 줄도 펼친 채다 — 상태가 살아 있다는 가장 눈에 보이는 증거다.
  await expect(briefRow(page, 'b통화9')).toHaveAccessibleName(/ 접기$/);
  // 🔴 내려와 있던 자리도 그대로다.
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('div')].find((el) => el.scrollHeight > el.clientHeight + 5)?.scrollTop ?? 0)).toBeGreaterThan(scrolled - 200);
  // 브라우저 뒤로가기(=안드로이드 하드웨어 뒤로가기가 웹뷰에서 하는 일)도 목록으로 돌아온다.
  await page.getByRole('button', { name: 'b통화9 분석 보기' }).click();
  await expect(page.getByRole('heading', { name: 'b통화9 상담 분석' })).toBeVisible();
  await page.goBack();
  await expect(page.getByText('60건', { exact: true })).toBeVisible();
  expect(lists).toBe(2);
});

/**
 * 🔧 **비용은 이제 이 화면에 없다.**
 *
 * 「비용: 받아쓰기 96원 · 분석 14원」은 보고서를 읽으러 온 사람의 질문이 아니라 **우리(운영)의
 * 질문**이라, 사용자가 걷어 달라고 했고 어드민 화면이 생기면 그리로 간다. 그래서 여기서 재던
 * 것 — 받아쓰기와 분석을 나눠 적기, 1원 미만을 0원으로 뭉개지 않기, 모르는 값에 0원을 적지
 * 않기 — 는 **표기 함수를 직접 부르는 검사로 옮겼다**(→ `tests/call-cost.test.cjs`).
 * 🔴 계산·표기 코드(`lib/call-cost.ts`)와 서버 응답의 `cost` 는 그대로 살아 있다. 지우면
 * 어드민을 만들 때 「0원과 모름은 다르다」를 처음부터 다시 발견해야 한다.
 *
 * 화면 쪽에서 남는 규칙은 하나뿐이고, 그것은 위 「한 장 보고서」 테스트가 지킨다:
 * **머리말에 `분석: `도 `비용: `도 서지 않는다.**
 */

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
  /*
    🔴 **첫 줄 위에도 선이 있다.** 줄 사이에만 선이 있으면 목록이 어디서 시작하는지가
    화면에 없어서, 위의 「N건」과 첫 줄이 한 덩어리로 붙어 보인다.
    🔴 **위아래 여백은 대칭이다.** 줄이 페이지 바탕의 직계 자식이면 바탕의 `gap` 16 이
    구분선과 글자 사이에만 얹혀 「줄이 선에서 아래로 밀려 보인다」가 된다.
    ⚠️ 높이 48 은 **손가락이 닿을 자리**다. 여백을 줄이다 이 값을 깨면 옆 줄을 잘못 눌러
    엉뚱한 통화가 펼쳐진다.
  */
  const shape = await row.evaluate((el) => {
    const line = getComputedStyle(el.parentElement!);
    const head = getComputedStyle(el);
    return { top: line.borderTopWidth, bottom: line.borderBottomWidth, padTop: head.paddingTop, padBottom: head.paddingBottom, height: el.getBoundingClientRect().height };
  });
  expect(shape.top).toBe('1px');
  expect(shape.bottom).toBe('1px');
  expect(shape.padTop).toBe(shape.padBottom);
  expect(shape.height).toBeGreaterThanOrEqual(48);
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

/**
 * 🔴 **줄 전체가 눌려 여닫힌다는 사실이 화면에 드러나야 한다.**
 *
 * 표시가 없으면 펼친 사용자가 **어디를 눌러야 닫히는지 모른다** — 실제로 그 물음을 받았다.
 * 오른쪽 끝의 홑화살표가 그 답이고, 접힘/펼침에 따라 방향이 뒤집힌다.
 *
 * ⚠️ 화살표는 **표시이지 버튼이 아니다.** 누르는 자리는 줄 전체 그대로이고(위 테스트가
 * 지킨다), 낭독기에서는 숨긴다 — 여닫힘은 `aria-expanded` 와 접근성 이름의 「펼치기/접기」가
 * 이미 말한다. 그래서 여기서는 **그려진 선 자체**를 본다.
 * ⚠️ 아래 두 문자열은 `app/calls/index.tsx` 의 `Chevron` 이 그리는 path 와 한 글자도 달라선
 * 안 된다. 접근성 이름으로 재면 아이콘을 거꾸로 달아도 통과하므로 일부러 기하를 잰다.
 */
test('간단뷰의 줄 끝 화살표가 펼침에 따라 방향을 뒤집는다', async ({ page }) => {
  const other: CallRecord = { ...done, call_id: 'call-b', contact: { name: '이둘째', phone: '+821022223333' }, call: { ...done.call, recorded_at: '2026-09-17T01:00:00Z' } };
  await installCalls(page, server([done, other]));
  await login(page);
  const down = page.locator('svg path[d="M6 9l6 6 6-6"]');
  const up = page.locator('svg path[d="M6 15l6-6 6 6"]');
  await expect(down).toHaveCount(2);
  await expect(up).toHaveCount(0);
  await briefRow(page, '김영국').click();
  await expect(up).toHaveCount(1);
  await expect(down).toHaveCount(1);
  // 접으면 되돌아온다. 한쪽으로만 바뀌면 펼친 뒤의 화면이 영영 거짓말을 한다.
  await briefRow(page, '김영국').click();
  await expect(up).toHaveCount(0);
  await expect(down).toHaveCount(2);
  /*
    ⚠️ **전체정보뷰에는 이 화살표가 붙지 않는다.** 그 화면은 모든 줄이 펴진 표라 여닫을
    것이 없다 — 여닫히지 않는 줄에 여닫기 표시가 붙으면 그것이 곧 고장이다.
  */
  await page.getByRole('button', { name: '전체정보뷰' }).click();
  await expect(down).toHaveCount(0);
  await expect(up).toHaveCount(0);
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
  /*
    분석이 실패해도 **받아쓰기는 끝난 통화**라 원문은 남아 있다. 그 원문으로 가는 길은
    보고서를 거치지 않는다 — 읽을 분석이 없는 통화에서 보고서를 한 번 지나게 하는 것은
    빈 방을 한 칸 더 지나게 하는 것과 같다.
  */
  await page.getByRole('button', { name: '최실패 통화 원문' }).click();
  await expect(page.getByRole('heading', { name: '최실패 통화 원문' })).toBeVisible();
  await expect(page.getByText('다음 주에 다시 연락드리겠습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  /*
    보고서 쪽은 **왜 비었는지**를 말하고, 거기서도 원문으로 갈 길을 준다 — 원문이 형제 화면으로
    나가면서 이 자리가 막다른 길이 되지 않게 하는 것이 그 버튼이다.

    ⚠️ **주소로 직접 연다.** 실패한 통화의 목록 줄에는 보고서로 가는 버튼이 없다(읽을 분석이
    없는 통화에서 빈 방을 한 칸 지나게 하지 않는다). 그래도 이 화면에 닿는 길은 있다 —
    북마크·새로고침, 그리고 **보고서를 열어 둔 채 분석이 실패하는 경우**다.
  */
  await page.goto('/calls/call-3');
  await expect(page.getByText(/코드: DataInspectionFailed\) 목록에서 다시 시도하면/)).toBeVisible();
  // 분석이 없으니 세울 구획도 없다. 빈 제목을 늘어놓고 헛걸음시키지 않는다.
  await expect(page.getByRole('heading', { name: '요약', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '최실패 통화 원문 보기' }).click();
  await expect(page.getByRole('heading', { name: '최실패 통화 원문' })).toBeVisible();
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  // 🔴 돌아갈 기록이 없으면(주소로 바로 열기) 목록을 새로 연다. 빈 화면에 갇히지 않는다.
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  await expect(page).toHaveURL(/\/calls$/);
  await briefRow(page, '최실패').click();
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
  await expect(page.getByRole('button', { name: '박예산 통화 원문' })).toBeVisible();
  // 보고서 화면도 있지도 않은 버튼을 찾아가라고 말하지 않는다(⚠️ 주소로 연다 — 위 참조).
  await page.goto('/calls/call-budget');
  await expect(page.getByText(/\(코드: BUDGET_TOO_SMALL\)/)).toBeVisible();
  await expect(page.getByText(/목록에서 다시 시도하면/)).toHaveCount(0);
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  await expect(page).toHaveURL(/\/calls$/);

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
  /*
    🔴 **원문이 없는 통화에는 「통화 원문」도 세우지 않는다.** 받아쓰기가 실패했다는 것은
    저장된 원문이 없다는 뜻이다 — 눌러서 「저장된 통화 원문이 없습니다」만 보는 화면으로
    보내면 버튼이 약속을 어긴 것이 된다.
  */
  await expect(page.getByRole('button', { name: '한전사 통화 원문' })).toHaveCount(0);
});

/**
 * 🔧 **「서버 AI로 다시 분석」은 이 화면에서 빠졌다.**
 *
 * 되돌릴 수 없이 기존 분석을 덮어쓰고 요금을 새로 쓰는 조작이라, 보고서를 읽는 자리에 둘
 * 것이 아니라는 판단이었다(사용자 요구). 흐름은 지우지 않고 `components/call-reanalyze.tsx`
 * 로 옮겨 두었고 — 확인 한 단계, 보낸 뒤 버튼 치우기, 받은 답을 지금 값 **위에 얹기**가
 * 전부 거기 있다 — 어드민 화면이 생기면 그대로 붙인다.
 * ⚠️ 그래서 **지금은 그 컴포넌트를 부르는 화면이 없어 브라우저로 밟을 길이 없다.**
 *
 * 여기 남기는 것은 그 화면이 사라져도 계속 지켜져야 하는 둘이다:
 * ① 보고서는 운영의 값(모델·비용)과 되돌릴 수 없는 조작을 보이지 않는다.
 * ② 그래도 **열어 둔 보고서는 진행을 따라가고, 돌아간 목록도 그 사실을 안다.**
 */
test('보고서는 모델·비용·재분석을 보이지 않지만 진행과 결과는 따라간다', async ({ page }) => {
  const running: CallRecord = {
    call_id: 'call-phone', contact: { name: '강연정', phone: '+821012345678' },
    call: { file_name: 'old.m4a', duration: 1706, recorded_at: '2026-09-01T05:00:00Z' }, created_at: '2026-09-01T05:30:00Z',
    status: 'ANALYZING', progress: 0.8, job_state: 'ANALYZING', stage: '내용 정리하는 중',
    summary: '폰에서 만든 요약입니다.',
    // 폰 기록에는 공급자가 없다. 서버 원가도 없다 — 서버가 쓴 돈이 없기 때문이다.
    ai: { model: 'Qwen3-0.6B-Q8_0', model_version: '1', processed_on_device: true },
    transcript: { text: '견적서를 보내 주세요.', segments: [] },
    analysis: { schema_version: 1, summary: '폰에서 만든 요약입니다.', details: [], todos: [], decisions: [], consulting: { customer_needs: [], questions: [], concerns: [], objections: [], important_points: [], followups: [] } },
  };
  const state = server([running]);
  await installCalls(page, state);
  await login(page);
  await briefRow(page, '강연정').click();
  await page.getByRole('button', { name: '강연정 통화 요약 보기' }).click();
  await expect(page.getByRole('heading', { name: '강연정 상담 분석' })).toBeVisible();
  // ① 머리말에 남는 것은 누구와 언제 얼마나 한 통화인가 한 줄뿐이다.
  // 🔧 머리말을 두지 않는다(사용자 결정). 위 테스트와 같은 이유로 없음을 확인한다.
  await expect(page.getByText(/^010-1234-5678 · /)).toHaveCount(0);
  await expect(page.getByText(/^분석: /)).toHaveCount(0);
  await expect(page.getByText(/^비용: /)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /서버 AI로 다시 분석$/ })).toHaveCount(0);
  // 진행 중인 통화의 단계 카드는 **그대로 남는다** — 걷은 것은 운영의 값이지 진행 상황이 아니다.
  await expect(page.getByText('내용 정리하는 중', { exact: true }).last()).toBeVisible();

  /*
    ② 🔴 **열어 둔 보고서가 진행을 따라간다.** 이 연결이 끊기면 분석이 끝나도 화면은 「내용
    정리하는 중」에 멈춰 있고, 사용자는 서버가 죽은 줄 알고 같은 분석을 한 번 더 시킨다.
  */
  state.rows.set('call-phone', {
    ...running, status: 'COMPLETED', progress: 1, job_state: 'COMPLETED', stage: '분석 완료',
    ai: { model: 'qwen3.7-plus', model_version: '2026-09-01', provider: 'alibaba' },
    summary: '서버가 다시 만든 요약입니다.',
    analysis: { ...running.analysis!, summary: '서버가 다시 만든 요약입니다.' },
    cost: { currency: 'KRW', transcription: 0, analysis: 16.2, total: 16.2, usage: { audio_seconds: 0, input_tokens: 17800, output_tokens: 2200, reasoning_tokens: 0 } },
  });
  await expect(page.getByText('서버가 다시 만든 요약입니다.').last()).toBeVisible({ timeout: 15_000 });
  // 🔴 끝난 뒤에도 모델·비용은 서지 않는다. 서버가 보낸다고 그리는 것이 아니다.
  await expect(page.getByText(/^분석: /)).toHaveCount(0);
  await expect(page.getByText(/^비용: /)).toHaveCount(0);

  /*
    🔴 **돌아간 목록도 이 사실을 알아야 한다.**

    보고서가 떠 있는 동안 목록은 폴링을 멈춘다(같은 통화를 두 곳에서 5초마다 묻지 않으려고).
    그 사이에 끝난 통화를 **돌아오는 길에 한 번 다시 묻지 않으면**, 목록은 방금 끝난 분석을
    「분석 중」으로 계속 보여 준다(→ `app/calls/index.tsx` 의 `visited`).
    ⚠️ 짧은 제한 시간이 곧 이 검사다 — 5초 폴링이 대신 고쳐 주기 전에 맞아야 한다.
  */
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  await expect(briefRow(page, '강연정')).toHaveAccessibleName(/ 강연정 분석 완료 접기$/, { timeout: 3_000 });
});

/**
 * 🔴 **같은 통화를 두 곳에서 묻지 않는다.**
 *
 * 진행 중인 통화는 5초마다 상세를 다시 물어야 한다. 그런데 보고서가 시트에서 **화면**이 되면서
 * 목록은 그 아래에 **살아 있게** 됐다 — 아무것도 하지 않으면 목록과 보고서가 같은 통화를
 * 각자 5초마다 묻는다. 상세 조회는 서명 URL 발급과 작업 문서 읽기를 함께 하는 비싼 호출이라
 * 그 두 배가 그대로 서버 부하가 되고, 화면에는 아무 흔적도 남지 않는다.
 *
 * 그래서 목록의 폴링은 **포커스를 따른다**(→ `app/calls/index.tsx` 의 `useFocusEffect`).
 */
test('보고서를 열어 두는 동안 같은 통화를 두 번씩 묻지 않는다', async ({ page }) => {
  const running: CallRecord = {
    call_id: 'call-run', contact: { name: '정진행', phone: '+821088887777' },
    call: { file_name: 'live.m4a', duration: 300, recorded_at: '2026-09-17T06:00:00Z' }, created_at: '2026-09-17T06:01:00Z',
    status: 'ANALYZING', progress: 0.8, job_state: 'ANALYZING', stage: '내용 정리하는 중', has_audio: true,
    summary: '앞선 분석이 남긴 요약입니다.',
  };
  const state = server([running]);
  await installCalls(page, state);
  await login(page);
  await briefRow(page, '정진행').click();
  await page.getByRole('button', { name: '정진행 통화 요약 보기' }).click();
  await expect(page.getByRole('heading', { name: '정진행 상담 분석' })).toBeVisible();
  // 여기서부터 센다. 이 통화를 묻는 쪽은 보고서 하나뿐이어야 한다.
  state.seen.length = 0;
  await page.waitForTimeout(11_000);
  const polls = state.seen.filter((entry) => entry === 'get:call-run').length;
  // 5초 간격이면 11초에 두 번이다. 목록이 같이 돌면 네 번이 된다 — 그 차이를 잡는 상한이다.
  expect(polls).toBeGreaterThanOrEqual(1);
  expect(polls).toBeLessThanOrEqual(3);
});

/**
 * 🔴 **원문이 없다는 사실은 원문 화면이 직접 말한다.**
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️ **목록은 원문이 있는지 확실히 알지 못한다.** 서버가 목록 응답에 원문 유무를 실어      │
 * │ 주지 않아(`has_audio` 같은 짝이 없다) 앱은 **작업 단계로 추정한다.**                 │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * 폰에서 받아쓰기까지 끝내고 결과만 올린 옛 통화는 `COMPLETED` 인데 서버에 원문이 없을 수
 * 있고, 그때 버튼이 선다. 이 테스트가 고정하는 것은 **그 경우에도 화면이 빈 채로 남지
 * 않는다**는 것이다 — 서버가 `has_transcript` 를 주면 버튼 자체가 사라지고, 그때 이 테스트는
 * 「버튼이 서지 않는다」로 바뀐다.
 */
test('원문이 없는 통화는 원문 화면이 없다고 말한다', async ({ page }) => {
  const { transcript: _gone, ...noText } = done;
  await installCalls(page, server([{ ...noText, call_id: 'call-notext', contact: { name: '무원문', phone: '+821099998888' } }]));
  await login(page);
  await briefRow(page, '무원문').click();
  await page.getByRole('button', { name: '무원문 분석 보기' }).click();
  // 분석은 보인다 — 즉 상세는 제대로 받았고, 없는 것은 원문뿐이다.
  // ⚠️ `.last()` — 목록이 아래에 숨은 채 살아 있다(위 `BUDGET_TOO_SMALL` 주석과 같은 이유).
  await expect(page.getByText('도입 견적을 요청한 통화입니다.').last()).toBeVisible();
  // 분석이 있으므로 보고서는 원문으로 가는 길을 따로 권하지 않는다.
  await expect(page.getByRole('button', { name: '무원문 통화 원문 보기' })).toHaveCount(0);
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  await page.getByRole('button', { name: '무원문 통화 원문' }).click();
  await expect(page.getByText('저장된 통화 원문이 없습니다.')).toBeVisible();
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
  await expect(page.getByText('이름,전화번호 뒷자리 4자로 검색해 주세요.')).toBeVisible();
  // 스크롤하지 않아도 통화일시와 제출 버튼이 한 화면에 있다.
  await expect(page.getByLabel('통화일시', { exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '등록하기', exact: true })).toBeInViewport();
  // 같은 이름의 검색칸이 목록에도 있다(시트가 그 위에 뜬다). 뒤에 붙는 시트 쪽을 고른다.
  const search = page.getByRole('textbox', { name: '이름,전화번호 뒷자리 4자', exact: true }).last();
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
  await expect(page.getByText('50건', { exact: true })).toBeVisible();
  expect(asked).toEqual([{ limit: '50', cursor: null }]);
  await expect(page.getByText('b통화0', { exact: true })).toHaveCount(0);
  // 바닥이 가까워지면 다음 묶음이 붙는다.
  await page.getByText('a통화49', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText('60건', { exact: true })).toBeVisible();
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
  await page.getByRole('textbox', { name: '이름,전화번호 뒷자리 4자', exact: true }).fill('5678');
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
  const box = page.getByRole('textbox', { name: '이름,전화번호 뒷자리 4자', exact: true });
  await box.fill('김');
  /*
    🔴 **디바운스(300ms)가 끝나고 실제로 요청이 나갈 때까지 기다린다.** 기다리지 않고 다음
    글자를 치면 이 검색어는 영영 나가지 않아, 아래 「검색어마다 커서를 새로 시작한다」가
    빈 배열을 보고 통과해 버린다.
  */
  await expect.poll(() => asked.filter((entry) => entry.q === '김').length).toBeGreaterThan(0);
  /*
    머리말 없이 **수만** 적는다. 「불러온」·「검색 결과」는 붙은 자리가 목록 바로 위라 이미
    아는 사실을 한 번 더 말하는 꼴이고, 그만큼 숫자가 늦게 읽힌다.
    ⚠️ 뒤의 `+` 는 **커서가 남아 있는 동안만** 붙는다(= 이 수가 전부가 아니라는 뜻). 여기서는
    앱이 곧바로 다음 묶음을 이어 받아 커서를 비우므로 붙었다 사라진다 — 그래서 선택적으로 본다.
  */
  await expect(page.getByText(/^\d+건\+?$/)).toBeVisible();
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
  await page.getByRole('textbox', { name: '이름,전화번호 뒷자리 4자', exact: true }).fill('멀리');
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
  await page.getByRole('textbox', { name: '이름,전화번호 뒷자리 4자', exact: true }).fill('없는 이름');
  await expect(page.getByText('검색어에 해당하는 통화가 없습니다.')).toBeVisible();
});
