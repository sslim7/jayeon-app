package kr.redhead.nature.sms

import android.app.Activity
import android.content.Context
import expo.modules.kotlin.Promise
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class SmsJournalTest {
  private lateinit var context: Context
  @Before fun setup() {
    context = RuntimeEnvironment.getApplication()
    context.getSharedPreferences("jayeon_sms_journal_v1", Context.MODE_PRIVATE).edit().clear().commit()
  }
  private fun pending(parts: Int): JSONObject = JSONObject()
    .put("attemptId", "attempt-test").put("campaignRecipientId", "recipient-test")
    .put("phone", "01000000000").put("status", "SENDING").put("acknowledged", false)
    .put("parts", SmsJournal.emptyParts(parts)).also { SmsJournal.save(context, it) }
  private fun current() = SmsJournal.get(context, "attempt-test")!!
  @Test fun multipartRequiresAllSuccessAndIgnoresDuplicateCallback() {
    pending(2)
    SmsJournal.recordPart(context, "attempt-test", 1, Activity.RESULT_OK)
    assertEquals("SENDING", current().getString("status"))
    SmsJournal.recordPart(context, "attempt-test", 1, 1)
    SmsJournal.recordPart(context, "attempt-test", 0, Activity.RESULT_OK)
    assertEquals("SENT", current().getString("status"))
  }
  @Test fun mixedMultipartIsUnknownNotRetryableFailure() {
    pending(2)
    SmsJournal.recordPart(context, "attempt-test", 0, Activity.RESULT_OK)
    SmsJournal.recordPart(context, "attempt-test", 1, 4)
    assertEquals("UNKNOWN", current().getString("status"))
    assertEquals("PARTIAL_SEND", current().getString("errorCode"))
  }
  @Test fun allFailedPreservesAndroidError() {
    pending(2)
    SmsJournal.recordPart(context, "attempt-test", 0, 5)
    SmsJournal.recordPart(context, "attempt-test", 1, 5)
    assertEquals("FAILED", current().getString("status"))
    assertEquals("ANDROID_SMS_5", current().getString("errorCode"))
  }
  @Test fun timeoutKeepsFenceAndLateSuccessBecomesUnacknowledged() {
    val row = pending(1)
    SmsJournal.unknown(context, row, "SENT_TIMEOUT", "timeout")
    SmsJournal.delivered(SmsJournal.result(row))
    assertEquals("UNKNOWN", current().getString("status"))
    SmsJournal.recordPart(context, "attempt-test", 0, Activity.RESULT_OK)
    assertEquals("SENT", current().getString("status"))
    assertFalse(current().getBoolean("acknowledged"))
    assertFalse(SmsJournal.canAcknowledge(current())) // 이전 UNKNOWN의 저장 확인이 늦게 도착한 SENT를 숨기지 않는다
    SmsJournal.delivered(SmsJournal.result(current()))
    assertTrue(SmsJournal.canAcknowledge(current()))
  }
  @Test fun invalidAndUnknownCallbacksCannotCreateOrCompleteAnAttempt() {
    pending(1)
    SmsJournal.recordPart(context, "unknown", 0, Activity.RESULT_OK)
    SmsJournal.recordPart(context, "attempt-test", 99, Activity.RESULT_OK)
    assertNull(SmsJournal.get(context, "unknown"))
    assertEquals("SENDING", current().getString("status"))
  }

  private class TestPromise : Promise {
    var result: Any? = null
    var error: String? = null
    override fun resolve(value: Any?) { result = value }
    override fun reject(code: String?, message: String?, cause: Throwable?) { error = code }
  }
  private fun input(attempt: String = "attempt-test") = SmsSendRecord().also {
    it.attemptId = attempt
    it.campaignRecipientId = "recipient-test"
    it.phone = "01000000000"
    it.message = "test"
    it.subscriptionId = 1
  }
  @Test fun duplicateSentReturnsStoredResultWithoutPermissionOrRadioAccess() {
    pending(1)
    SmsJournal.recordPart(context, "attempt-test", 0, Activity.RESULT_OK)
    val promise = TestPromise()
    SmsDispatch.send(context, input(), promise)
    assertNull(promise.error)
    assertEquals("SENT", (promise.result as Map<*, *>)["status"])
    assertEquals(1, SmsJournal.rows(context).size)
  }
  @Test fun processInterruptedAttemptBecomesUnknownWithoutResending() {
    pending(1)
    val promise = TestPromise()
    SmsDispatch.send(context, input(), promise)
    assertNull(promise.error)
    assertEquals("UNKNOWN", (promise.result as Map<*, *>)["status"])
  }
  @Test fun newAttemptCannotBypassSentRecipientFence() {
    pending(1)
    SmsJournal.recordPart(context, "attempt-test", 0, Activity.RESULT_OK)
    val promise = TestPromise()
    SmsDispatch.send(context, input("attempt-new"), promise)
    assertEquals("SMS_SEND_BLOCKED", promise.error)
    assertNull(SmsJournal.get(context, "attempt-new"))
  }
}
