package kr.redhead.nature.sms

import android.Manifest
import android.app.Activity
import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import android.os.Bundle
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import android.util.Base64
import expo.modules.kotlin.Promise
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowSmsManager
import org.robolectric.shadows.ShadowSubscriptionManager.SubscriptionInfoBuilder
import java.io.ByteArrayOutputStream

@Implements(SmsManager::class)
class MmsTestSmsManager : ShadowSmsManager() {
  @Implementation fun getCarrierConfigValues() = Bundle().apply {
    putBoolean(SmsManager.MMS_CONFIG_MMS_ENABLED, true)
    putInt(SmsManager.MMS_CONFIG_MAX_MESSAGE_SIZE, 300 * 1024)
  }
}

@GraphicsMode(GraphicsMode.Mode.NATIVE)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE, shadows = [MmsTestSmsManager::class])
class SmsDispatchMmsTest {
  private lateinit var context: Context
  @Before fun setup() {
    context = RuntimeEnvironment.getApplication()
    context.getSharedPreferences("jayeon_sms_journal_v1", Context.MODE_PRIVATE).edit().clear().commit()
    shadowOf(context as Application).grantPermissions(Manifest.permission.SEND_SMS, Manifest.permission.READ_PHONE_STATE)
    shadowOf(context.getSystemService(SubscriptionManager::class.java)).setActiveSubscriptionInfos(
      SubscriptionInfoBuilder.newBuilder().setId(1).setSimSlotIndex(0).buildSubscriptionInfo()
    )
  }
  private class Result : Promise {
    var value: Any? = null
    var code: String? = null
    override fun resolve(value: Any?) { this.value = value }
    override fun reject(code: String?, message: String?, cause: Throwable?) { this.code = code }
  }
  private fun input() = SmsSendRecord().apply {
    attemptId = "image-only-test"; campaignRecipientId = "image-only-recipient"
    phone = "01000000000"; message = ""; subscriptionId = 1
  }
  private fun shadow() = shadowOf(context.getSystemService(SmsManager::class.java).createForSubscriptionId(1))
  private fun png() = ByteArrayOutputStream().also {
    Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it)
  }.toByteArray()
  private fun attachment(bytes: ByteArray) = SmsAttachmentRecord().apply {
    name = "명함.png"; mimeType = "image/png"; dataBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
  }
  private fun splitInput(id: String) = SmsSendRecord().apply {
    attemptId = id; campaignRecipientId = "$id-recipient"; phone = "01000000000"
    message = "안녕하세요 본문입니다"; subject = "캠페인 제목"; subscriptionId = 1; attachments = listOf(attachment(png()))
  }
  private data class ParsedPdu(val subject: String?, val types: List<String>, val data: List<ByteArray>)
  /** 테스트 전용 Android reference parser로 준비된 PDU 파일을 읽는다. */
  private fun parsePdu(key: String): ParsedPdu {
    val parserClass = Class.forName("com.google.android.mms.pdu.PduParser")
    val parser = parserClass.getConstructor(ByteArray::class.java, Boolean::class.javaPrimitiveType).newInstance(MmsPduProvider.file(context, key).readBytes(), true)
    val parsed = parserClass.getMethod("parse").invoke(parser)
    assertEquals("com.google.android.mms.pdu.SendReq", parsed.javaClass.name)
    val subject = parsed.javaClass.getMethod("getSubject").invoke(parsed)?.let { it.javaClass.getMethod("getString").invoke(it) as String }
    val body = parsed.javaClass.getMethod("getBody").invoke(parsed)
    val parts = (0 until body.javaClass.getMethod("getPartsNum").invoke(body) as Int).map { body.javaClass.getMethod("getPart", Int::class.javaPrimitiveType).invoke(body, it) }
    return ParsedPdu(subject, parts.map { String(it.javaClass.getMethod("getContentType").invoke(it) as ByteArray) }, parts.map { it.javaClass.getMethod("getData").invoke(it) as ByteArray })
  }
  private fun lastMmsKey() = shadow().lastSentMultimediaMessageParams?.contentUri?.lastPathSegment
  private fun status(id: String) = SmsJournal.get(context, id)!!.getString("status")
  private fun filesGone(id: String) = !MmsPduProvider.file(context, id).exists() && !MmsPduProvider.file(context, "$id.1").exists()

  /** 본문+이미지를 보내고 본문 MMS만 요청됐는지 확인한다. */
  private fun startSplit(id: String, result: Result) {
    SmsDispatch.send(context, splitInput(id), result)
    assertNull(result.code); assertNull(result.value)
    assertEquals("첫 요청은 본문 PDU", id, lastMmsKey())
    assertNull(shadow().lastSentTextMessageParams)
    val row = SmsJournal.get(context, id)!!
    assertEquals("SENDING", row.getString("status")); assertEquals("MMS", row.getString("transport"))
    assertEquals(2, row.getJSONArray("parts").length()); assertTrue(row.getBoolean("split")); assertEquals(1, row.getInt("subscriptionId"))
    assertFalse("본문·이미지는 journal에 저장하지 않는다", row.toString().contains("안녕하세요") || row.toString().contains(splitInput(id).attachments[0].dataBase64))
    val body = parsePdu(id)
    assertEquals("본문에도 제목을 넣는다 — 비우면 통신사가 「제목없음」을 채운다", "캠페인 제목", body.subject)
    assertEquals(listOf("application/smil", "text/plain"), body.types)
    assertEquals("안녕하세요 본문입니다", body.data[1].toString(Charsets.UTF_8))
    assertTrue("두 PDU 모두 첫 발송 전에 준비한다", MmsPduProvider.file(context, "$id.1").isFile)
    shadow().clearLastSentMultimediaMessageParams()
  }

  @Test fun splitSendsImageMmsOnlyAfterBodySuccessThenSent() {
    val result = Result()
    startSplit("split-ok", result)
    SmsJournal.recordPart(context, "split-ok", 1, Activity.RESULT_OK) // 본문 결과 전 파트 1 결과는 무시
    assertTrue(SmsJournal.get(context, "split-ok")!!.getJSONArray("parts").isNull(1))
    assertNull(lastMmsKey())
    SmsJournal.recordPart(context, "split-ok", 0, Activity.RESULT_OK)
    assertEquals("두 번째 요청은 이미지 PDU", "split-ok.1", lastMmsKey())
    assertNull(result.value); assertEquals("SENDING", status("split-ok"))
    val image = parsePdu("split-ok.1")
    assertEquals("제목은 이미지 MMS에 붙는다", "캠페인 제목", image.subject)
    assertEquals(listOf("application/smil", "image/png"), image.types)
    assertFalse(image.data[0].toString(Charsets.UTF_8).contains("text.txt"))
    assertArrayEquals(png(), image.data[1])
    shadow().clearLastSentMultimediaMessageParams()
    SmsJournal.recordPart(context, "split-ok", 0, Activity.RESULT_OK) // 중복 callback으로 이미지를 다시 보내지 않는다
    assertNull(lastMmsKey())
    SmsJournal.recordPart(context, "split-ok", 1, Activity.RESULT_OK)
    assertEquals("SENT", (result.value as Map<*, *>)["status"]); assertEquals("MMS", (result.value as Map<*, *>)["transport"])
    assertTrue(filesGone("split-ok"))
  }
  @Test fun splitBodyFailureSendsNothingMoreAndStaysRetryable() {
    val result = Result()
    startSplit("split-body-fail", result)
    SmsJournal.recordPart(context, "split-body-fail", 0, 4)
    assertNull(lastMmsKey())
    val value = result.value as Map<*, *>
    assertEquals("FAILED", value["status"]); assertEquals("ANDROID_MMS_4", value["errorCode"])
    assertTrue(filesGone("split-body-fail"))
    SmsJournal.recordPart(context, "split-body-fail", 1, Activity.RESULT_OK)
    assertEquals("FAILED", status("split-body-fail"))
  }
  @Test fun splitImageFailureAfterBodySuccessIsPartialUnknown() {
    val result = Result()
    startSplit("split-image-fail", result)
    SmsJournal.recordPart(context, "split-image-fail", 0, Activity.RESULT_OK)
    assertEquals("split-image-fail.1", lastMmsKey())
    SmsJournal.recordPart(context, "split-image-fail", 1, 4)
    val value = result.value as Map<*, *>
    assertEquals("UNKNOWN", value["status"]); assertEquals("PARTIAL_SEND", value["errorCode"])
    assertTrue((value["errorMessage"] as String).contains("이미지"))
    assertTrue(filesGone("split-image-fail"))
  }
  @Test fun splitMissingImagePduAfterBodySuccessIsPartialWithoutRadioRequest() {
    val result = Result()
    startSplit("split-missing", result)
    MmsPduProvider.remove(context, "split-missing.1")
    SmsJournal.recordPart(context, "split-missing", 0, Activity.RESULT_OK)
    assertNull(lastMmsKey())
    assertEquals("PARTIAL_SEND", (result.value as Map<*, *>)["errorCode"])
    assertTrue(filesGone("split-missing"))
  }
  @Test fun splitPreparationFailureSendsNothing() {
    val request = splitInput("split-prep-fail").apply { attachments = listOf(SmsAttachmentRecord().apply { mimeType = "image/png"; dataBase64 = "YWJj" }) }
    val result = Result()
    SmsDispatch.send(context, request, result)
    assertEquals("FAILED", (result.value as Map<*, *>)["status"]); assertEquals("MMS_PREPARATION_FAILED", (result.value as Map<*, *>)["errorCode"])
    assertNull(lastMmsKey()); assertNull(shadow().lastSentTextMessageParams)
    assertTrue(filesGone("split-prep-fail"))
  }

  @Test fun imageOnlySendPreparesMmsAndWaitsForSentCallback() {
    val bytes = png()
    val request = input().apply { attachments = listOf(attachment(bytes)) }
    val result = Result()
    SmsDispatch.send(context, request, result)
    assertNull(result.code)
    assertNull("API 반환만으로 SENT 처리하지 않는다", result.value)
    assertNotNull("Robolectric shadow에만 MMS 요청한다", shadow().lastSentMultimediaMessageParams)
    assertNull(shadow().lastSentTextMessageParams)
    val row = SmsJournal.get(context, request.attemptId)!!
    assertEquals("SENDING", row.getString("status")); assertEquals("MMS", row.getString("transport"))
    assertTrue(MmsPduProvider.file(context, request.attemptId).length() > bytes.size)
    assertFalse("이미지만 발송은 분리하지 않는다", MmsPduProvider.file(context, "${request.attemptId}.1").exists())
    assertEquals(1, row.getJSONArray("parts").length())
    assertEquals("본문이 없으면 text 파트를 넣지 않는다", listOf("application/smil", "image/png"), parsePdu(request.attemptId).types)
    SmsJournal.recordPart(context, request.attemptId, 0, Activity.RESULT_OK)
    assertEquals("SENT", (result.value as Map<*, *>)["status"])
    assertFalse(MmsPduProvider.file(context, request.attemptId).exists())
  }
  @Test fun malformedImageOnlyInputIsSavedAsFailedWithoutRadioRequest() {
    val request = input().apply {
      attachments = listOf(SmsAttachmentRecord().apply { mimeType = "image/png"; dataBase64 = "YWJj" })
    }
    val result = Result()
    SmsDispatch.send(context, request, result)
    assertNull(result.code)
    assertEquals("FAILED", (result.value as Map<*, *>)["status"])
    assertEquals("MMS_PREPARATION_FAILED", (result.value as Map<*, *>)["errorCode"])
    assertNull(shadow().lastSentMultimediaMessageParams)
    assertNull(shadow().lastSentTextMessageParams)
    assertEquals("FAILED", SmsJournal.get(context, request.attemptId)!!.getString("status"))
  }
}
