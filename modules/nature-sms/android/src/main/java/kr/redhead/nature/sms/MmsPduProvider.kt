package kr.redhead.nature.sms

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream

/** SMS Provider가 아니다. Android MMS 서비스에 단일 PDU 읽기만 허용하는 비공개 파일 provider. */
class MmsPduProvider : ContentProvider() {
  override fun onCreate() = true
  override fun getType(uri: Uri) = "application/vnd.wap.mms-message"
  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") throw FileNotFoundException("Read only")
    val context = requireNotNull(context)
    if (uri.authority != authority(context) || uri.pathSegments.size != 1) throw FileNotFoundException()
    return ParcelFileDescriptor.open(file(context, uri.lastPathSegment.orEmpty()), ParcelFileDescriptor.MODE_READ_ONLY)
  }
  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
  companion object {
    private fun authority(context: Context) = "${context.packageName}.nature.mms"
    private fun directory(context: Context) = File(context.noBackupFilesDir, "mms_outgoing")
    internal fun file(context: Context, attemptId: String): File {
      if (!attemptId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) throw FileNotFoundException()
      return File(directory(context), "$attemptId.pdu")
    }
    private fun uri(context: Context, attemptId: String) = Uri.Builder().scheme("content").authority(authority(context)).appendPath(attemptId).build()
    fun write(context: Context, attemptId: String, data: ByteArray): Uri {
      val directory = directory(context)
      check(directory.isDirectory || directory.mkdirs())
      // 앱이 종료되어 남은 임시 본문·첨부는 다음 준비 시 24시간 경과분을 삭제한다.
      directory.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86_400_000L }?.forEach { old ->
        remove(context, old.name.removeSuffix(".pdu"))
      }
      FileOutputStream(file(context, attemptId)).use { it.write(data); it.fd.sync() }
      // Android MmsServiceBroker가 이 URI를 telephony와 선택 SIM의 carrier 서비스에만 grant한다.
      return uri(context, attemptId)
    }
    fun remove(context: Context, attemptId: String) {
      context.revokeUriPermission(uri(context, attemptId), Intent.FLAG_GRANT_READ_URI_PERMISSION)
      file(context, attemptId).delete()
    }
  }
}
