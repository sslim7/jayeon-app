/**
 * **다 받아썼는데 아직 못 보낸 전사문**을 붙잡아 두는 곳.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **여기가 없으면 「7분을 기다려 다 받아썼는데 전파가 끊겨서 통째로 날아갔다」가 된다.** │
 * │ 받아쓰기 엔진은 마지막 청크가 끝나면 이어하기 상태를 지운다 — 그 시점부터 전사문은     │
 * │ **화면의 메모리에만** 있다. 앱이 그 사이에 죽으면 폰이 7분 동안 한 일이 사라진다.      │
 * │ 그래서 보내기 **직전에** 여기 적고, 서버가 200 을 준 뒤에 지운다.                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **캐시가 아니라 문서 폴더다.** 캐시는 OS 가 언제든 지운다. 대신 여기에는 통화 원문이
 * 그대로 들어 있으므로 **백업에서 뺀다** — iCloud 로 통화 내용이 새면 그건 우리가 만든
 * 유출이다(→ `lib/asr-local.ts` 가 이어하기 상태에 하는 것과 같은 처리다).
 *
 * 🔴 서버는 6시간이 지나 통화를 정리한 뒤에도 **늦게 온 전사문을 받아 준다.** 그래서 여기
 * 남은 글은 시간이 지났다고 버릴 것이 아니라, 다음에 화면을 열었을 때 그대로 보내면 된다.
 */
import * as FS from 'expo-file-system/legacy';
import { excludeFromBackup } from './call-native';

const DIRECTORY = `${FS.documentDirectory}asr-pending/`;

/** 파일 이름이 되는 값이라 글자를 제한한다. `../` 가 섞이면 앱 저장소 밖을 건드린다. */
const CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;

function pendingUri(callId: string): string {
  if (!CALL_ID.test(callId)) throw new Error('통화 ID 에 쓸 수 없는 글자가 있습니다.');
  return `${DIRECTORY}${callId}.txt`;
}

/**
 * 보내기 전에 적어 둔다.
 *
 * ⚠️ 여기서 실패해도 **보내기를 막지 않는다.** 저장은 보험이지 전송의 조건이 아니다 —
 * 저장에 실패했다고 이미 받아쓴 것을 안 보내면 보험 때문에 본체를 잃는 셈이 된다.
 */
export async function savePendingTranscript(callId: string, text: string): Promise<void> {
  await FS.makeDirectoryAsync(DIRECTORY, { intermediates: true });
  await excludeFromBackup(DIRECTORY);
  await FS.writeAsStringAsync(pendingUri(callId), text);
  await excludeFromBackup(pendingUri(callId));
}

/** 아직 못 보낸 글. 없으면 `null` 이고, 부른 쪽은 처음부터 받아쓴다. */
export async function loadPendingTranscript(callId: string): Promise<string | null> {
  try {
    const text = await FS.readAsStringAsync(pendingUri(callId));
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** 서버가 받았다. 🔴 **200 을 받은 뒤에만** 지운다 — 보내는 중에 지우면 보험이 사라진다. */
export async function clearPendingTranscript(callId: string): Promise<void> {
  await FS.deleteAsync(pendingUri(callId), { idempotent: true });
}
