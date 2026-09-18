package kr.redhead.nature.callaudio

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * 통화 관련 네이티브 — **백업 제외 하나만 남은 축소판.**
 *
 * 기기에서 STT/LLM 을 돌던 시절에는 오디오 디코딩(`decode`), 모델 검증용 스트리밍
 * 해시(`sha256`), 추론 스레드 수를 정할 코어 수(`cpuCount`)가 여기 있었다. 분석이 서버로
 * 옮겨가 셋 다 부르는 곳이 없어졌고, 쓰이지 않는 MediaCodec 파이프라인을 남겨 두면 다음
 * 사람이 그것이 아직 쓰인다고 믿게 된다(`git show HEAD:modules/nature-call-audio/...` 로
 * 볼 수 있다).
 *
 * 남은 하나는 여전히 필요하다: 옛 기기 분석이 만든 통화 원문·분석이 아직 로컬 SQLite 에
 * 남아 서버로 올라가기를 기다린다(→ `src/lib/call-runtime.ts`). iOS 에서 그것이 iCloud
 * 백업에 올라가면 통화 내용이 사용자의 백업에 그대로 복사된다.
 *
 * 🔴 **안드로이드에서는 no-op 이다.** `allowBackup=false` 라 이미 백업 대상이 아니다.
 * 그래도 함수를 두는 이유는 iOS 와 **같은 인터페이스**를 유지하기 위해서다 — 한쪽에만 있으면
 * JS 가 플랫폼 분기를 들고 다녀야 하고, 그 분기는 언젠가 한쪽만 고쳐진다.
 */
class NatureCallAudioModule : Module() {
  // dataDir 는 기기에 따라 /data/user/0 심링크다. 한쪽만 canonical 로 풀면 항상 불일치한다.
  private fun allowedRoots(): List<String> {
    val context = requireNotNull(appContext.reactContext)
    return listOf(File(context.applicationInfo.dataDir), context.filesDir, context.noBackupFilesDir, context.cacheDir)
      .mapNotNull { runCatching { it.canonicalPath }.getOrNull() }
  }

  private fun privateFile(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file")
    val file = File(requireNotNull(parsed.path)).canonicalFile
    require(allowedRoots().any { file.path == it || file.path.startsWith("$it/") })
    return file
  }

  override fun definition() = ModuleDefinition {
    Name("NatureCallAudio")
    // 경로가 우리 앱 안인지만 확인하고 끝낸다. 확인마저 빼면 인터페이스가 거짓말이 된다.
    AsyncFunction("excludeFromBackup") { uri: String -> privateFile(uri); Unit }
  }
}
