import ExpoModulesCore
import AVFoundation
import CryptoKit

/**
 * 통화 오디오 네이티브 — **안드로이드 쪽(`NatureCallAudioModule.kt`)과 같은 인터페이스.**
 *
 * `decode`/`sha256`/`cpuCount` 는 폰 받아쓰기 측정을 위해 되살린 것이다(→ `docs/on-device-asr.md`).
 * ⚠️ **지금 재려는 것은 안드로이드다.** 그런데도 iOS 를 같이 채우는 이유는, 한쪽에만 있는
 * 함수는 JS 에 플랫폼 분기를 만들고 그 분기는 언젠가 한쪽만 고쳐지기 때문이다. 여기서 몇 줄을
 * 아끼면 나중에 「iOS 에서만 조용히 안 되는 기능」으로 돌아온다.
 *
 * 백업 제외는 iOS 에서만 실제 동작한다 — 안드로이드는 `allowBackup=false` 라 no-op 이다.
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

    // 추론 스레드 수를 정하려면 코어 수가 필요하다. JS 에는 이 값을 주는 API 가 없다.
    Function("cpuCount") { ProcessInfo.processInfo.activeProcessorCount }

    /**
     * AP 문자열 — **iOS 에서는 빈 값이다.**
     *
     * 🔴 이 값은 「퀄컴 Hexagon NPU 가 있는가」를 가리려고 있다. iOS 는 Metal 경로라 그
     * 판정 자체가 필요 없고, 여기서 무엇을 돌려주든 JS 는 안드로이드에서만 본다.
     *
     * ⚠️ **그래도 함수를 둔다.** 한쪽에만 있는 함수는 JS 에 플랫폼 분기를 만들고, 그 분기는
     * 언젠가 한쪽만 고쳐진다 — 이 파일 맨 위에 적어 둔 것과 같은 이유다. 빈 맵이면 JS 가
     * 「모른다」로 읽고 벤치 실측으로 넘어간다.
     */
    Function("socInfo") { () -> [String: String] in [:] }

    // 통화 원본 사본·WAV·모델 파일은 iCloud 백업 대상에서 뺀다.
    AsyncFunction("excludeFromBackup") { (uri: String) in
      var url = try self.privateURL(uri)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
    }

    // 🔴 1MB 씩 흘려 읽는다. 874MB 모델을 Data 로 통째 올리면 그 자리에서 죽는다.
    AsyncFunction("sha256") { (uri: String) -> String in
      let handle = try FileHandle(forReadingFrom: self.privateURL(uri))
      defer { try? handle.close() }
      var hash = SHA256()
      while let bytes = try handle.read(upToCount: 1024 * 1024), !bytes.isEmpty { hash.update(data: bytes) }
      return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /**
     * m4a → **16kHz 모노 16bit WAV.** 초 단위 길이를 돌려준다.
     *
     * 🔴 whisper.cpp 는 16kHz 모노만 받는다. 다른 값을 주면 실패하는 게 아니라 **그럴듯한
     * 헛소리를 전사해 내놓는다** — 알아채기 가장 어려운 고장이다.
     *
     * 리샘플링은 AVAssetReader 의 출력 설정이 직접 해 준다(안드로이드는 직접 보간해야 한다).
     */
    AsyncFunction("decode") { (input: String, output: String) -> Double in
      let source = try self.privateURL(input)
      let target = try self.privateURL(output)
      let asset = AVURLAsset(url: source)
      guard let track = asset.tracks(withMediaType: .audio).first else { throw NSError(domain: "NatureAudio", code: 2) }
      let reader = try AVAssetReader(asset: asset)
      let stream = AVAssetReaderTrackOutput(track: track, outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000,
        AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false
      ])
      reader.add(stream)
      guard reader.startReading() else { throw NSError(domain: "NatureAudio", code: 3) }
      // 길이를 아직 모르므로 헤더 자리를 비워 두고 끝에서 되돌아와 채운다.
      FileManager.default.createFile(atPath: target.path, contents: Data(repeating: 0, count: 44))
      let handle = try FileHandle(forWritingTo: target)
      defer { try? handle.close() }
      try handle.seekToEnd()
      var length: UInt32 = 0
      while let sample = stream.copyNextSampleBuffer() {
        guard let buffer = CMSampleBufferGetDataBuffer(sample) else { continue }
        let count = CMBlockBufferGetDataLength(buffer)
        // 빈 버퍼에서 baseAddress 는 nil 이다. 강제 언래핑하면 그대로 크래시한다.
        if count == 0 { continue }
        var bytes = Data(count: count)
        let status = bytes.withUnsafeMutableBytes { raw -> OSStatus in
          guard let base = raw.baseAddress else { return OSStatus(-1) }
          return CMBlockBufferCopyDataBytes(buffer, atOffset: 0, dataLength: count, destination: base)
        }
        // WAV 헤더의 길이 필드는 32비트다. 230MB = 2시간 — 그 위는 애초에 통화가 아니다.
        guard status == noErr, length + UInt32(count) <= 230400000 else {
          reader.cancelReading(); throw NSError(domain: "NatureAudio", code: 4)
        }
        try handle.write(contentsOf: bytes); length += UInt32(count)
      }
      guard reader.status == .completed, length > 0 else { throw NSError(domain: "NatureAudio", code: 5) }
      var header = Data()
      func ascii(_ text: String) { header.append(text.data(using: .ascii)!) }
      func u32(_ n: UInt32) { var v = n.littleEndian; withUnsafeBytes(of: &v) { header.append(contentsOf: $0) } }
      func u16(_ n: UInt16) { var v = n.littleEndian; withUnsafeBytes(of: &v) { header.append(contentsOf: $0) } }
      ascii("RIFF"); u32(length + 36); ascii("WAVEfmt "); u32(16); u16(1); u16(1)
      u32(16000); u32(32000); u16(2); u16(16); ascii("data"); u32(length)
      try handle.seek(toOffset: 0); try handle.write(contentsOf: header)
      return Double(length) / 32000.0
    }
  }
}
