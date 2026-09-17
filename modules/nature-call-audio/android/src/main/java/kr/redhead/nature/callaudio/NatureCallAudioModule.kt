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

class NatureCallAudioModule : Module() {
  // dataDir 는 기기에 따라 /data/user/0 심링크다. 한쪽만 canonical 로 풀면 항상 불일치해 모델 설치·변환이 막힌다.
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
    // 추론 스레드 수를 정하려면 코어 수가 필요하다. JS 에는 이 값을 주는 API 가 없다.
    Function("cpuCount") { Runtime.getRuntime().availableProcessors() }
    // Android 는 allowBackup=false 로 이미 백업 대상이 아니다. iOS 와 같은 인터페이스만 맞춘다.
    AsyncFunction("excludeFromBackup") { uri: String -> privateFile(uri); Unit }
    AsyncFunction("sha256") { uri: String ->
      val digest = MessageDigest.getInstance("SHA-256")
      privateFile(uri).inputStream().use { stream ->
        val bytes = ByteArray(1024 * 1024)
        while (true) { val n = stream.read(bytes); if (n < 0) break; digest.update(bytes, 0, n) }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }
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
          wav.setLength(0); wav.write(ByteArray(44))
          val out = ByteBuffer.allocate(64 * 1024).order(ByteOrder.LITTLE_ENDIAN)
          fun emit(value: Double) {
            if (out.remaining() < 2) { wav.write(out.array(), 0, out.position()); out.clear() }
            out.putShort(value.toInt().coerceIn(-32768, 32767).toShort()); samples++
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
