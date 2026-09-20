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
 * 시스템이 준 셋(`sent`/`cancelled`/`failed`)에 결과 없이 사라진 경우(`abandoned`)를 더해
 * 결말 하나를 문자열로 돌려줄 뿐이고, 그것을 `SmsResult` 로 바꾸는 표는
 * `modules/nature-sms/ios-result.ts` 에 있다 — 그래야 단위 테스트가 그 표를 직접 확인할 수
 * 있다. Swift 안에 넣으면 실기기 없이는 아무도 못 본다.
 */
public class NatureSmsModule: Module {
  /// 지금 떠 있는 작성 화면. 🔴 시트는 한 번에 하나만 뜬다 — 두 번째 요청은 거절한다.
  /// 메인 스레드에서만 읽고 쓴다(모든 진입점이 `runOnQueue(.main)`, 정리도 메인으로 보낸다).
  private var active: ComposeSession?

  public func definition() -> ModuleDefinition {
    Name("NatureSms")

    /*
      🔴 **매달린 약속을 거둬들이는 자리.**

      시트는 `didFinishWith` 델리게이트에서만 끝난다. 그런데 그 델리게이트가 **안 오는 길**이
      있다 — 시트를 띄운 채 앱이 뒤로 갔다가 시스템이 화면을 정리한 경우, 다른 화면이 시트를
      대신 닫은 경우. 그러면 `sendAsync` 의 Promise 가 영영 안 풀리고, JS 발송 루프는
      `await device.send(...)` 에서 선 채로 멈춘다(→ `src/lib/sms-runner.ts`). 루프가 `finally`
      에 못 닿으니 `running` 이 영원히 true 로 남아 **앱의 모든 캠페인이 막힌다.** 실기기에서
      실제로 여기 갇혔고, 앱을 껐다 켜는 것 말고는 나올 길이 없었다.

      그래서 앱이 다시 활성화될 때마다 「시트가 사라졌는데 약속이 남아 있는가」를 확인한다.
      앱이 앞에 있는 동안 사라지는 경우는 세션 안의 감시 타이머가 같은 검사로 잡는다.
    */
    OnAppBecomesActive {
      DispatchQueue.main.async { [weak self] in self?.reclaimAbandonedComposer() }
    }

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
    // ⚠️ 거절하기 전에 먼저 거둬들인다. 사라진 시트의 참조가 남아 있으면 그 뒤의 **모든**
    // 발송이 `IOS_COMPOSER_BUSY` 로 거절된다 — 열려 있지도 않은 화면 때문에 앱이 잠긴다.
    reclaimAbandonedComposer()
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
    // ⚠️ 아래로 쓸어내려 닫으면 델리게이트가 오지 않을 수 있다. 막아 두지만 이것만 믿지는
    // 않는다 — 안 오는 길이 남아 있고, 그 뒷수습은 아래 감시 타이머와 `OnAppBecomesActive` 다.
    controller.isModalInPresentation = true

    let session = ComposeSession(controller: controller) { [weak self] outcome in
      self?.active = nil
      promise.resolve(["outcome": outcome])
    }
    controller.messageComposeDelegate = session
    active = session
    // 감시는 **띄우기가 끝난 뒤** 시작한다. 애니메이션 중에 재면 아직 자리를 못 잡은 화면을
    // 「사라졌다」고 오해할 수 있다.
    host.present(controller, animated: true) { session.startWatching() }
  }

  /// 시트가 사라졌는데 약속이 남아 있으면 「안 나갔다」로 끝내고 참조를 비운다.
  private func reclaimAbandonedComposer() {
    guard let session = active, session.abandonIfGone() else { return }
    active = nil
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
  /// 🔴 weak 다. 시스템이 시트를 통째로 정리하면 여기까지 nil 이 되고, 그 자체가 「사라졌다」는 신호다.
  private weak var controller: MFMessageComposeViewController?
  private var done = false
  /// 델리게이트가 왔고 닫는 중이다. 이 동안에는 감시가 끼어들면 안 된다.
  private var finishing = false
  private var watchdog: Timer?

  init(controller: MFMessageComposeViewController, finish: @escaping (String) -> Void) {
    self.controller = controller
    self.finish = finish
  }

  /**
   * 시트가 앞에 있는 동안 1초마다 「아직 화면에 있는가」를 본다.
   *
   * ⚠️ `OnAppBecomesActive` 만으로는 **앱이 앞에 있는 채로** 시트가 사라진 경우를 못 잡는다
   * (다른 화면이 대신 닫은 경우). 1초는 사람이 눈치채기 전에 풀리고, 시트가 떠 있는 동안에만
   * 도는 타이머라 평소 비용이 없다. 스크롤 중에도 멈추지 않게 `.common` 모드로 건다.
   */
  func startWatching() {
    guard !done, !finishing, watchdog == nil else { return }
    let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in _ = self?.abandonIfGone() }
    RunLoop.main.add(timer, forMode: .common)
    watchdog = timer
  }

  /**
   * 시트가 사라졌으면 「안 나갔다」로 끝낸다. 끝냈으면 true.
   *
   * 🔴 창에도 없고 띄운 쪽도 없을 때만 사라진 것으로 본다. 둘 중 하나라도 남아 있으면 아직
   * 사람 눈앞에 있는 화면이고, 그것을 성급히 거둬들이면 **보낸 문자를 안 보냈다고 적게 된다.**
   */
  func abandonIfGone() -> Bool {
    if done || finishing { return false }
    if let controller, controller.presentingViewController != nil || controller.view.window != nil {
      return false
    }
    complete("abandoned")
    return true
  }

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
    // 🔴 닫기 **전에** 감시를 멈춘다. 닫는 애니메이션 동안에는 시트가 사라진 것처럼 보이는데,
    // 그때 감시가 먼저 울면 진짜 결과(`sent`)가 「안 나갔다」로 덮인다.
    finishing = true
    stopWatching()
    controller.dismiss(animated: true) { [weak self] in self?.complete(outcome) }
  }

  private func stopWatching() {
    watchdog?.invalidate()
    watchdog = nil
  }

  private func complete(_ outcome: String) {
    // 델리게이트가 두 번 불려도, 감시와 델리게이트가 겹쳐도 Promise 는 한 번만 끝낸다.
    if done { return }
    done = true
    stopWatching()
    controller = nil
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
