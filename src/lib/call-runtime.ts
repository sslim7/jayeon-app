/**
 * 남은 결과를 마저 올리는 큐 — **네이티브 껍데기 전용, 화면 없음.**
 *
 * # 이 파일에 무엇이 남았나
 *
 * 기기에서 STT/LLM 을 돌리던 시절, 이 파일은 파일 선택·디코딩·전사·요약·업로드를 모두
 * 들고 있었다. 분석이 서버로 옮겨간 지금 **등록은 화면이 직접 한다** — 웹(그리고 껍데기의
 * 웹뷰)이 서명 URL 로 파일을 올리고 서버가 나머지를 한다(→ `lib/call-upload.ts`).
 *
 * 그래도 지울 수 없는 일이 하나 남는다. 기기 분석 버전이 **분석까지 끝내 놓고 서버 저장에
 * 실패한 통화**가 사용자 기기에 남아 있다. 그대로 두면 앱을 업데이트하는 순간 그 통화는
 * 영원히 사라진다 — 사용자는 분석이 끝났다고 들었는데 목록에는 없다. 그래서 큐와 백오프
 * 뼈대만 남겨 **조용히 마저 올린다.**
 *
 * 🔴 **화면에 나타나지 않는다.** 통화분석 화면은 껍데기의 웹뷰 안에서 돌고, 그 안에서는
 * 이 로컬 DB 가 보이지 않는다. 그래서 여기서 성공한 결과는 **서버 목록을 통해** 사용자에게
 * 돌아온다. 그것이 이 큐가 존재하는 이유이기도 하다.
 *
 * TODO: 기기 분석 버전이 현장에서 충분히 사라진 뒤, 이 파일과 로컬 DB·모델 파일(787MB)을
 * 함께 걷는 별도 릴리스를 낸다. **이번 릴리스에서 지우지 않는다** — 롤백하면 787MB 를 다시
 * 받아야 한다.
 */
import { AppState } from 'react-native';
import { useUserStore } from '@/store/user-store';
import { getSessionVersion } from '@/lib/auth-tokens';
import { api, ApiError } from '@/lib/api';
import { sanitizeTranscript } from './call-analysis';
import { failureCode, httpCode, permanentFailure } from './call-errors';
import { dropLocalFiles, listCalls, readLegacyResult, saveCall, syncAttempt, syncSettled, syncState, type LocalCall } from './call-store';

const queue = new Set<string>();
let running = false;
let serviceStarted = false;

function currentOwner(): string | null {
  const user = useUserStore.getState();
  return user.stage === 'authed' && user.profile?.userId ? user.profile.userId : null;
}

/**
 * 껍데기가 뜰 때 한 번 부른다(→ `components/web-shell.tsx`).
 *
 * 앞에 나와 있을 때만 돈다. 백그라운드에서 네트워크를 붙잡고 있을 이유가 없고, 실패하면
 * 다음 전환이나 1분 타이머가 다시 집는다.
 */
export function startCallService() {
  if (serviceStarted) return;
  serviceStarted = true;
  useUserStore.subscribe((state, previous) => {
    if (state.stage !== previous.stage || state.profile?.userId !== previous.profile?.userId) {
      queue.clear();
      void resumePending().catch(() => {});
    }
  });
  AppState.addEventListener('change', state => { if (state === 'active') void resumePending().catch(() => {}); });
  setInterval(() => { if (AppState.currentState === 'active') void resumePending().catch(() => {}); }, 60_000);
  void resumePending().catch(() => {});
}

/** 아직 서버에 닿지 못한 기록만 집는다. 올린 적이 있으면(`synced_at`) 건드리지 않는다. */
async function resumePending() {
  const owner = currentOwner();
  if (!owner || AppState.currentState !== 'active') return;
  const calls = await listCalls(owner);
  if (currentOwner() !== owner) return;
  for (const call of calls) {
    // 서버가 내용 자체를 거부한 기록은 다시 보내도 같은 답이 온다. 큐에 넣지 않는다.
    if (call.status === 'UPLOAD_REJECTED') continue;
    const sync = await syncState(owner, call.call_id);
    if (sync.synced_at) continue;
    if (sync.last_attempt_at && Date.now() - Date.parse(sync.last_attempt_at) < backoff(sync.retry_count)) continue;
    queue.add(call.call_id);
  }
  void drain().catch(() => {});
}

