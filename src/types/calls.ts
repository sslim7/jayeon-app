/**
 * 통화분석 계약 — **서버가 정본이다.**
 *
 * 앱은 이제 녹음 파일을 올리고 상태를 조회하기만 한다. 전사·분석은 서버 파이프라인이 한다
 * (§`jayeon-was/internal/calls`). 여기 있는 모양은 그 응답과 1:1 이어야 한다.
 */

/**
 * 화면이 아는 상태 어휘.
 *
 * 서버는 내부 작업 상태(`job_state`)를 **이 닫힌 집합으로 사상해서** 준다(§`model.go` 의
 * `appStatus`). 서버가 쓰는 값은 앞의 일곱 개다.
 *
 * 🔧 `UPLOADING`/`UPLOAD_FAILED`/`UPLOAD_REJECTED`/`FAILED` 는 **기기 분석 시절의 값**이다.
 * 등록 시트가 업로드 중인 상태(`UPLOADING`)에 계속 쓰고, 네이티브 껍데기에 남아 있는 옛
 * 로컬 기록도 이 값을 들고 있다(→ `lib/call-runtime.ts`). 지우면 그 기록을 읽을 수 없다.
 */
export type CallStatus =
  | 'PENDING' | 'PREPARING' | 'TRANSCRIBING' | 'ANALYZING' | 'COMPLETED'
  | 'TRANSCRIPTION_FAILED' | 'ANALYSIS_FAILED'
  | 'UPLOADING' | 'UPLOAD_FAILED' | 'UPLOAD_REJECTED' | 'FAILED';

export interface CallContact { name: string; phone: string; recipient_id?: string | null }
export interface TranscriptSegment { start: number; end: number; text: string; speaker?: string }

/**
 * 통화 원문 한 덩어리. **`PUT /calls/{id}` 와 `POST /calls/{id}/transcript` 가 같은 모양을
 * 받는다**(서버의 `CallTranscript`).
 *
 * ⚠️ `segments` 는 비어 있을 수 있다. 폰에서 받아쓴 원문에는 구간 정보가 없다 — whisper 가
 * 주기는 하지만 우리는 청크를 이어 붙인 글만 들고 있고, **없는 구간을 지어내지 않는다**
 * (→ `lib/asr-local-types.ts` 의 `asrLocalText`).
 */
export interface CallTranscript { text: string; segments: TranscriptSegment[] }

/**
 * 분석 한 덩어리. **서버 계약과 같은 모양**이다(`internal/calls/model.go`).
 *
 * 항목이 비어 있을 수 있다 — 기기 분석이 만든 옛 기록은 `summary` 만 채웠다. 보고서는 내용이
 * 있는 구획만 세우고, 빈 구획은 「확인되지 않은 항목」 한 줄로 말한다
 * (→ `components/call-report.tsx`).
 */
export interface CallAnalysis {
  schema_version: 1;
  summary: string;
  details: { title: string; content: string }[];
  todos: { content: string; owner: string | null; due_date: string | null; source: string }[];
  decisions: string[];
  consulting: { customer_needs: string[]; questions: string[]; concerns: string[]; objections: string[]; important_points: string[]; followups: string[] };
}

/** 화면에 보이는 네 단계. 서버 status 를 이 넷으로 묶는다(→ `lib/call-progress.ts`). */
export type CallStageKey = 'UPLOAD' | 'TRANSCRIBE' | 'ANALYZE' | 'DONE';

/** 무엇이 분석했는지. `provider` 는 서버 파이프라인만, `processed_on_device` 는 옛 기기 기록만 채운다. */
export interface CallAI { model: string; model_version: string; processed_on_device?: boolean; provider?: string }

/**
 * 통화 한 건에 **실제로 든 돈.** 단위는 원이고 서버가 계산해서 준다.
 *
 * 🔴 **앱은 단가를 모른다.** 단가·환율은 서버 설정이라 개정되는데, 앱이 곱하기 시작하면
 * 단가가 바뀔 때마다 새로 배포해야 하고 그전까지 구버전 앱은 옛 금액을 계속 보여 준다
 * (§`jayeon-was/internal/calls/cost.go`).
 *
 * 🔴 **정수로 반올림되어 오지 않는다.** 1원 미만이 그대로 실려 오며, 그것을 「0원」으로
 * 적으면 공짜로 읽힌다 — 표기는 `lib/call-cost.ts` 가 맡는다.
 *
 * `usage` 는 금액의 **근거**다. 금액만 있으면 「이 숫자가 왜 이렇지」를 검산할 수 없다.
 * `output_tokens` 에는 추론 토큰이 **이미 포함**돼 있고 `reasoning_tokens` 는 그 내역이다.
 */
