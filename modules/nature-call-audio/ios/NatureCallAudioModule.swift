import ExpoModulesCore

/**
 * 통화 관련 네이티브 — **백업 제외 하나만 남은 축소판.**
 *
 * 기기 분석 시절의 `decode`(AVAssetReader 로 16kHz WAV 변환)·`sha256`·`cpuCount` 는 부르는
 * 곳이 없어 걷었다(`git show HEAD:modules/nature-call-audio/ios/NatureCallAudioModule.swift`).
 *
 * 이것만 남긴 이유: 아직 서버로 올라가지 못한 옛 통화 원문·분석이 앱의 SQLite 에 남아 있고
 * (→ `src/lib/call-runtime.ts`), 그것이 iCloud 백업에 올라가면 **통화 내용이 사용자의 백업에
 * 그대로 복사된다.**
 */
public class NatureCallAudioModule: Module {
  // standardizedFileURL 은 심링크를 풀지 않는다. /var -> /private/var 같은 기기 경로에서 항상 어긋난다.
  private func privateURL(_ value: String) throws -> URL {
    guard let url = URL(string: value), url.isFileURL else { throw NSError(domain: "NatureAudio", code: 1) }
    let home = URL(fileURLWithPath: NSHomeDirectory())
    // 아직 없는 파일은 심링크가 풀리지 않을 수 있어 원본/해석본 두 뿌리를 모두 허용한다.
    let roots = [home.path, home.resolvingSymlinksInPath().standardizedFileURL.path]
    let resolved = url.resolvingSymlinksInPath().standardizedFileURL
    guard roots.contains(where: { resolved.path == $0 || resolved.path.hasPrefix($0 + "/") }) else {
      throw NSError(domain: "NatureAudio", code: 1)
    }
    return resolved
  }

  public func definition() -> ModuleDefinition {
    Name("NatureCallAudio")
    AsyncFunction("excludeFromBackup") { (uri: String) in
      var url = try self.privateURL(uri)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
    }
  }
}
