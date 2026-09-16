package kr.redhead.nature.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 명시적 PendingIntent 대상. JS·화면 종료 후에도 동작하며 외부로 공개하지 않는다. */
class SmsSentReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val uri = intent.data ?: return
    // 이전 식별자로 도착한 결과도 같은 journal에서 확인한다.
    if (uri.scheme !in setOf("nature-sms", "jayeon-sms") || uri.authority != "sent") return
    val attemptId = uri.pathSegments.getOrNull(0) ?: return
    val part = uri.pathSegments.getOrNull(1)?.toIntOrNull() ?: return
    try {
      SmsJournal.recordPart(context.applicationContext, attemptId, part, resultCode)
    } catch (_: Exception) {
      // 발송 전 중복 방지 기록을 보존한다. 저장 오류를 성공으로 보고하거나 재발송하지 않는다.
      SmsDispatch.failStorage(attemptId)
    }
  }
}
