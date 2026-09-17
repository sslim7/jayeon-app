import * as SQLite from 'expo-sqlite';
import * as FS from 'expo-file-system/legacy';
import type { CallRecord } from '@/types/calls';
import type { ChunkResult } from './call-analysis';
import { excludeFromBackup } from './call-models';
/** 파일 경로는 documentDirectory 기준 상대 경로다. iOS 는 앱 업데이트마다 컨테이너 UUID 가 바뀐다. */
export interface LocalCall extends CallRecord { local_file_uri?: string; wav_uri?: string | null }
let opening: Promise<SQLite.SQLiteDatabase> | null = null;
function db() {
  if (!opening) opening = (async () => {
    const connection = await SQLite.openDatabaseAsync('nature-calls-v1.db');
    // 통화 원문·분석은 iCloud 백업에 남기지 않는다. 완료된 결과는 서버에서 다시 받을 수 있다.
    await excludeFromBackup(`${FS.documentDirectory}SQLite`);
    await connection.execAsync(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS calls (owner TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,id));
      CREATE TABLE IF NOT EXISTS transcripts (owner TEXT NOT NULL, call_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,call_id));
      CREATE TABLE IF NOT EXISTS call_analyses (owner TEXT NOT NULL, call_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,call_id));
      CREATE TABLE IF NOT EXISTS analysis_chunks (owner TEXT NOT NULL, call_id TEXT NOT NULL, chunk_index TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,call_id,chunk_index));
      CREATE TABLE IF NOT EXISTS sync_status (owner TEXT NOT NULL, call_id TEXT NOT NULL, retry_count INTEGER DEFAULT 0, last_attempt_at TEXT, synced_at TEXT, PRIMARY KEY(owner,call_id));`);
    return connection;
  })();
  return opening;
}
export async function saveCall(owner: string, call: LocalCall) {
  const connection = await db();
  const { transcript, analysis, ...metadata } = call;
  // A transaction makes checkpoint+status atomic if the OS terminates us during a write.
  await connection.withExclusiveTransactionAsync(async tx => {
    await tx.runAsync('INSERT OR REPLACE INTO calls(owner,id,data) VALUES(?,?,?)', owner, call.call_id, JSON.stringify(metadata));
    if (transcript) await tx.runAsync('INSERT OR REPLACE INTO transcripts(owner,call_id,data) VALUES(?,?,?)', owner, call.call_id, JSON.stringify(transcript));
    if (analysis) await tx.runAsync('INSERT OR REPLACE INTO call_analyses(owner,call_id,data) VALUES(?,?,?)', owner, call.call_id, JSON.stringify(analysis));
  });
}
export async function readCall(owner: string, id: string): Promise<LocalCall | null> {
  const connection = await db();
  const row = await connection.getFirstAsync<{ data: string }>('SELECT data FROM calls WHERE owner=? AND id=?', owner, id);
  if (!row) return null;
  const transcript = await connection.getFirstAsync<{ data: string }>('SELECT data FROM transcripts WHERE owner=? AND call_id=?', owner, id);
  const analysis = await connection.getFirstAsync<{ data: string }>('SELECT data FROM call_analyses WHERE owner=? AND call_id=?', owner, id);
  return { ...JSON.parse(row.data), ...(transcript ? { transcript: JSON.parse(transcript.data) } : {}), ...(analysis ? { analysis: JSON.parse(analysis.data) } : {}) };
}
export async function listCalls(owner: string): Promise<LocalCall[]> {
  const rows = await (await db()).getAllAsync<{ data: string }>('SELECT data FROM calls WHERE owner=?', owner);
  return rows.map(row => JSON.parse(row.data) as LocalCall).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
/** 구간 캐시에 넣는 값. 구간 결과(`ChunkResult`)이거나 통합 단계의 요약 한 줄이다. */
export async function saveChunk(owner: string, id: string, index: string, value: ChunkResult | string) {
  await (await db()).runAsync('INSERT OR REPLACE INTO analysis_chunks(owner,call_id,chunk_index,data) VALUES(?,?,?,?)', owner, id, index, JSON.stringify(value));
}
export async function readChunk<T>(owner: string, id: string, index: string): Promise<T | null> {
  const row = await (await db()).getFirstAsync<{ data: string }>('SELECT data FROM analysis_chunks WHERE owner=? AND call_id=? AND chunk_index=?', owner, id, index);
  return row ? JSON.parse(row.data) as T : null;
}
/** 분석 결과와 chunk 캐시를 지운다. 같은 캐시를 다시 읽어 같은 지점에서 실패하는 재시도를 끊는다. */
export async function clearAnalysis(owner: string, id: string) {
  const connection = await db();
  await connection.withExclusiveTransactionAsync(async tx => {
    await tx.runAsync('DELETE FROM call_analyses WHERE owner=? AND call_id=?', owner, id);
    await tx.runAsync('DELETE FROM analysis_chunks WHERE owner=? AND call_id=?', owner, id);
  });
}
export async function clearChunks(owner: string, id: string) {
  await (await db()).runAsync('DELETE FROM analysis_chunks WHERE owner=? AND call_id=?', owner, id);
}
export async function syncAttempt(owner: string, id: string) {
  const now = new Date().toISOString();
  await (await db()).runAsync(`INSERT INTO sync_status(owner,call_id,retry_count,last_attempt_at,synced_at) VALUES(?,?,1,?,NULL)
    ON CONFLICT(owner,call_id) DO UPDATE SET retry_count=retry_count+1,last_attempt_at=excluded.last_attempt_at`, owner, id, now);
}
/** 성공/수동 재시도는 백오프를 처음으로 되돌린다. retry_count 를 읽는 쪽이 이 값을 쓴다. */
export async function syncSettled(owner: string, id: string, completed: boolean) {
  const now = new Date().toISOString();
  await (await db()).runAsync(`INSERT INTO sync_status(owner,call_id,retry_count,last_attempt_at,synced_at) VALUES(?,?,0,?,?)
    ON CONFLICT(owner,call_id) DO UPDATE SET retry_count=0,last_attempt_at=excluded.last_attempt_at,synced_at=excluded.synced_at`, owner, id, now, completed ? now : null);
}
export async function syncState(owner: string, id: string): Promise<{ retry_count: number; last_attempt_at: string | null }> {
  const row = await (await db()).getFirstAsync<{ retry_count: number; last_attempt_at: string | null }>('SELECT retry_count,last_attempt_at FROM sync_status WHERE owner=? AND call_id=?', owner, id);
  return { retry_count: row?.retry_count ?? 0, last_attempt_at: row?.last_attempt_at ?? null };
}
export function publicCall(call: LocalCall): CallRecord {
  const { local_file_uri: _file, wav_uri: _wav, ...result } = call;
  return result;
}
