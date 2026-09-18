package kr.redhead.nature.callaudio

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/**
 * 통화 오디오 네이티브 — **백업 제외 + 16kHz 변환 + 스트리밍 해시.**
 *
 * `decode`/`sha256`/`cpuCount` 는 분석이 서버로 옮겨간 뒤 한 번 걷혔다가, **폰에서 받아쓰기를
 * 다시 재려고**(→ `docs/on-device-asr.md`) 되살린 것이다. 셋 다 whisper 를 돌리는 데 반드시
 * 필요하고, JS 에는 대체할 수단이 없다:
 *
 * - `decode` : 🔴 **whisper 는 16kHz 모노 PCM 만 먹는다.** 통화 녹음은 m4a(AAC, 48kHz)다.
 *   JS 에는 오디오 디코더가 없고, 네이티브 껍데기의 웹뷰에도 파일을 디코드해 줄 API 가 없다.
 * - `sha256` : 547MB 모델을 받고 나서 **한 번** 확인한다. 부분 다운로드된 파일을 「있다」고
 *   믿으면 whisper 는 기동에 실패하는데, 그 실패 메시지에는 원인이 드러나지 않는다.
 * - `cpuCount` : 추론 스레드 수를 정하는 유일한 근거다(→ `src/lib/asr-threads.ts`).
 *
 * 백업 제외는 여전히 필요하다: 옛 기기 분석이 만든 통화 원문·분석이 아직 로컬 SQLite 에 남아
 * 있고(→ `src/lib/call-runtime.ts`), iOS 에서 그것이 iCloud 백업에 올라가면 통화 내용이
 * 사용자의 백업에 그대로 복사된다. 🔴 **안드로이드에서는 `allowBackup=false` 라 no-op 이다.**
 * 그래도 함수를 두는 이유는 iOS 와 같은 인터페이스를 유지하기 위해서다 — 한쪽에만 있으면
 * JS 가 플랫폼 분기를 들고 다녀야 하고, 그 분기는 언젠가 한쪽만 고쳐진다.
 */
class NatureCallAudioModule : Module() {
  // dataDir 는 기기에 따라 /data/user/0 심링크다. 한쪽만 canonical 로 풀면 항상 불일치해
  // 모델 설치와 오디오 변환이 통째로 막힌다.
  private fun allowedRoots(): List<String> {
    val context = requireNotNull(appContext.reactContext)
    return listOf(File(context.applicationInfo.dataDir), context.filesDir, context.noBackupFilesDir, context.cacheDir)
      .mapNotNull { runCatching { it.canonicalPath }.getOrNull() }
  }

  /**
   * 앱 전용 저장소 안의 파일만 통과시킨다.
   *
   * ⚠️ **그래서 `/sdcard/Download/...` 를 직접 넘기면 거부된다.** 받아쓰기 시험 화면이 파일을
   * 고를 때 문서 선택기의 「캐시로 복사」를 켜 두는 이유가 이것이다(→ `src/lib/asr-audio.ts`).
   * 공유 저장소를 열어 주면 이 모듈이 임의 경로를 읽고 쓰는 통로가 된다.
   */
  private fun privateFile(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file")
    val file = File(requireNotNull(parsed.path)).canonicalFile
    require(allowedRoots().any { file.path == it || file.path.startsWith("$it/") })
    return file
  }

