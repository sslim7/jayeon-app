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

  @Test fun imageOnlySendPreparesMmsAndWaitsForSentCallback() {
    val bytes = ByteArrayOutputStream().also {
      Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it)
    }.toByteArray()
    val request = input().apply {
      attachments = listOf(SmsAttachmentRecord().apply {
        name = "명함.png"; mimeType = "image/png"; dataBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
      })
    }
    val result = Result()
    SmsDispatch.send(context, request, result)
    assertNull(result.code)
    assertNull("API 반환만으로 SENT 처리하지 않는다", result.value)
    assertNotNull("Robolectric shadow에만 MMS 요청한다", shadow().lastSentMultimediaMessageParams)
    assertNull(shadow().lastSentTextMessageParams)
    val row = SmsJournal.get(context, request.attemptId)!!
    assertEquals("SENDING", row.getString("status")); assertEquals("MMS", row.getString("transport"))
    assertTrue(MmsPduProvider.file(context, request.attemptId).length() > bytes.size)
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
