package kr.redhead.nature.sms

import android.app.Activity
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** 실제 발송 전에 영구 저장하는 중복 방지 기록. 서버 저장 확인 후에도 삭제하지 않는다. */
internal object SmsJournal {
  val lock = Any()
  private val deliveredStatuses = mutableMapOf<String, String>()
  fun delivered(result: Map<String, Any?>): Map<String, Any?> {
    deliveredStatuses[result["attemptId"] as String] = result["status"] as String
    return result
  }
  fun canAcknowledge(row: JSONObject) = deliveredStatuses[row.getString("attemptId")] == row.getString("status")
  // Nature 전환 시에도 기존 단말 발송 결과와 중복 방지 기록을 유지한다.
  private fun prefs(context: Context) = context.getSharedPreferences("jayeon_sms_journal_v1", Context.MODE_PRIVATE)
  fun rows(context: Context): List<JSONObject> = prefs(context).all.values.mapNotNull {
    (it as? String)?.let { value -> JSONObject(value) }
  }
  fun get(context: Context, attemptId: String): JSONObject? =
    prefs(context).getString(attemptId, null)?.let { JSONObject(it) }
  fun save(context: Context, row: JSONObject) {
    check(prefs(context).edit().putString(row.getString("attemptId"), row.toString()).commit()) {
      "SMS result storage unavailable"
    }
  }
  fun result(row: JSONObject): Map<String, Any?> = mapOf(
    "campaignRecipientId" to row.getString("campaignRecipientId"),
    "attemptId" to row.getString("attemptId"), "phone" to row.getString("phone"),
    "transport" to row.optString("transport", "SMS"),
    "status" to row.getString("status"), "success" to (row.getString("status") == "SENT"),
    "errorCode" to row.optString("errorCode").ifEmpty { null },
    "errorMessage" to row.optString("errorMessage").ifEmpty { null }
  )
  fun unknown(context: Context, row: JSONObject, code: String, message: String) {
    row.put("status", "UNKNOWN").put("errorCode", code).put("errorMessage", message).put("acknowledged", false)
    save(context, row)
  }
  fun recordPart(context: Context, attemptId: String, part: Int, code: Int) = synchronized(lock) {
    val row = get(context, attemptId) ?: return@synchronized
    val parts = row.getJSONArray("parts")
    if (part !in 0 until parts.length() || !parts.isNull(part)) return@synchronized
    parts.put(part, code)
    val codes = (0 until parts.length()).mapNotNull { if (parts.isNull(it)) null else parts.getInt(it) }
    if (codes.size == parts.length()) {
      val successful = codes.count { it == Activity.RESULT_OK }
      val status = when {
        successful == codes.size -> "SENT"
        successful == 0 -> "FAILED"
        else -> "UNKNOWN"
      }
      row.put("status", status).put("acknowledged", false)
      if (status == "SENT") {
        row.remove("errorCode"); row.remove("errorMessage")
      } else {
        val error = codes.first { it != Activity.RESULT_OK }
        row.put("errorCode", if (status == "UNKNOWN") "PARTIAL_SEND" else "ANDROID_${if (row.optString("transport") in setOf("MMS", "LMS")) "MMS" else "SMS"}_$error")
          .put("errorMessage", if (status == "UNKNOWN") "일부 문자 조각만 발송되었습니다. 중복 방지를 위해 자동 재발송하지 않습니다." else if (row.optString("transport") in setOf("MMS", "LMS")) mmsError(error) else smsError(error))
      }
    }
    save(context, row)
    if (row.getString("status") in setOf("SENT", "FAILED") && row.optString("transport") in setOf("MMS", "LMS")) {
      // 결과 저장이 끝난 다음 임시 본문·이미지와 URI 권한을 제거한다.
      try { MmsPduProvider.remove(context, attemptId) } catch (_: Exception) { /* 다음 준비에서 만료 정리 */ }
    }
    if (row.getString("status") != "SENDING") SmsDispatch.complete(attemptId, result(row))
  }
  private fun mmsError(code: Int) = when (code) {
    1 -> "MMS 발송에 실패했습니다."
    2 -> "MMS APN 설정이 올바르지 않습니다."
    3 -> "MMS 데이터 연결을 사용할 수 없습니다."
    4 -> "통신사 MMS 서버 연결에 실패했습니다."
    5 -> "MMS 발송 요청을 읽을 수 없습니다."
    6 -> "MMS 발송을 재시도해야 합니다."
    7 -> "통신사 MMS 설정을 사용할 수 없습니다."
    8 -> "MMS 무선 통신을 사용할 수 없습니다."
    9 -> "선택한 SIM이 활성 상태가 아닙니다."
    10 -> "MMS 데이터 사용이 꺼져 있습니다."
    11 -> "MMS 발송에 필요한 데이터 권한이 없습니다."
    else -> "Android MMS 발송 오류 ($code)"
  }
  private fun smsError(code: Int) = when (code) {
    1 -> "문자 발송에 실패했습니다."
    2 -> "휴대폰 무선 통신이 꺼져 있습니다."
    3 -> "문자 전송 데이터 오류입니다."
    4 -> "통신 서비스를 사용할 수 없습니다."
    5 -> "Android 문자 발송 제한에 도달했습니다."
    6 -> "고정 발신 번호 설정으로 차단되었습니다."
    7, 8 -> "단축 번호 발송이 허용되지 않았습니다."
    else -> "Android 문자 발송 오류 ($code)"
  }
  fun emptyParts(count: Int) = JSONArray().also { parts -> repeat(count) { parts.put(JSONObject.NULL) } }
}
