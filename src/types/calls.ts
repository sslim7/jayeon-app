export type CallStatus = 'PENDING' | 'PREPARING' | 'TRANSCRIBING' | 'ANALYZING' | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'TRANSCRIPTION_FAILED' | 'ANALYSIS_FAILED' | 'UPLOAD_FAILED' | 'UPLOAD_REJECTED';
export interface CallContact { name: string; phone: string; recipient_id?: string | null }
export interface TranscriptSegment { start: number; end: number; text: string; speaker?: string }
export interface CallAnalysis {
  schema_version: 1;
  summary: string;
  details: { title: string; content: string }[];
  todos: { content: string; owner: string | null; due_date: string | null; source: string }[];
  decisions: string[];
  consulting: { customer_needs: string[]; questions: string[]; concerns: string[]; objections: string[]; important_points: string[]; followups: string[] };
}
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
}
export interface CallFile { token: string; name: string; size: number }
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
