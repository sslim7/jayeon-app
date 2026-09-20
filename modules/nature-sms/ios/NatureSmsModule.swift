import ExpoModulesCore
import MessageUI
import UIKit

/**
 * 문자 발송 네이티브 — **안드로이드 쪽(`NatureSmsModule.kt`)과 같은 함수 목록.**
 *
 * 🔴 **iOS 앱은 문자를 직접 보낼 수 없다.** 할 수 있는 일은 `MFMessageComposeViewController`
 * 로 시스템 작성 화면을 띄우는 것뿐이고, 실제로 나가는 것은 **사용자가 그 화면의 「보내기」를
 * 누를 때**다. 그래서 안드로이드의 `SmsManager` 경로에 있는 것들 — 회선(SIM) 선택, 통신사
 * 에러코드, 분할 조각별 결과, 백그라운드 결과 수신함 — 이 iOS 에는 하나도 없다. 없는 것을
 * 있는 척 채우지 않는다.
 *
 * ⚠️ 그래도 `getResultsAsync` / `acknowledgeAsync` 는 **빈 구현으로 남긴다.** 한쪽에만 있는
 * 함수는 JS 에 플랫폼 분기를 만들고, 그 분기는 언젠가 한쪽만 고쳐진다
 * (→ `modules/nature-call-audio/ios/NatureCallAudioModule.swift` 맨 위와 같은 이유).
 *
 * 🔴 **결과를 우리 결과 타입으로 옮기는 규칙은 여기 두지 않는다.** 이 파일은 시트를 띄우고
 * 시스템이 준 셋(`sent`/`cancelled`/`failed`) 중 하나를 그대로 돌려줄 뿐이고, 그것을
 * `SmsResult` 로 바꾸는 표는 `modules/nature-sms/ios-result.ts` 에 있다 — 그래야 단위
 * 테스트가 그 표를 직접 확인할 수 있다. Swift 안에 넣으면 실기기 없이는 아무도 못 본다.
 */
public class NatureSmsModule: Module {
  /// 지금 떠 있는 작성 화면. 🔴 시트는 한 번에 하나만 뜬다 — 두 번째 요청은 거절한다.
  /// 메인 스레드에서만 읽고 쓴다(모든 진입점이 `runOnQueue(.main)`).
  private var active: ComposeSession?

  public func definition() -> ModuleDefinition {
    Name("NatureSms")

    AsyncFunction("getCapabilitiesAsync") { () -> SmsCapabilities in
      Self.capabilities()
    }.runOnQueue(.main)

    // iOS 에는 문자 발송 권한이라는 개념이 없다. 시스템 작성 화면이 사용자 확인을 대신하므로
    // 물어볼 것이 없고, 그래서 `getCapabilitiesAsync` 와 같은 값을 돌려준다.
    AsyncFunction("requestPermissionsAsync") { () -> SmsCapabilities in
      Self.capabilities()
    }.runOnQueue(.main)

    AsyncFunction("sendAsync") { (input: SmsSendInput, promise: Promise) in
      self.present(input, promise)
    }.runOnQueue(.main)

    // iOS 는 `sendAsync` 가 결과를 직접 돌려준다. 안드로이드의 백그라운드 결과 수신함에
    // 해당하는 것이 없으므로 **항상 빈 배열**이다(원소 타입은 쓰이지 않는다).
    AsyncFunction("getResultsAsync") { () -> [String] in [] }

    // 지울 저널이 없다. 서버 저장 성공을 알려 주는 호출이므로 실패로 만들지 않는다.
    AsyncFunction("acknowledgeAsync") { (_: String) in }
  }

  private static func capabilities() -> SmsCapabilities {
    let canSend = MFMessageComposeViewController.canSendText()
    var result = SmsCapabilities()
    result.supported = canSend
    // 이미지 첨부(MMS/iMessage)를 붙일 수 있는가. 기기·회선 설정에 따라 꺼져 있을 수 있다.
    result.mmsSupported = canSend && MFMessageComposeViewController.canSendAttachments()
    // 물어볼 권한이 없으니, 보낼 수 있으면 곧 허용된 것이다.
    result.permissionGranted = canSend
    return result
  }

