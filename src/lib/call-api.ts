import { api } from '@/lib/api';
import type { CallRecord, CallTranscript } from '@/types/calls';

/**
 * 한 번에 받는 통화 수.
 *
 * 서버가 `limit`(1~100)을 받는다(§`internal/calls/store.go`). 예전에는 30건 고정이라 한 화면을
 * 채우려고 앱이 두 번씩 불렀다 — 이제 한 번에 이만큼 받는다.
 */
export const CALL_BATCH = 50;

/**
 * 한 번에 이어 부르는 횟수의 상한.
 *
 * 🔴 **검색은 한 요청이 끝을 뜻하지 않는다.** 서버는 부분 문자열을 인덱스로 찾을 수 없어
 * 최신순으로 문서를 훑어 거르는데, 한 번에 훑는 수(300)에 상한이 있다. 상한에 걸리면 **찾은
 * 만큼만** 주고 `nextCursor` 를 남긴다 — 그래서 **0건 + 커서도 정상 응답**이다.
 *
 * 화면이 빈 채로 멈추지 않도록 여기서 이어 부르되, 없는 이름을 검색했을 때 컬렉션 전체를
 * 훑지 않도록 횟수를 묶는다. 나머지는 사용자가 아래로 내릴 때 이어 받는다.
 */
const MAX_CHAIN = 6;

/**
 * 진행 중인 통화를 다시 물어보는 간격.
 *
 * 5초다. 상세 조회는 서명 URL 을 새로 발급하고 작업 문서를 한 번 더 읽으므로 목록 조회보다
 * 비싸고, 서버 단계가 바뀌는 데는 수십 초가 걸린다 — 2초로 조르면 같은 답을 스무 번 더 받을 뿐이다.
 *
 * 🔴 **목록과 보고서가 같은 값을 쓴다.** 두 화면이 각자 간격을 들고 있으면 한쪽만 고쳐져
 * 「목록에서는 5초, 보고서에서는 2초」 같은 상태가 되는데, 그 차이는 화면에 드러나지 않고
 * 요금과 서버 부하로만 나타난다. 🔴 **두 화면이 동시에 돌지는 않는다** — 목록은 포커스를
 * 잃으면 폴링을 멈춘다(→ `app/calls/index.tsx`).
 */
export const CALL_POLL_MS = 5_000;

export interface CallPage { items: CallRecord[]; nextCursor: string | null }

/** 목록 조회 조건. `q` 가 바뀌면 커서는 무효다(서버가 400 을 준다). */
export interface CallListQuery {
  /** 이름 또는 전화번호 뒷자리. 매칭 규칙은 앱의 `recipient-search.ts` 와 같은 규칙을 서버가 구현했다. */
  q?: string;
  cursor?: string | null;
  limit?: number;
}

/**
 * 업로드 표. `POST /calls/{id}/audio/upload-url` 이 돌려준다.
 *
 * 🔴 **`headers` 를 글자 그대로 PUT 에 실어야 한다.** `Content-Type` 이 서명에 들어가므로 한
 * 글자만 달라도 GCS 가 403 `SignatureDoesNotMatch` 를 주는데, 응답만 봐서는 원인을 알 수 없다
 * (§`jayeon-was/internal/calls/audio.go`).
 */
export interface CallUploadTicket {
  call_id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  object: string;
  expires_at: string;
  max_bytes: number;
  retention_days?: number;
}

/** upload-url 요청 본문. 서버가 모르는 필드를 400 으로 거부하므로 이 모양 그대로 보낸다. */
export interface CallUploadRequest {
  content_type: string;
  size: number;
  contact: CallRecord['contact'];
  call: { file_name: string; duration: number | null; recorded_at: string };
}

/**
 * **누가 받아쓰나.** `complete` 에 실어 보내는 값이다.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **`"server"` 와 「보내지 않음」은 서버에서 같은 뜻이다.** 그래서 앱도 서버 경로에서는  │
 * │ 아예 싣지 않는다 — 기존 통화 등록의 요청 본문을 한 글자도 바꾸지 않기 위해서다.        │
 * │ ⚠️ 서버는 모르는 값을 400 으로 거절한다. 이 두 낱말 밖의 값을 만들지 마라.            │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * `"client"` 로 보내면 서버는 받아쓰기를 **하지 않고 기다린다**(`job_state=ASR_RUNNING`,
 * `stage="기기에서 받아쓰는 중"`). 🔴 **6시간 안에 전사문이 닿지 않으면** 서버가
 * `TRANSCRIPTION_FAILED` + `CLIENT_TRANSCRIPT_TIMEOUT` 로 정리한다.
 */
export type CallAsrMode = 'server' | 'client';

