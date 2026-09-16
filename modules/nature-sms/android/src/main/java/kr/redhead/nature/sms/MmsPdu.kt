package kr.redhead.nature.sms

import android.graphics.BitmapFactory
import android.telephony.SmsManager
import android.util.Base64
import java.io.ByteArrayOutputStream

/** MMS Encapsulation 1.2 / WSP의 단일 수신자 M-Send.req. 외부 API·숨겨진 Android API를 사용하지 않는다. */
internal object MmsPdu {
  const val MAX_FILE_BYTES = 300 * 1024
  const val MAX_TOTAL_BYTES = 600 * 1024
  data class Image(val mime: String, val bytes: ByteArray)
  private data class Part(val name: String, val mime: String, val data: ByteArray, val text: Boolean = false)

  fun decode(attachments: List<SmsAttachmentRecord>): List<Image> {
    require(attachments.size in 0..3) { "이미지 첨부는 3개까지 가능합니다." }
    var total = 0
    return attachments.map { attachment ->
      require(attachment.mimeType in setOf("image/jpeg", "image/png")) { "JPG 또는 PNG 이미지만 MMS로 보낼 수 있습니다." }
      require(attachment.dataBase64.length <= (MAX_FILE_BYTES + 2) / 3 * 4) { "이미지 한 개는 300KB 이하여야 합니다." }
      require(attachment.dataBase64.matches(Regex("[A-Za-z0-9+/]*={0,2}"))) { "이미지 데이터 형식이 올바르지 않습니다." }
      val bytes = Base64.decode(attachment.dataBase64, Base64.NO_WRAP)
      require(bytes.isNotEmpty() && bytes.size <= MAX_FILE_BYTES) { "이미지 한 개는 300KB 이하여야 합니다." }
      total += bytes.size
      require(total <= MAX_TOTAL_BYTES) { "첨부 이미지 합계는 600KB 이하여야 합니다." }
      val info = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, info)
      require(info.outWidth > 0 && info.outHeight > 0 && info.outMimeType == attachment.mimeType) { "이미지 파일을 읽을 수 없거나 확장자와 실제 형식이 다릅니다." }
      Image(attachment.mimeType, bytes)
    }
  }

  fun prepare(input: SmsSendRecord, manager: SmsManager): ByteArray {
    val images = decode(input.attachments)
    val config = manager.carrierConfigValues
    require(config.getBoolean(SmsManager.MMS_CONFIG_MMS_ENABLED, true)) { "선택한 SIM은 MMS 발송을 지원하지 않습니다." }
    val maxWidth = config.getInt(SmsManager.MMS_CONFIG_MAX_IMAGE_WIDTH, 0)
    val maxHeight = config.getInt(SmsManager.MMS_CONFIG_MAX_IMAGE_HEIGHT, 0)
    images.forEach { image ->
      val info = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(image.bytes, 0, image.bytes.size, info)
      require((maxWidth <= 0 || info.outWidth <= maxWidth) && (maxHeight <= 0 || info.outHeight <= maxHeight)) {
        "이미지 해상도가 선택한 SIM의 MMS 제한을 초과합니다. 이미지를 줄여 주세요."
      }
    }
    val pdu = encode(input.phone, input.message, input.attemptId, images)
    val limit = config.getInt(SmsManager.MMS_CONFIG_MAX_MESSAGE_SIZE, 300 * 1024).takeIf { it > 0 } ?: 300 * 1024
    require(pdu.size <= limit) { "첨부와 본문이 선택한 SIM의 MMS 용량 제한을 초과합니다. 이미지를 줄여 주세요." }
    return pdu
  }

  fun encode(phone: String, message: String, transactionId: String, images: List<Image>): ByteArray {
    require(phone.matches(Regex("\\+?[0-9]{8,15}")))
    require(transactionId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
    require(images.size in 0..3)
    val imageParts = images.mapIndexed { index, image ->
      Part("image${index + 1}.${if (image.mime == "image/png") "png" else "jpg"}", image.mime, image.bytes)
    }
    // 파일명이 SMIL/XML에 삽입되지 않도록 내부 이름만 사용한다.
    val smil = "<smil><head><layout><root-layout width=\"320\" height=\"480\"/><region id=\"Image\" left=\"0\" top=\"0\" width=\"320\" height=\"320\" fit=\"meet\"/><region id=\"Text\" left=\"0\" top=\"320\" width=\"320\" height=\"160\"/></layout></head><body>" +
      (if (imageParts.isEmpty()) "<par dur=\"5000ms\"><text src=\"text.txt\" region=\"Text\"/></par>" else imageParts.joinToString("") { "<par dur=\"5000ms\"><img src=\"${it.name}\" region=\"Image\"/><text src=\"text.txt\" region=\"Text\"/></par>" }) + "</body></smil>"
    val parts = listOf(Part("smil.xml", "application/smil", smil.toByteArray(Charsets.UTF_8), true), Part("text.txt", "text/plain", message.toByteArray(Charsets.UTF_8), true)) + imageParts
    return Bytes().apply {
      octet(0x8c); octet(0x80) // Message-Type: M-Send.req
      octet(0x98); text(transactionId)
      octet(0x8d); octet(0x92) // MMS-Version: 1.2
      octet(0x89); octet(1); octet(0x81) // From: insert-address-token (선택 SIM 번호)
      octet(0x97); value(Bytes().apply { octet(0xea); text("$phone/TYPE=PLMN") }.bytes())
      octet(0x8a); octet(0x80) // Message-Class: personal
      octet(0x86); octet(0x81) // Delivery-Report: no
      octet(0x90); octet(0x81) // Read-Report: no
      octet(0x84) // Content-Type (마지막 헤더)
      value(Bytes().apply {
        octet(0xb3) // application/vnd.wap.multipart.related
        octet(0x8a); text("<smil.xml>")
        octet(0x89); text("application/smil")
      }.bytes())
      uint(parts.size)
      parts.forEach { part ->
        val headers = Bytes().apply {
          value(Bytes().apply {
            text(part.mime); octet(0x85); text(part.name)
            if (part.text) { octet(0x81); octet(0xea) } // charset UTF-8 = 106
          }.bytes())
          octet(0xc0); octet(0x22); text("<${part.name}>")
          octet(0x8e); text(part.name)
        }.bytes()
        uint(headers.size); uint(part.data.size); raw(headers); raw(part.data)
      }
    }.bytes()
  }

  private class Bytes {
    private val out = ByteArrayOutputStream()
    fun octet(value: Int) { out.write(value) }
    fun raw(value: ByteArray) { out.write(value) }
    fun text(value: String) { raw(value.toByteArray(Charsets.UTF_8)); octet(0) }
    fun uint(value: Int) {
      require(value >= 0)
      var shift = 0
      while ((value ushr shift) > 127) shift += 7
      while (shift > 0) { octet(((value ushr shift) and 0x7f) or 0x80); shift -= 7 }
      octet(value and 0x7f)
    }
    fun value(value: ByteArray) { if (value.size < 31) octet(value.size) else { octet(31); uint(value.size) }; raw(value) }
    fun bytes(): ByteArray = out.toByteArray()
  }
}