  override fun definition() = ModuleDefinition {
    Name("NatureCallAudio")

    // 추론 스레드 수를 정하려면 코어 수가 필요하다. JS 에는 이 값을 주는 API 가 없다.
    Function("cpuCount") { Runtime.getRuntime().availableProcessors() }

    // 경로가 우리 앱 안인지만 확인하고 끝낸다. 확인마저 빼면 인터페이스가 거짓말이 된다.
    AsyncFunction("excludeFromBackup") { uri: String -> privateFile(uri); Unit }

    // 🔴 파일을 통째로 메모리에 올리지 않는다. 874MB 모델을 ByteArray 로 읽으면 그 자리에서 OOM 이다.
    AsyncFunction("sha256") { uri: String ->
      val digest = MessageDigest.getInstance("SHA-256")
      privateFile(uri).inputStream().use { stream ->
        val bytes = ByteArray(1024 * 1024)
        while (true) { val n = stream.read(bytes); if (n < 0) break; digest.update(bytes, 0, n) }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * m4a(또는 기기가 디코드할 수 있는 무엇이든) → **16kHz 모노 16bit WAV.** 초 단위 길이를 돌려준다.
     *
     * 🔴 **이 변환은 생략할 수 없다.** whisper.cpp 는 16kHz 모노만 받고, 다른 값을 주면 소리가
     * 느리거나 빨라진 것으로 들려 **전사가 조용히 엉망이 된다** — 실패가 아니라 그럴듯한
     * 헛소리가 나오므로 알아채기 가장 어려운 고장이다.
     *
     * 리샘플링은 선형 보간이다. 48kHz→16kHz 는 정확히 3:1 이라 보간이 거의 개입하지 않고,
     * whisper 가 어차피 mel 스펙트로그램으로 뭉개므로 고급 필터가 값을 더하지 않는다.
     *
     * ⚠️ 디코더가 float PCM(`ENCODING_PCM_FLOAT`, 4)을 내는 기기가 있다. 16bit 로 가정하고
     * 읽으면 바이트 정렬이 어긋나 **백색소음**이 나온다. 그래서 출력 포맷이 바뀔 때마다
     * 인코딩을 다시 읽는다.
     */
    AsyncFunction("decode") { input: String, output: String ->
      val extractor = MediaExtractor()
      var codec: MediaCodec? = null
      try {
        extractor.setDataSource(privateFile(input).path)
        val track = (0 until extractor.trackCount).firstOrNull {
          extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: error("Unsupported audio")
        extractor.selectTrack(track)
        val format = extractor.getTrackFormat(track)
        val decoder = MediaCodec.createDecoderByType(requireNotNull(format.getString(MediaFormat.KEY_MIME)))
        codec = decoder
        decoder.configure(format, null, null, 0); decoder.start()
        var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var encoding = 2 // PCM signed 16-bit
        var inputDone = false
        var outputDone = false
        var sourceIndex = 0L
        var nextOutput = 0.0
        var previous = 0.0
        var samples = 0L
        val info = MediaCodec.BufferInfo()
        RandomAccessFile(privateFile(output), "rw").use { wav ->
          // 길이를 아직 모르므로 헤더 자리를 비워 두고 끝에서 되돌아와 채운다.
          wav.setLength(0); wav.write(ByteArray(44))
          val out = ByteBuffer.allocate(64 * 1024).order(ByteOrder.LITTLE_ENDIAN)
          fun emit(value: Double) {
            if (out.remaining() < 2) { wav.write(out.array(), 0, out.position()); out.clear() }
            out.putShort(value.toInt().coerceIn(-32768, 32767).toShort()); samples++
            // WAV 헤더의 길이 필드는 32비트다. 2시간이면 230MB — 그 위는 애초에 통화가 아니다.
            require(samples <= 16000L * 7200) { "Recording too long" }
          }
          var idle = 0
          while (!outputDone) {
            if (!inputDone) {
              val index = decoder.dequeueInputBuffer(10000)
              if (index >= 0) {
                val buffer = requireNotNull(decoder.getInputBuffer(index))
                val count = extractor.readSampleData(buffer, 0)
                if (count < 0) { decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                else { decoder.queueInputBuffer(index, 0, count, extractor.sampleTime, 0); extractor.advance() }
              }
            }
            val index = decoder.dequeueOutputBuffer(info, 10000)
            when {
              index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                val f = decoder.outputFormat
                rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                encoding = if (f.containsKey(MediaFormat.KEY_PCM_ENCODING)) f.getInteger(MediaFormat.KEY_PCM_ENCODING) else 2
                require(encoding == 2 || encoding == 4)
              }
              index >= 0 -> {
                idle = 0
                val buffer = requireNotNull(decoder.getOutputBuffer(index)).order(ByteOrder.LITTLE_ENDIAN)
                buffer.position(info.offset); buffer.limit(info.offset + info.size)
                val stride = channels * if (encoding == 4) 4 else 2
                while (buffer.remaining() >= stride) {
                  var mono = 0.0
                  repeat(channels) { mono += if (encoding == 4) buffer.float.toDouble() * 32767 else buffer.short.toDouble() }
                  mono /= channels
                  if (sourceIndex == 0L) previous = mono
                  while (nextOutput <= sourceIndex) {
                    val fraction = (nextOutput - (sourceIndex - 1)).coerceIn(0.0, 1.0)
                    emit(previous + (mono - previous) * fraction); nextOutput += rate.toDouble() / 16000
                  }
                  previous = mono; sourceIndex++
                }
                outputDone = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                decoder.releaseOutputBuffer(index, false)
              }
              // 디코더가 입력도 출력도 받지 않는 상태로 굳는 기기가 있다. 여기서 끊지 않으면
              // 무한 루프가 되어 「변환 중」에서 영원히 멈춘 것처럼 보인다.
              else -> { idle++; require(idle < 3000) { "Decoder stalled" } }
            }
          }
          wav.write(out.array(), 0, out.position())
          require(samples > 0)
          val length = (samples * 2).toInt()
          val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
          header.put("RIFF".toByteArray()).putInt(length + 36).put("WAVEfmt ".toByteArray()).putInt(16)
          header.putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16)
          header.put("data".toByteArray()).putInt(length)
          wav.seek(0); wav.write(header.array())
        }
        samples.toDouble() / 16000
      } finally {
        try { codec?.stop() } catch (_: Exception) {}
        codec?.release(); extractor.release()
      }
    }
  }
}