export const callApi = {
  /** 서버 페이지 하나. 최신순이고 **거르기는 서버가 한다**(`q`). */
  async page({ q = '', cursor = null, limit = CALL_BATCH }: CallListQuery = {}): Promise<CallPage> {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const page: { items: CallRecord[]; nextCursor?: string | null } = await api.get(`/calls?${params.toString()}`);
    if (!Array.isArray(page.items)) throw new Error('통화 목록을 확인할 수 없습니다.');
    const next = page.nextCursor ?? null;
    if (next !== null && typeof next !== 'string') throw new Error('통화 목록을 끝까지 불러오지 못했습니다.');
    return { items: page.items, nextCursor: next };
  },
  /**
   * 화면이 한 번에 받는 묶음.
   *
   * 🔴 **`items` 가 비어도 끝이 아니다.** 끝인지 아닌지를 말하는 것은 `nextCursor` 하나뿐이다
   * — 검색 중에는 서버가 스캔 상한에 걸려 0건 + 커서를 돌려줄 수 있다. 그대로 화면에 그리면
   * 「결과 없음」이 뜨고 스크롤이 생기지 않아 다음 요청도 나가지 않는다. 그래서 여기서
   * **뭔가 찾거나 커서가 없어질 때까지** 이어 부른다.
   *
   * 🔴 **전체를 순회하지는 않는다.** 없는 이름을 검색했을 때 컬렉션 전체를 훑으면 그게 그대로
   * 요금이자 대기 시간이다. `MAX_CHAIN` 번에서 멈추고 나머지는 사용자가 아래로 내릴 때 받는다.
   */
  async batch(query: CallListQuery = {}): Promise<CallPage> {
    const items: CallRecord[] = [];
    const seen = new Set<string>();
    // 이어 받은 장 사이에 같은 통화가 겹칠 수 있다(경계에 새 통화가 들어오면 한 칸씩 밀린다).
    // 같은 id 를 두 번 그리면 목록 키가 겹쳐 화면이 어긋나므로 여기서 한 번 거른다.
    const ids = new Set<string>();
    let next = query.cursor ?? null;
    for (let round = 0; round < MAX_CHAIN; round++) {
      const page = await callApi.page({ ...query, cursor: next });
      for (const item of page.items) {
        if (ids.has(item.call_id)) continue;
        ids.add(item.call_id);
        items.push(item);
      }
      // 같은 커서가 다시 오면 서버가 제자리걸음 중이다. 무한 요청 대신 거기서 끊는다.
      if (page.nextCursor && seen.has(page.nextCursor)) throw new Error('통화 목록을 끝까지 불러오지 못했습니다.');
      if (page.nextCursor) seen.add(page.nextCursor);
      next = page.nextCursor;
      if (!next || items.length >= (query.limit ?? CALL_BATCH)) break;
    }
    return { items, nextCursor: next };
  },
  /** 상세. **재생용 서명 주소(`audio_url`)와 서버 단계(`stage`/`job_state`)가 오는 유일한 곳**이다. */
  get: (id: string) => api.get<CallRecord>(`/calls/${encodeURIComponent(id)}`),
  /**
   * 업로드 주소 발급. `complete` 전이라면 **몇 번이든 다시 부를 수 있다** — 객체 경로가
   * 결정적이라 재시도가 그냥 덮어쓴다(§`audio.go` 의 `audioObject`).
   */
  uploadUrl: (id: string, body: CallUploadRequest) => api.post<CallUploadTicket>(`/calls/${encodeURIComponent(id)}/audio/upload-url`, body),
  /**
   * 업로드가 끝났음을 알리고 큐에 넣는다.
   *
   * 🔴 **이미 큐잉된 통화에 다시 불러도 200 이다**(서버가 지금 상태를 그대로 돌려준다).
   * 그래서 앱은 응답을 못 받았을 때 마음 놓고 다시 부를 수 있다.
   *
   * 🔴 **`asr` 를 생략하면 본문 자체를 보내지 않는다.** 서버에서는 「생략」과 `"server"` 가
   * 같은 뜻이지만, 서버 경로의 요청을 예전과 **한 바이트도 다르지 않게** 두는 편이
   * 안전하다 — 값을 실어 보내기 시작하면 그 순간부터 서버 경로도 새 코드 위에 있게 된다.
   *
   * 객체 확인(GCS stat)과 Firestore 쓰기가 함께 일어나므로 기본 한도보다 넉넉히 기다린다.
   */
  complete: (id: string, asr?: CallAsrMode) => api.post<CallRecord>(`/calls/${encodeURIComponent(id)}/audio/complete`, asr ? { asr } : undefined, { timeoutMs: 30_000 }),
  /**
   * 폰에서 받아쓴 원문을 올린다. **서버는 이걸 받고서야 분석을 시작한다.**
   *
   * ┌────────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 **같은 요청을 두 번 보내도 두 번째도 200 이다.** 그래서 응답을 못 받았을 때는       │
   * │ 마음 놓고 다시 보내면 된다 — 28분치 받아쓰기를 「보냈는지 모르겠다」는 이유로          │
   * │ 버리는 것이 이 계약이 막으려는 일이다.                                          │
   * └────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ 6시간이 지나 서버가 통화를 정리한 뒤에도 **늦게 도착한 전사문은 받아 준다.**
   * 타임아웃을 봤다고 앱이 포기하면 안 된다.
   *
   * 본문이 최대 6 MiB 라 기본 한도로는 모자랄 수 있다(→ `lib/call-transcript.ts` 가 크기를
   * 먼저 재고 거른다).
   */
  transcript: (id: string, body: CallTranscript) => api.post<CallRecord>(`/calls/${encodeURIComponent(id)}/transcript`, body, { timeoutMs: 60_000 }),
  /** 오디오를 다시 전사하지 않고 **분석만** 다시 돌린다. 전사가 가장 비싼 단계라 재사용한다. */
  reanalyze: (id: string) => api.post<CallRecord>(`/calls/${encodeURIComponent(id)}/reanalyze`, undefined, { timeoutMs: 30_000 }),
};