async function drain() {
  if (running || AppState.currentState !== 'active') return;
  running = true;
  try {
    while (queue.size && AppState.currentState === 'active') {
      const owner = currentOwner(); if (!owner) break;
      const id = queue.values().next().value!; queue.delete(id);
      await upload(owner, id).catch(() => {});
    }
  } finally { running = false; }
}

/** 연달아 실패하면 간격을 벌린다. 1분, 2분, 4분… 30분에서 멈춘다. */
function backoff(count: number) { return count <= 0 ? 0 : Math.min(60_000 * 2 ** (count - 1), 30 * 60_000); }

async function upload(owner: string, id: string) {
  const version = getSessionVersion();
  const calls = await listCalls(owner);
  const call = calls.find(row => row.call_id === id);
  if (!call) return;
  const legacy = await readLegacyResult(owner, id);
  // 분석까지 끝난 것만 올릴 수 있다. 전사만 있는 기록은 이제 이어서 분석할 방법이 없다 —
  // 사용자가 그 통화를 다시 등록하면 서버가 처음부터 처리한다.
  if (!legacy.analysis || !legacy.transcript) { await syncSettled(owner, id, true); return; }
  try {
    const payload = legacyPayload(call, legacy.transcript, legacy.analysis);
    await syncAttempt(owner, id);
    if (getSessionVersion() !== version || currentOwner() !== owner) return;
    await api.put(`/calls/${encodeURIComponent(id)}`, payload);
    if (getSessionVersion() !== version || currentOwner() !== owner) return;
    await syncSettled(owner, id, true);
    call.status = 'COMPLETED'; call.progress = null; call.error = null;
    await saveCall(owner, call);
    await dropLocalFiles(owner, call);
  } catch (error) {
    if (getSessionVersion() !== version || currentOwner() !== owner) return;
    const code = error instanceof ApiError ? httpCode(error.status) : failureCode(error);
    // 4xx 는 다시 보내도 같은 답이 온다. 재시도 대상에서 빼고 그 사실을 기록에 남긴다.
    if (permanentFailure(code)) { call.status = 'UPLOAD_REJECTED'; call.error = code; await saveCall(owner, call); return; }
    call.status = 'UPLOAD_FAILED'; call.error = code; await saveCall(owner, call);
  }
}

/**
 * 기기 업로드 규약(`PUT /calls/{id}`)에 맞춘 본문.
 *
 * 🔴 **보낼 키를 고정 목록으로 만든다.** 서버 핸들러가 `DisallowUnknownFields` 라 모르는
 * 키 하나면 400 이고, 로컬 기록에는 이 버전이 남긴 필드(분석 시간, 파일 경로)가 섞여 있다.
 * 펼쳐 담지 않고 **필요한 것만 옮긴다.**
 */
function legacyPayload(call: LocalCall, transcript: NonNullable<LocalCall['transcript']>, analysis: NonNullable<LocalCall['analysis']>) {
  return {
    call_id: call.call_id,
    contact: call.contact.recipient_id
      ? { name: call.contact.name, phone: call.contact.phone, recipient_id: call.contact.recipient_id }
      : { name: call.contact.name, phone: call.contact.phone },
    call: { file_name: call.call.file_name, duration: call.call.duration, recorded_at: call.call.recorded_at },
    created_at: call.created_at,
    // 기기 경로는 **끝난 결과만** 올린다. 서버도 이 값을 COMPLETED 로 못박는다.
    status: 'COMPLETED',
    progress: null,
    transcript: sanitizeTranscript(transcript),
    analysis,
    ai: call.ai ?? { model: 'unknown', model_version: '1', processed_on_device: true },
  };
}
