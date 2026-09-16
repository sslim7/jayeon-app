package kr.redhead.nature.sms

import android.app.Activity
import android.content.Context
import android.net.Uri
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream
import java.io.FileNotFoundException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class MmsPduTest {
  private lateinit var context: Context
  @Before fun setup() {
    context = RuntimeEnvironment.getApplication()
    context.getSharedPreferences("jayeon_sms_journal_v1", Context.MODE_PRIVATE).edit().clear().commit()
  }
  private fun uint(stream: ByteArrayInputStream): Int {
    var value = 0
    do { val b = stream.read(); check(b >= 0); value = (value shl 7) or (b and 127) } while (b and 128 != 0)
    return value
  }
  private fun value(stream: ByteArrayInputStream): ByteArray {
    val first = stream.read()
    val size = if (first == 31) uint(stream) else first
    return ByteArray(size).also { assertEquals(size, stream.read(it)) }
  }
  private fun text(stream: ByteArrayInputStream): String {
    val bytes = ArrayList<Byte>()
    while (true) { val b = stream.read(); check(b >= 0); if (b == 0) break; bytes.add(b.toByte()) }
    return bytes.toByteArray().toString(Charsets.UTF_8)
  }
  private fun parseParts(pdu: ByteArray): List<Pair<ByteArray, ByteArray>> {
    val stream = ByteArrayInputStream(pdu)
    assertEquals(0x8c, stream.read()); assertEquals(0x80, stream.read())
    assertEquals(0x98, stream.read()); assertEquals("attempt-mms", text(stream))
    assertEquals(0x8d, stream.read()); assertEquals(0x92, stream.read())
    assertEquals(0x89, stream.read()); assertArrayEquals(byteArrayOf(0x81.toByte()), value(stream))
    assertEquals(0x97, stream.read())
    val address = ByteArrayInputStream(value(stream))
    assertEquals(0xea, address.read()); assertEquals("01000000000/TYPE=PLMN", text(address))
    assertEquals(0x8a, stream.read()); assertEquals(0x80, stream.read())
    assertEquals(0x86, stream.read()); assertEquals(0x81, stream.read())
    assertEquals(0x90, stream.read()); assertEquals(0x81, stream.read())
    assertEquals(0x84, stream.read())
    val content = ByteArrayInputStream(value(stream))
    assertEquals(0xb3, content.read()); assertEquals(0x8a, content.read()); assertEquals("<smil.xml>", text(content))
    assertEquals(0x89, content.read()); assertEquals("application/smil", text(content))
    val count = uint(stream)
    return (0 until count).map {
      val h = uint(stream); val d = uint(stream)
      val header = ByteArray(h); assertEquals(h, stream.read(header))
      val data = ByteArray(d); assertEquals(d, stream.read(data))
      header to data
    }.also { assertEquals(0, stream.available()) }
  }
  @Test fun imageMmsPreservesUtf8BodyBinaryAttachmentsAndRelatedParts() {
    val image = ByteArray(16384) { (it % 251).toByte() }
    val parts = parseParts(MmsPdu.encode("01000000000", "안녕하세요\n명함입니다.", "attempt-mms", listOf(MmsPdu.Image("image/png", image))))
    assertEquals(3, parts.size)
    assertTrue(parts[0].second.toString(Charsets.UTF_8).contains("src=\"image1.png\""))
    assertTrue(parts[0].second.toString(Charsets.UTF_8).contains("src=\"text.txt\""))
    assertEquals("안녕하세요\n명함입니다.", parts[1].second.toString(Charsets.UTF_8))
    assertArrayEquals(image, parts[2].second)
    assertTrue(parts[2].first.toString(Charsets.ISO_8859_1).contains("image/png"))
  }
  @Test fun textOnlyLmsContainsSmilAndLongTextWithoutFakeImage() {
    val message = "긴 안내문입니다. ".repeat(200)
    val parts = parseParts(MmsPdu.encode("01000000000", message, "attempt-mms", emptyList()))
    assertEquals(2, parts.size)
    assertFalse(parts[0].second.toString(Charsets.UTF_8).contains("<img"))
    assertEquals(message, parts[1].second.toString(Charsets.UTF_8))
  }
  @Test fun androidReferenceParserAcceptsImageMmsAndTextLms() {
    // 테스트 전용 Android reference parser. 프로덕션은 숨겨진 API에 의존하지 않는다.
    val parserClass = Class.forName("com.google.android.mms.pdu.PduParser")
    val constructor = parserClass.getConstructor(ByteArray::class.java, Boolean::class.javaPrimitiveType)
    listOf(emptyList(), listOf(MmsPdu.Image("image/png", byteArrayOf(1, 2, 3)))).forEach { images ->
      val raw = MmsPdu.encode("01000000000", "한글 본문", "attempt-mms", images)
      val parser = constructor.newInstance(raw, true)
      val parsed = parserClass.getMethod("parse").invoke(parser)
      assertNotNull("Android reference parser must accept M-Send.req", parsed)
      assertEquals("com.google.android.mms.pdu.SendReq", parsed.javaClass.name)
      val body = parsed.javaClass.getMethod("getBody").invoke(parsed)
      assertEquals(2 + images.size, body.javaClass.getMethod("getPartsNum").invoke(body))
      val textPart = body.javaClass.getMethod("getPart", Int::class.javaPrimitiveType).invoke(body, 1)
      assertEquals("한글 본문", (textPart.javaClass.getMethod("getData").invoke(textPart) as ByteArray).toString(Charsets.UTF_8))
      assertEquals(106, textPart.javaClass.getMethod("getCharset").invoke(textPart))
    }
  }
  @Test fun rejectsUnsupportedAndOversizedAttachmentsBeforeDecoding() {
    val pdf = SmsAttachmentRecord().apply { mimeType = "application/pdf"; dataBase64 = "YWJj" }
    assertThrows(IllegalArgumentException::class.java) { MmsPdu.decode(listOf(pdf)) }
    val huge = SmsAttachmentRecord().apply { mimeType = "image/png"; dataBase64 = "a".repeat(500000) }
    assertThrows(IllegalArgumentException::class.java) { MmsPdu.decode(listOf(huge)) }
    val fake = SmsAttachmentRecord().apply { mimeType = "image/png"; dataBase64 = "YWJj" }
    assertThrows(IllegalArgumentException::class.java) { MmsPdu.decode(listOf(fake)) }
    assertThrows(IllegalArgumentException::class.java) { MmsPdu.decode(List(4) { fake }) }
  }
  @Test fun pduFilesArePrivateOutsideBackupAndTraversalIsRejected() {
    val uri = MmsPduProvider.write(context, "attempt-mms", byteArrayOf(1, 2, 3))
    assertEquals("${context.packageName}.nature.mms", uri.authority)
    assertTrue(MmsPduProvider.file(context, "attempt-mms").canonicalPath.startsWith(context.noBackupFilesDir.canonicalPath))
    assertThrows(FileNotFoundException::class.java) { MmsPduProvider.file(context, "../secret") }
    assertThrows(FileNotFoundException::class.java) { MmsPduProvider().openFile(Uri.parse("content://bad/path"), "w") }
    MmsPduProvider.remove(context, "attempt-mms")
    assertFalse(MmsPduProvider.file(context, "attempt-mms").exists())
  }
  @Test fun mmsCallbackPersistsDistinctErrorAndRemovesPdu() {
    MmsPduProvider.write(context, "attempt-mms", byteArrayOf(1))
    val row = JSONObject().put("attemptId", "attempt-mms").put("campaignRecipientId", "recipient-mms")
      .put("phone", "01000000000").put("transport", "MMS").put("status", "SENDING").put("parts", SmsJournal.emptyParts(1))
    SmsJournal.save(context, row)
    SmsJournal.recordPart(context, "attempt-mms", 0, 2)
    val saved = SmsJournal.get(context, "attempt-mms")!!
    assertEquals("FAILED", saved.getString("status")); assertEquals("ANDROID_MMS_2", saved.getString("errorCode"))
    assertTrue(saved.getString("errorMessage").contains("APN"))
    assertFalse(MmsPduProvider.file(context, "attempt-mms").exists())
  }
  @Test fun lmsLateSuccessPreservesTransportAndRemovesPdu() {
    MmsPduProvider.write(context, "attempt-mms", byteArrayOf(1))
    val row = JSONObject().put("attemptId", "attempt-mms").put("campaignRecipientId", "recipient-mms")
      .put("phone", "01000000000").put("transport", "LMS").put("status", "SENDING").put("parts", SmsJournal.emptyParts(1))
    SmsJournal.save(context, row)
    SmsJournal.unknown(context, row, "SENT_TIMEOUT", "timeout")
    SmsJournal.recordPart(context, "attempt-mms", 0, Activity.RESULT_OK)
    val result = SmsJournal.result(SmsJournal.get(context, "attempt-mms")!!)
    assertEquals("SENT", result["status"]); assertEquals("LMS", result["transport"])
    assertFalse(MmsPduProvider.file(context, "attempt-mms").exists())
  }
}
