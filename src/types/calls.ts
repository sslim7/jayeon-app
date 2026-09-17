export type CallStatus = 'PENDING' | 'PREPARING' | 'TRANSCRIBING' | 'ANALYZING' | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'TRANSCRIPTION_FAILED' | 'ANALYSIS_FAILED' | 'UPLOAD_FAILED' | 'UPLOAD_REJECTED';
export interface CallContact { name: string; phone: string; recipient_id?: string | null }
export interface TranscriptSegment { start: number; end: number; text: string; speaker?: string }
/**
 * 저장·업로드하는 분석 한 덩어리. **서버 계약과 같은 모양**이다(`internal/calls/model.go`).
 *
 * 🔧 이 버전의 기기 분석은 `summary` 만 채우고 나머지는 빈 배열이다(→ `lib/call-analysis.ts`).
 * 나머지 필드는 **서버 분석이 붙는 자리**로 남겨 둔다 — 지우면 옛 기록을 읽을 수 없고, 서버가
 * 상세 분석을 돌려줄 때 `schema_version` 을 올려야 한다. 채워 넣기만 하면 화면의 탭이
 * 되살아난다(→ `components/call-detail.tsx`).
 */
export interface CallAnalysis {
  schema_version: 1;
  summary: string;
  details: { title: string; content: string }[];
  todos: { content: string; owner: string | null; due_date: string | null; source: string }[];
  decisions: string[];
  consulting: { customer_needs: string[]; questions: string[]; concerns: string[]; objections: string[]; important_points: string[]; followups: string[] };
}
/** 화면에 보이는 네 단계. 내부 status 를 이 넷으로 묶는다(→ `lib/call-progress.ts`). */
export type CallStageKey = 'PREPARE' | 'TRANSCRIBE' | 'ANALYZE' | 'UPLOAD';
/** `started_at` 이 남아 있으면 그 단계가 도는 중이고, `ms` 는 **끝난 구간의 합**이다. */
export interface CallStageTiming { started_at?: string | null; ms?: number | null }
/**
 * 기기에서 잰 분석 시간. **서버로 보내지 않는다** — 업로드 payload 에서 빼고 보낸다
 * (→ `call-runtime.ts`). 서버는 모르는 필드를 400 으로 거부한다.
 *
 * 단계 시간은 재개·재시도를 거치며 **합산**된다. 시작 시각은 마지막으로 분석을 시작한 때다.
 */
/**
 * 실패를 다음에 짚기 위한 **숫자만** 담는다. 통화 내용은 절대 담지 않는다.
 * `stopped_limit` 은 출력 한도에 닿아 끊긴 횟수, `skipped` 는 끝내 요약하지 못해 뺀 구간 수,
 * `merge_fallbacks` 는 요약 통합에 실패해 구간 요약을 이어 붙인 횟수다.
 */
export interface CallLlmStats { chunks: number; completions: number; skipped: number; tokens: number; tokens_per_second: number | null; stopped_limit: number; merge_fallbacks: number }
/**
 * 진행 중인 구간의 실시간 상태. **메모리에만 있고 저장·업로드하지 않는다**(토큰마다 DB 를
 * 쓰면 SQLite 가 종일 돈다). 목록·상세를 읽을 때 그 순간 값을 붙여 준다.
 * `chunk: 0` 은 요약 통합 단계다.
 */
export interface CallLive { chunk: number; chunks: number; tokens: number; tokens_per_second: number | null }
export interface CallTiming { started_at: string; llm?: CallLlmStats; finished_at?: string | null; stages?: { [K in CallStageKey]?: CallStageTiming } }
export interface CallRecord {
  call_id: string;
  contact: CallContact;
  call: { file_name: string; duration: number | null; recorded_at: string };
  created_at: string;
  status: CallStatus;
  progress: number | null;
  summary?: string;
  transcript?: { text: string; segments: TranscriptSegment[] };
  analysis?: CallAnalysis;
  ai?: { model: string; model_version: string; processed_on_device: true };
  error?: string | null;
  timing?: CallTiming | null;
  live?: CallLive | null;
}
/** `modified_at` 은 고른 파일의 시각(ms). 통화일시 기본값으로만 쓰고, 없으면 사용자가 고른다. */
export interface CallFile { token: string; name: string; size: number; modified_at?: number | null }
export interface CallStartInput { file: CallFile; contact: CallContact; recorded_at: string }
/** `notice` 는 오류가 아닌 상태(일시정지 등)를 담는다. 오류 배너와 구분해서 보여 준다. */
export interface CallModelState { supported: boolean; installed: boolean; downloading: boolean; downloaded_bytes: number; total_bytes: number; error?: string | null; notice?: string | null }
export interface CallDevice {
  models(): Promise<CallModelState>;
  install(): Promise<void>;
  pickFile(): Promise<CallFile | null>;
  start(input: CallStartInput): Promise<CallRecord>;
  list(): Promise<CallRecord[]>;
  get(id: string): Promise<CallRecord | null>;
  retry(id: string): Promise<void>;
}