export interface CallCost {
  currency: 'KRW';
  /** 받아쓰기(ASR) 비용. 이 제품에서는 비용의 대부분이 여기다. */
  transcription: number;
  /** 분석(LLM) 비용. */
  analysis: number;
  total: number;
  usage: { audio_seconds: number; input_tokens: number; output_tokens: number; reasoning_tokens: number };
}

export interface CallRecord {
  call_id: string;
  contact: CallContact;
  call: { file_name: string; duration: number | null; recorded_at: string };
  created_at: string;
  status: CallStatus;
  /**
   * 진행률 — 🔴 **0~1 실수다.** 서버가 단계별 고정값으로 준다(§`job.go` 의 `progressOf`).
   *
   * 기기 분석 시절에는 0~100 정수였다. 두 가지 뜻이 한 필드에 섞이면 막대가 1% 에서 멈춘
   * 것처럼 보이므로, 앱 안에서도 **언제나 0~1** 로만 다루고 화면에 그릴 때만 백분율로 바꾼다
   * (→ `lib/call-progress.ts` 의 `percentOf`). 업로드 중 진행률도 같은 단위로 넣는다.
   */
  progress: number | null;
  summary?: string;
  transcript?: CallTranscript;
  analysis?: CallAnalysis;
  ai?: CallAI;
  /** 서버 파이프라인의 내부 작업 상태 원문(`QUEUED`·`ASR_POLLING`…). 기기 경로 기록에는 없다. */
  job_state?: string | null;
  /** 사람이 그대로 읽을 한 줄(「받아쓰는 중」). 서버가 만든다 — 앱이 지어내지 않는다. */
  stage?: string | null;
  /** 원본 녹음이 아직 서버에 있나. **목록에서 재생 버튼을 열지 정하는 유일한 근거다.** */
  has_audio?: boolean;
  /**
   * 녹음을 들을 수 있는 서명 주소. **15분이면 만료되고 상세를 조회할 때마다 새로 발급된다.**
   *
   * 🔴 목록(`GET /calls`)에는 오지 않는다 — 재생하려면 상세를 한 번 물어봐야 한다
   * (→ `components/call-playback.tsx`).
   */
  audio_url?: string | null;
  /**
   * 이 통화에 든 돈. **상세(`GET /calls/{id}`)에만 온다** — 목록에는 오지 않는다.
   *
   * 🔴 없는 것이 정상인 경우가 셋이고 전부 오류가 아니다: ①서버에 단가 설정이 없다
   * ②사용량이 없는 옛 통화다 ③기기 분석 시절 기록이라 사용량이 애초에 없다.
   * **그때 「0원」을 그리면 안 된다 — 0원과 「모름」은 다르다.** 화면은 칸을 통째로 걷는다.
   */
  cost?: CallCost | null;
  /** 실패 코드. 사람이 읽을 문구는 앱이 만든다(→ `lib/call-errors.ts`). */
  error?: string | null;
}

/**
 * 고른 녹음 파일의 **손잡이**. 바이트를 들고 있지 않다.
 *
 * 🔴 base64 로 바꾸지 않는다. 28MB 통화 하나를 문자열로 만들면 그 순간 메모리에 40MB 가
 * 올라가고, 네이티브 껍데기의 브리지는 64KB 에서 끊긴다. 웹은 `File` 을 그대로 XHR 바디로,
 * 네이티브는 `file://` URI 를 업로드 태스크로 넘긴다(→ `lib/call-put.ts`).
 */
export type CallFileSource = { kind: 'web'; file: Blob } | { kind: 'native'; uri: string };

/** `modified_at` 은 고른 파일의 시각(ms). 통화일시 기본값으로만 쓰고, 없으면 사용자가 고른다. */
export interface CallFile {
  name: string;
  size: number;
  /** 서버 화이트리스트 안의 MIME. **서명에 들어가는 값**이라 업로드 헤더와 한 글자도 달라선 안 된다. */
  content_type: string;
  modified_at?: number | null;
  source: CallFileSource;
}

export interface CallStartInput { file: CallFile; contact: CallContact; recorded_at: string }