  private func present(_ input: SmsSendInput, _ promise: Promise) {
    guard MFMessageComposeViewController.canSendText() else {
      promise.reject("IOS_SMS_UNAVAILABLE", "이 기기에서는 문자를 보낼 수 없어요.")
      return
    }
    // 🔴 두 번째 시트를 띄우면 첫 번째 결과를 영영 못 받는다. 발송 루프가 한 건씩 기다리므로
    // 여기까지 오면 안 되지만, 화면이 두 번 눌리는 경우를 네이티브에서도 막는다.
    guard active == nil else {
      promise.reject("IOS_COMPOSER_BUSY", "메시지 화면이 이미 열려 있어요. 먼저 끝내 주세요.")
      return
    }
    guard let host = Self.topViewController() else {
      promise.reject("IOS_NO_WINDOW", "메시지 화면을 띄울 수 없어요.")
      return
    }

    let controller = MFMessageComposeViewController()
    controller.recipients = [input.phone]
    controller.body = input.message
    // 제목은 MMS 에서만 쓰인다. 지원하지 않는 기기에서 넣으면 무시되므로 물어보고 넣는다.
    if let subject = input.subject, !subject.isEmpty, MFMessageComposeViewController.canSendSubject() {
      controller.subject = subject
    }
    for file in input.attachments {
      guard let data = Data(base64Encoded: file.dataBase64), !data.isEmpty,
            let uti = Self.typeIdentifier(file.mimeType) else {
        promise.reject("IOS_ATTACHMENT_INVALID", "첨부파일을 읽지 못했어요.")
        return
      }
      guard controller.addAttachmentData(data, typeIdentifier: uti, filename: file.name) else {
        promise.reject("IOS_ATTACHMENT_REJECTED", "이 기기에서 첨부를 붙이지 못했어요.")
        return
      }
    }
    // ⚠️ 아래로 쓸어내려 닫으면 델리게이트가 오지 않을 수 있고, 그러면 이 Promise 가 영원히
    // 매달린다 — 발송 루프 전체가 멈춘다. 시트의 자기 버튼으로만 끝나게 막는다.
    controller.isModalInPresentation = true

    let session = ComposeSession { [weak self] outcome in
      self?.active = nil
      promise.resolve(["outcome": outcome])
    }
    controller.messageComposeDelegate = session
    active = session
    host.present(controller, animated: true)
  }

  private static func typeIdentifier(_ mimeType: String) -> String? {
    switch mimeType {
    case "image/jpeg": return "public.jpeg"
    case "image/png": return "public.png"
    // JPG/PNG 만 받는다. 서버·발송 루프가 허용하는 것도 이 둘뿐이다.
    default: return nil
    }
  }

  private static func topViewController() -> UIViewController? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .filter { $0.activationState == .foregroundActive }
      .flatMap { $0.windows }
    var top = (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
  }
}

/// 델리게이트는 강한 참조가 유지돼야 한다(`messageComposeDelegate` 는 weak 다).
private final class ComposeSession: NSObject, MFMessageComposeViewControllerDelegate {
  private let finish: (String) -> Void
  private var done = false

  init(finish: @escaping (String) -> Void) { self.finish = finish }

  func messageComposeViewController(
    _ controller: MFMessageComposeViewController, didFinishWith result: MessageComposeResult
  ) {
    let outcome: String
    switch result {
    // ⚠️ `.sent` 는 「메시지 앱에 넘겼다」는 뜻이다. 상대에게 닿았다는 보장이 아니고,
    // 안드로이드처럼 통신사 확정 결과가 뒤따라오지도 않는다.
    case .sent: outcome = "sent"
    case .cancelled: outcome = "cancelled"
    case .failed: outcome = "failed"
    // 새 iOS 가 넷째 결과를 주면 「실패」로 단정하지 않는다 — 나갔는지 모르는 것이다.
    @unknown default: outcome = "unknown"
    }
    controller.dismiss(animated: true) { [weak self] in self?.complete(outcome) }
  }

  private func complete(_ outcome: String) {
    // 델리게이트가 두 번 불려도 Promise 는 한 번만 끝낸다.
    if done { return }
    done = true
    finish(outcome)
  }
}

/// 회선 한 줄. iOS 는 이 목록을 채우지 못하므로 빈 배열의 타입으로만 쓰인다.
struct SmsSubscription: Record {
  @Field var id: Int = 0
  @Field var label: String = ""
}

/// 안드로이드 `getCapabilitiesAsync` 와 같은 모양. 채울 수 없는 칸은 채우지 않는다.
struct SmsCapabilities: Record {
  @Field var supported: Bool = false
  @Field var mmsSupported: Bool = false
  /// 🔴 항상 false. iOS 는 긴 본문이 SMS 로 나갔는지 LMS 로 나갔는지 알려 주지 않는다.
  /// 모르는 것을 true 로 적으면 이력 화면이 거짓 근거로 요금을 설명하게 된다.
  @Field var lmsSupported: Bool = false
  @Field var permissionGranted: Bool = false
  /// 🔴 **항상 빈 배열.** iOS 에는 발신 회선을 고르는 공개 API 가 없다. 듀얼 SIM 이어도
  /// 기기의 기본 회선으로 나가며, 앱은 그것을 읽지도 바꾸지도 못한다.
  @Field var subscriptions: [SmsSubscription] = []
  @Field var defaultSubscriptionId: Int? = nil
  /// 화면이 `Platform.OS` 를 보지 않고도 회선 선택 UI 를 감출 수 있게 하는 값이다.
  @Field var lineSelectable: Bool = false
  /// 한 건마다 사용자가 시스템 화면에서 「보내기」를 눌러야 나간다는 뜻.
  @Field var composerConfirm: Bool = true
}

struct SmsAttachment: Record {
  @Field var name: String = ""
  @Field var mimeType: String = ""
  @Field var dataBase64: String = ""
}

struct SmsSendInput: Record {
  @Field var campaignRecipientId: String = ""
  @Field var attemptId: String = ""
  @Field var phone: String = ""
  @Field var message: String = ""
  @Field var subject: String? = nil
  /// 안드로이드의 회선 식별자. iOS 는 회선을 고를 수 없어 읽지 않는다 — 같은 입력을 쓰려고 받는다.
  @Field var subscriptionId: Int = 0
  @Field var attachments: [SmsAttachment] = []
}
