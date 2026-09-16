package kr.redhead.nature.sms

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SubscriptionManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class SmsAttachmentRecord : Record {
  @Field var name: String = ""
  @Field var mimeType: String = ""
  @Field var dataBase64: String = ""
}

class SmsSendRecord : Record {
  @Field var campaignRecipientId: String = ""
  @Field var attemptId: String = ""
  @Field var phone: String = ""
  @Field var message: String = ""
  @Field var subject: String = ""
  @Field var subscriptionId: Int = -1
  @Field var attachments: List<SmsAttachmentRecord> = emptyList()
}

class NatureSmsModule : Module() {
  private fun context(): Context = requireNotNull(appContext.reactContext).applicationContext
  private fun capabilities(): Map<String, Any?> {
    val context = context()
    val supported = context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_MESSAGING)
    val smsGranted = context.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
    val phoneGranted = context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
    val subscriptions = if (phoneGranted && supported) {
      context.getSystemService(SubscriptionManager::class.java).activeSubscriptionInfoList.orEmpty().map {
        mapOf("id" to it.subscriptionId, "label" to "SIM ${it.simSlotIndex + 1} · ${it.carrierName}")
      }
    } else emptyList()
    val defaultId = SubscriptionManager.getDefaultSmsSubscriptionId()
    return mapOf(
      "supported" to supported,
      "mmsSupported" to supported,
      "lmsSupported" to supported,
      "permissionGranted" to (smsGranted && phoneGranted),
      "subscriptions" to subscriptions,
      "defaultSubscriptionId" to defaultId.takeIf { id -> subscriptions.any { it["id"] == id } }
    )
  }
  override fun definition() = ModuleDefinition {
    Name("NatureSms")
    AsyncFunction("getCapabilitiesAsync") { capabilities() }
    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.reject("SMS_PERMISSIONS_UNAVAILABLE", "권한 요청을 사용할 수 없습니다.", null)
      } else {
        permissions.askForPermissions({
          try { promise.resolve(capabilities()) }
          catch (_: Exception) { promise.reject("SMS_CAPABILITIES_ERROR", "SIM 정보를 확인하지 못했습니다.", null) }
        }, Manifest.permission.SEND_SMS, Manifest.permission.READ_PHONE_STATE)
      }
    }
    AsyncFunction("sendAsync") { input: SmsSendRecord, promise: Promise ->
      SmsDispatch.send(context(), input, promise)
    }
    AsyncFunction("getResultsAsync") {
      synchronized(SmsJournal.lock) {
        val context = context()
        SmsJournal.rows(context).mapNotNull { row ->
          if (row.getString("status") == "SENDING") {
            if (SmsDispatch.isActive(row.getString("attemptId"))) return@mapNotNull null
            SmsJournal.unknown(context, row, "PROCESS_INTERRUPTED", "발송 확인 중 앱이 종료되었습니다. 결과 확인이 필요합니다.")
          }
          if (row.optBoolean("acknowledged")) null else SmsJournal.delivered(SmsJournal.result(row))
        }
      }
    }
    AsyncFunction("acknowledgeAsync") { attemptId: String ->
      synchronized(SmsJournal.lock) {
        val context = context()
        SmsJournal.get(context, attemptId)?.let { row ->
          check(row.getString("status") != "SENDING") { "Cannot acknowledge pending SMS" }
          // UNKNOWN은 나중에 확정 SENT callback을 받을 수 있으므로 계속 조회 대상으로 유지한다.
          // UNKNOWN 저장 확인이 더 최근의 확정 callback을 숨기지 않도록 상태도 비교한다.
          if (row.getString("status") != "UNKNOWN" && SmsJournal.canAcknowledge(row)) {
            row.put("acknowledged", true)
            SmsJournal.save(context, row)
          }
        }
      }
      Unit
    }
  }
}
