package kr.redhead.nature.sms

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import expo.modules.kotlin.Promise
import org.json.JSONObject

internal object SmsDispatch {
  private data class Active(val attemptId: String, val promise: Promise)
  private var active: Active? = null
  private val handler = Handler(Looper.getMainLooper())
  fun isActive(attemptId: String) = active?.attemptId == attemptId
  fun complete(attemptId: String, result: Map<String, Any?>) = synchronized(SmsJournal.lock) {
    if (active?.attemptId == attemptId) {
      val promise = active!!.promise
      active = null
      promise.resolve(SmsJournal.delivered(result))
    }
  }
  fun failStorage(attemptId: String) = synchronized(SmsJournal.lock) {
    if (active?.attemptId == attemptId) {
      val promise = active!!.promise
      active = null
      promise.reject("SMS_STORAGE_ERROR", "발송 결과 저장을 확인하지 못했습니다. 재발송하지 마세요.", null)
    }
  }
  private fun manager(context: Context, subscriptionId: Int): SmsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    context.getSystemService(SmsManager::class.java).createForSubscriptionId(subscriptionId)
  } else {
    @Suppress("DEPRECATION")
    SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
  }
  private fun sentIntent(context: Context, attemptId: String, part: Int): PendingIntent {
    val data = Uri.Builder().scheme("nature-sms").authority("sent").appendPath(attemptId).appendPath(part.toString()).build()
    val intent = Intent(context, SmsSentReceiver::class.java).setData(data)
    return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
  /** 분리 MMS에서 본문 성공이 journal에 저장된 뒤 이미지 MMS를 보낸다. SmsSentReceiver 경로라 JS 없이도 동작한다. */
  fun sendImagePart(context: Context, attemptId: String): Unit = synchronized(SmsJournal.lock) {
    val row = SmsJournal.get(context, attemptId) ?: return@synchronized
    val key = MmsPduProvider.key(attemptId, 1)
    // 준비된 PDU 파일만 보낸다. 만료 정리 등으로 사라졌다면 이미지는 나가지 않은 것으로 확정한다.
    if (!MmsPduProvider.file(context, key).isFile) {
      SmsJournal.recordPart(context, attemptId, 1, SmsManager.MMS_ERROR_IO_ERROR)
      return@synchronized
    }
    try {
      manager(context, row.getInt("subscriptionId")).sendMultimediaMessage(context, MmsPduProvider.uri(context, key), null, null, sentIntent(context, attemptId, 1))
    } catch (_: Exception) {
      // Binder 예외만으로 이미지 MMS가 나가지 않았다고 단정할 수 없다.
      SmsJournal.unknown(context, row, "DISPATCH_UNCERTAIN", "본문은 발송됐지만 이미지 발송 요청 결과를 확인하지 못했습니다. 재발송하지 마세요.")
      complete(attemptId, SmsJournal.result(row))
    }
  }
  fun send(context: Context, input: SmsSendRecord, promise: Promise) = synchronized(SmsJournal.lock) {
    try {
      require(input.attemptId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "Invalid attempt ID" }
      require(input.campaignRecipientId.isNotBlank() && input.phone.matches(Regex("\\+?[0-9]{8,15}")) && (input.message.isNotBlank() || input.attachments.isNotEmpty())) { "Invalid SMS input" }
      SmsJournal.get(context, input.attemptId)?.let { existing ->
        require(existing.getString("campaignRecipientId") == input.campaignRecipientId && existing.getString("phone") == input.phone) { "Attempt identity mismatch" }
        if (existing.getString("status") == "SENDING") {
          if (isActive(input.attemptId)) {
            promise.reject("SMS_BUSY", "이미 처리 중인 발송입니다.", null)
            return@synchronized
          }
          SmsJournal.unknown(context, existing, "PROCESS_INTERRUPTED", "발송 확인 중 앱이 종료되었습니다. 결과 확인이 필요합니다.")
        }
        promise.resolve(SmsJournal.delivered(SmsJournal.result(existing)))
        return@synchronized
      }
      check(active == null) { "Another SMS is in progress" }
      val previous = SmsJournal.rows(context).filter { it.getString("campaignRecipientId") == input.campaignRecipientId }
      check(previous.none { it.getString("status") != "FAILED" }) { "Recipient already sent or delivery outcome uncertain" }
      check(previous.all { it.optBoolean("acknowledged") }) { "Persist the previous result on the server before retrying" }
      check(context.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) { "SEND_SMS permission required" }
      check(context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) { "SIM selection permission required" }
      val subscriptions = context.getSystemService(SubscriptionManager::class.java).activeSubscriptionInfoList.orEmpty()
      require(subscriptions.any { it.subscriptionId == input.subscriptionId }) { "Selected SIM is not active" }
      val manager = manager(context, input.subscriptionId)
      val divided = if (input.message.isBlank()) arrayListOf<String>() else manager.divideMessage(input.message)
      val config = manager.carrierConfigValues
      val segmentLimit = config.getInt(SmsManager.MMS_CONFIG_SMS_TO_MMS_TEXT_THRESHOLD, -1)
      val lengthLimit = config.getInt(SmsManager.MMS_CONFIG_SMS_TO_MMS_TEXT_LENGTH_THRESHOLD, -1)
      val longText = divided.size > 1 || (segmentLimit > 0 && divided.size >= segmentLimit) ||
        (lengthLimit > 0 && input.message.length > lengthLimit)
      val transport = if (input.attachments.isNotEmpty()) "MMS" else if (longText) "LMS" else "SMS"
      val mms = transport != "SMS"
      // 본문+이미지는 본문 MMS(파트 0) → 이미지 MMS(파트 1) 두 통으로 순차 발송한다.
      val split = mms && MmsPdu.split(input)
      val pduUris = if (mms) {
        try { MmsPdu.prepare(input, manager).mapIndexed { part, pdu -> MmsPduProvider.write(context, MmsPduProvider.key(input.attemptId, part), pdu) } }
        catch (error: Exception) {
          // 통신사 호출 전 확정된 검증 실패. UNKNOWN으로 남겨 수신자를 불필요하게 잠그지 않는다.
          val failed = JSONObject().put("attemptId", input.attemptId).put("campaignRecipientId", input.campaignRecipientId)
            .put("phone", input.phone).put("status", "FAILED").put("acknowledged", false)
            .put("parts", SmsJournal.emptyParts(if (split) 2 else 1)).put("transport", transport)
            .put("errorCode", "MMS_PREPARATION_FAILED")
            .put("errorMessage", if (error is IllegalArgumentException) error.message else "MMS 첨부를 준비하지 못했습니다.")
          SmsJournal.save(context, failed)
          MmsPduProvider.removeAll(context, input.attemptId)
          promise.resolve(SmsJournal.delivered(SmsJournal.result(failed)))
          return@synchronized
        }
      } else emptyList()
      val partCount = if (split) 2 else if (mms) 1 else divided.size
      require(partCount > 0) { "Empty SMS" }
      val intents = ArrayList((0 until if (split) 1 else partCount).map { sentIntent(context, input.attemptId, it) })
      val row = JSONObject().put("attemptId", input.attemptId).put("campaignRecipientId", input.campaignRecipientId)
        .put("phone", input.phone).put("status", "SENDING").put("acknowledged", false)
        .put("parts", SmsJournal.emptyParts(partCount)).put("transport", transport)
      // 이미지 파트는 본문 결과 callback에서 보내므로 SIM만 기록한다. 본문·이미지는 준비된 PDU 파일에만 둔다.
      if (split) row.put("split", true).put("subscriptionId", input.subscriptionId)
      // 실제 무선 발송 전에 동기 저장이 성공해야 한다. 본문은 journal이나 로그에 남기지 않는다.
      SmsJournal.save(context, row)
      active = Active(input.attemptId, promise)
      // 분리 발송은 두 통 전체에 하나의 기한을 둔다. WebView bridge(sms-device.web.ts)가 150초 뒤 응답을 포기하므로 그보다 짧아야 한다.
      handler.postDelayed({
        synchronized(SmsJournal.lock) {
          if (isActive(input.attemptId)) {
            try {
              val current = SmsJournal.get(context, input.attemptId)!!
              SmsJournal.unknown(context, current, "SENT_TIMEOUT", "발송 확인 시간이 초과되었습니다. 중복 방지를 위해 재발송하지 않습니다.")
              complete(input.attemptId, SmsJournal.result(current))
            } catch (_: Exception) { failStorage(input.attemptId) }
          }
        }
      }, if (split) 140_000L else 120_000L)
      try {
        if (pduUris.isNotEmpty()) manager.sendMultimediaMessage(context, pduUris[0], null, null, intents[0])
        else if (divided.size == 1) manager.sendTextMessage(input.phone, null, divided[0], intents[0], null)
        else manager.sendMultipartTextMessage(input.phone, null, divided, intents, null)
      } catch (_: Exception) {
        // Binder 예외만으로 모뎀이 요청을 수락하지 않았다고 단정할 수 없다.
        SmsJournal.unknown(context, row, "DISPATCH_UNCERTAIN", "Android 발송 요청 결과를 확인하지 못했습니다. 재발송하지 마세요.")
        complete(input.attemptId, SmsJournal.result(row))
      }
    } catch (_: Exception) {
      if (isActive(input.attemptId)) failStorage(input.attemptId)
      else promise.reject("SMS_SEND_BLOCKED", "문자를 발송할 수 없습니다. 권한, SIM 또는 기존 발송 상태를 확인하세요.", null)
    }
  }
}
