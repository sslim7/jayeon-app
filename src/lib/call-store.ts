/**
 * 로컬 통화 저장소 — **이제 남은 일은 「옛 결과를 마저 올리는 것」 하나다.**
 *
 * 분석이 서버로 옮겨가면서 앱은 더 이상 통화 원문·분석을 만들지 않는다. 그런데 기기에서
 * 분석하던 버전이 **끝내 올리지 못한 결과가 사용자 기기에 남아 있다** — 서버 저장에 실패한
 * 채로 앱이 업데이트되면 그 통화는 영원히 사라진다.
 *
 * 🔴 **DB 이름(`nature-calls-v1.db`)을 바꾸지 않는다.** 이름을 바꾸면 새 빈 DB 가 생기고
 * 옛 파일은 아무도 열지 않는 채로 기기에 남는다.
 *
 * 🔧 **새로 쓰는 표는 `calls` 와 `sync_status` 둘뿐이다.** `transcripts`·`call_analyses` 는
 * **읽기만** 한다(못 올린 결과를 꺼내려고). `analysis_chunks` 는 기기 추론의 중간 캐시라
 * 이제 아무도 건드리지 않는다. TODO: 마지막 기기 분석 버전이 충분히 사라진 뒤 별도 릴리스에서
 * 세 표를 DROP 한다(지금 지우면 롤백한 사용자의 결과가 함께 사라진다).
 */
import * as SQLite from 'expo-sqlite';
import * as FS from 'expo-file-system/legacy';
import type { CallAnalysis, CallRecord, TranscriptSegment } from '@/types/calls';
import { excludeFromBackup } from './call-native';

/** 기기 분석이 남긴 한 건. 파일 경로는 documentDirectory 기준 상대 경로였다. */
export interface LocalCall extends CallRecord { local_file_uri?: string; wav_uri?: string | null }

let opening: Promise<SQLite.SQLiteDatabase> | null = null;
function db() {
  if (!opening) opening = (async () => {
    const connection = await SQLite.openDatabaseAsync('nature-calls-v1.db');
    // 남아 있는 통화 원문·분석은 iCloud 백업에 올리지 않는다.
    await excludeFromBackup(`${FS.documentDirectory}SQLite`);
    // 옛 표는 만들지 않는다. 이미 있는 기기에서는 그대로 남고, 새 기기에서는 처음부터 없다.
    await connection.execAsync(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS calls (owner TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,id));
      CREATE TABLE IF NOT EXISTS sync_status (owner TEXT NOT NULL, call_id TEXT NOT NULL, retry_count INTEGER DEFAULT 0, last_attempt_at TEXT, synced_at TEXT, PRIMARY KEY(owner,call_id));`);
    return connection;
  })();
  return opening;
}

export async function listCalls(owner: string): Promise<LocalCall[]> {
  const rows = await (await db()).getAllAsync<{ data: string }>('SELECT data FROM calls WHERE owner=?', owner);
  return rows.map(row => JSON.parse(row.data) as LocalCall).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * 옛 표에서 통화 원문·분석을 꺼낸다. **읽기 전용이다.**
 *
 * 표가 아예 없는 기기(이 버전부터 쓰기 시작한 설치)에서는 SQLite 가 던진다 — 그것은 고장이
 * 아니라 「올릴 옛 결과가 없다」는 뜻이므로 조용히 빈 값을 돌려준다.
 */
export async function readLegacyResult(owner: string, id: string): Promise<{ transcript?: { text: string; segments: TranscriptSegment[] }; analysis?: CallAnalysis }> {
  try {
    const connection = await db();
    const transcript = await connection.getFirstAsync<{ data: string }>('SELECT data FROM transcripts WHERE owner=? AND call_id=?', owner, id);
    const analysis = await connection.getFirstAsync<{ data: string }>('SELECT data FROM call_analyses WHERE owner=? AND call_id=?', owner, id);
    return {
      ...(transcript ? { transcript: JSON.parse(transcript.data) } : {}),
      ...(analysis ? { analysis: JSON.parse(analysis.data) } : {}),
    };
  } catch {
    return {};
  }
}

/** 통화 한 건의 상태만 고쳐 쓴다(원문·분석은 옛 표에 그대로 둔다). */
export async function saveCall(owner: string, call: LocalCall) {
  const { transcript: _transcript, analysis: _analysis, ...metadata } = call;
  await (await db()).runAsync('INSERT OR REPLACE INTO calls(owner,id,data) VALUES(?,?,?)', owner, call.call_id, JSON.stringify(metadata));
}

export async function syncAttempt(owner: string, id: string) {
  const now = new Date().toISOString();
  await (await db()).runAsync(`INSERT INTO sync_status(owner,call_id,retry_count,last_attempt_at,synced_at) VALUES(?,?,1,?,NULL)
    ON CONFLICT(owner,call_id) DO UPDATE SET retry_count=retry_count+1,last_attempt_at=excluded.last_attempt_at`, owner, id, now);
}

/** 성공은 백오프를 처음으로 되돌리고 올린 시각을 남긴다. 이 시각이 있으면 다시 올리지 않는다. */
export async function syncSettled(owner: string, id: string, completed: boolean) {
  const now = new Date().toISOString();
  await (await db()).runAsync(`INSERT INTO sync_status(owner,call_id,retry_count,last_attempt_at,synced_at) VALUES(?,?,0,?,?)
    ON CONFLICT(owner,call_id) DO UPDATE SET retry_count=0,last_attempt_at=excluded.last_attempt_at,synced_at=excluded.synced_at`, owner, id, now, completed ? now : null);
}

export async function syncState(owner: string, id: string): Promise<{ retry_count: number; last_attempt_at: string | null; synced_at: string | null }> {
  const row = await (await db()).getFirstAsync<{ retry_count: number; last_attempt_at: string | null; synced_at: string | null }>('SELECT retry_count,last_attempt_at,synced_at FROM sync_status WHERE owner=? AND call_id=?', owner, id);
  return { retry_count: row?.retry_count ?? 0, last_attempt_at: row?.last_attempt_at ?? null, synced_at: row?.synced_at ?? null };
}

/** 로컬 사본(원본 녹음, 변환한 WAV)을 지운다. 올리고 나면 다시 만들 일이 없다. */
export async function dropLocalFiles(owner: string, call: LocalCall) {
  for (const relative of [call.wav_uri, call.local_file_uri]) {
    if (!relative) continue;
    const uri = relative.startsWith('file://') ? relative : `${FS.documentDirectory}${relative}`;
    try { await FS.deleteAsync(uri, { idempotent: true }); } catch { /* 남은 파일은 다음에 다시 지운다. */ }
  }
  call.wav_uri = null; delete call.local_file_uri;
  await saveCall(owner, call);
}
