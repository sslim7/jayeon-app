/**
 * 통화 관련 네이티브 한 가지 — **iOS 백업 제외.**
 *
 * 기기에서 STT/LLM 을 돌던 시절에는 이 모듈이 오디오 디코딩(`decode`)·해시(`sha256`)·코어
 * 수(`cpuCount`)까지 들고 있었다. 분석이 서버로 옮겨간 지금 그 셋은 부르는 곳이 없다
 * (→ `modules/nature-call-audio`).
 *
 * 남은 하나는 여전히 필요하다: 옛 기기 분석이 만든 통화 원문·분석이 아직 로컬 SQLite 에
 * 남아 있고(→ `call-store.ts`), 그것이 iCloud 백업에 올라가면 **통화 내용이 사용자의 백업에
 * 그대로 복사된다.** 안드로이드는 `allowBackup=false` 라 no-op 이다.
 */
import { requireNativeModule } from 'expo-modules-core';

export async function excludeFromBackup(uri: string): Promise<void> {
  try { await requireNativeModule<{ excludeFromBackup(uri: string): Promise<void> }>('NatureCallAudio').excludeFromBackup(uri); }
  catch { /* 파일이 아직 없거나 구버전 네이티브 껍데기면 무시한다. 백업 제외는 결과를 바꾸지 않는다. */ }
}
