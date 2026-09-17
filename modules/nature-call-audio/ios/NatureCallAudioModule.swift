import ExpoModulesCore
import AVFoundation
import CryptoKit

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
    // 통화 원본 사본·WAV·모델 파일은 iCloud 백업 대상에서 뺀다.
    AsyncFunction("excludeFromBackup") { (uri: String) in
      var url = try self.privateURL(uri)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
    }
    AsyncFunction("sha256") { (uri: String) -> String in
      let handle = try FileHandle(forReadingFrom: self.privateURL(uri))
      defer { try? handle.close() }
      var hash = SHA256()
      while let bytes = try handle.read(upToCount: 1024 * 1024), !bytes.isEmpty { hash.update(data: bytes) }
      return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
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
