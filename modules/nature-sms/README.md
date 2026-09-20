# Nature SMS 모듈

Expo Modules API의 local module입니다. Android와 iOS(apple) 두 플랫폼을 가집니다. React 화면은 `index.ts`의 `smsNative`만 호출하며 네이티브 API를 직접 호출하지 않습니다. 플랫폼 분기는 `index.ts` 안에서 끝나고 밖에서 보는 함수 목록과 반환 타입은 두 플랫폼이 같습니다. Expo Go에서는 사용할 수 없고 `npx expo prebuild` 후 개발 빌드가 필요합니다. `modules/` 기본 autolinking으로 등록됩니다.

## 인터페이스

아래 설명은 Android 기준입니다. iPhone에서 무엇이 다른지는 [iPhone 절](#iphone-ios)에 있습니다.

- `getCapabilitiesAsync()` / `requestPermissionsAsync()`: 지원 여부, SEND_SMS와 READ_PHONE_STATE 권한, 활성 SIM ID/라벨, 기본 SMS SIM ID를 반환합니다. SIM의 전화번호를 읽지 않습니다.
- `sendAsync({campaignRecipientId, attemptId, phone, message, subscriptionId, attachments?})`: 명시적으로 선택된 활성 SIM에서 한 건을 발송합니다. attemptId는 영숫자/하이픈/밑줄 1~128자입니다.
- `getResultsAsync()`: 서버에 아직 확인 처리하지 않은 단말 결과입니다. 프로세스 종료로 결과가 불명확하면 `UNKNOWN`을 반환합니다.
- `acknowledgeAsync(attemptId)`: 서버 저장 성공 후 호출합니다. 중복 차단 기록은 삭제하지 않습니다. UNKNOWN은 늦은 Android 확정 결과를 놓치지 않도록 계속 반환됩니다.

결과는 `{campaignRecipientId, attemptId, phone, success, errorCode, errorMessage, status, transport}`이며 status는 SENT/FAILED/UNKNOWN입니다. SENT는 모든 분할 조각의 Android SENT callback 성공이며 상대방 배달/읽음 확인이 아닙니다. multipart 일부만 성공, 120초 callback timeout, 불확실한 Android 예외는 UNKNOWN이고 자동 재발송하지 않습니다.


## iPhone (`ios/`)

🔴 **iOS 앱은 문자를 직접 보낼 수 없다.** 할 수 있는 일은 `MFMessageComposeViewController` 로
시스템 메시지 작성 화면을 띄우는 것뿐이고, 실제로 나가는 것은 **사용자가 그 화면의 「보내기」를
누를 때**다. 이 제약은 우회할 수 없다. 그래서 안드로이드의 `SmsManager` 경로에 있는 것들이
iOS 에는 하나도 없다.

| | Android | iPhone |
| --- | --- | --- |
| 발송 | 앱이 직접 `SmsManager` 호출 | 시스템 시트 → 사용자가 「보내기」 |
| `subscriptions` | 활성 SIM 목록 | 🔴 **항상 빈 배열** — 회선을 고르는 공개 API 가 없다 |
| `requestPermissionsAsync` | SEND_SMS / READ_PHONE_STATE runtime permission | 물어볼 권한이 없어 `getCapabilitiesAsync` 와 같은 값 |
| 결과 | 조각별 SENT callback · 통신사 에러코드 | `sent` / `cancelled` / `failed` 셋뿐 |
| `transport` | SMS / LMS / MMS | 🔴 **채우지 않는다** — iMessage 였는지도 알 수 없다 |
| `getResultsAsync` · `acknowledgeAsync` | 백그라운드 저널 | 빈 배열 · 무동작 |

⚠️ `getResultsAsync` / `acknowledgeAsync` 를 iOS 에서 지우지 않는 이유는, 한쪽에만 있는 함수가
JS 에 플랫폼 분기를 만들고 그 분기는 언젠가 한쪽만 고쳐지기 때문이다
(`modules/nature-call-audio/ios/NatureCallAudioModule.swift` 맨 위와 같은 이유).

### 결과 매핑

⚠️ **`.sent` 는 「메시지 앱에 넘겼다」는 뜻이지 도달 보장이 아니다.** 안드로이드처럼 통신사
확정 결과가 뒤따라오지 않는다.

| 시트 결말 | `status` | `errorCode` |
| --- | --- | --- |
| `.sent` | `SENT` (success) | — |
| `.cancelled` | `UNKNOWN` | `USER_CANCELLED` |
| `.failed` | `FAILED` | `IOS_SEND_FAILED` |
| 새 iOS 의 알 수 없는 결말 | `UNKNOWN` | `IOS_OUTCOME_UNKNOWN` |

🔴 **이 표는 Swift 가 아니라 `ios-result.ts` 에 있다.** 실기기 없이 확인할 수 있어야 하는
규칙이기 때문이다(`tests/sms-ios.test.cjs`). Swift 는 시스템이 준 결말 문자열 하나만 넘긴다.

취소는 `status` 가 `UNKNOWN` 이지만 **「나갔는지 모른다」가 아니라 「안 나갔다」를 아는**
결과다. 그래서 `SmsRunner` 는 이 한 건을 `OUTCOME_UNKNOWN` 으로 덮지 않고 `USER_CANCELLED`
사유 그대로 저장하며, 일괄 발송을 세우지 않고 다음 사람으로 넘어간다. 사용자가 일부러
건너뛴 것은 `USER_SKIPPED` 로 따로 남는다 — 나중에 「왜 안 갔지」를 볼 때 둘은 다른 이야기다.

### 시트와 첨부

🔴 **시트는 한 번에 하나만** 뜬다. 이미 떠 있으면 `IOS_COMPOSER_BUSY` 로 거절한다 — 두 번째를
띄우면 첫 번째 결과를 영영 못 받는다. 쓸어내려 닫아도 델리게이트가 오지 않을 수 있어
`isModalInPresentation` 으로 시트 자기 버튼으로만 끝나게 막는다.

첨부는 `addAttachmentData(_:typeIdentifier:filename:)` 로 붙인다(JPG `public.jpeg` / PNG
`public.png` 만). 제목은 `canSendSubject()` 인 기기에서만 넣는다.

### 권한 선언 · 빌드

⚠️ **config plugin 도 `Info.plist` 키도 필요 없다.** 문자 발송에는 usage description 이 없다 —
시스템 시트가 사용자 확인을 대신하기 때문이다. `MessageUI` 프레임워크만 `NatureSms.podspec` 이
선언한다. `npx expo prebuild -p ios` 후 개발 빌드가 필요하며 Expo Go 에서는 쓸 수 없다.

실기기에서 확인할 것: 시트 표시/취소/발송, 25건 연속(탭 50번), 「통과」·「중단」 후 서버 상태,
이미지 첨부 MMS, iMessage 로 나가는 경우, 기내모드·통신 불가, 발송 중 앱 전환·종료.

## 중복 방지와 복구 (Android)

실제 SmsManager 호출 전에 private SharedPreferences에 attempt fence를 동기 commit합니다. commit 실패 시 발송하지 않습니다. 같은 attempt 재호출은 저장 결과만 반환하며, 동일 CampaignRecipient의 SENT/SENDING/UNKNOWN 기록이 있으면 새로운 attempt도 차단합니다. FAILED의 명시적 재시도는 서버 결과 저장/ack 후 새 attempt ID로만 가능합니다. 한 번에 한 건만 진행합니다.

명시적 non-exported manifest BroadcastReceiver와 고유 URI를 가진 immutable PendingIntent가 조각별 결과를 저장하므로 JS나 화면이 없어도 callback을 기록합니다. 앱 강제종료 등으로 callback이 소실되면 UNKNOWN을 유지합니다. 앱 재실행 자체는 발송하지 않습니다. 서버 claim/attempt 계약과 함께 사용해야 다른 기기에서도 중복을 방지할 수 있습니다. 단말 저장소 삭제/앱 삭제 이후에는 서버 상태가 중복 방지의 기준입니다.

원본 메시지를 journal이나 application log에 남기지 않습니다. 전화번호는 결과 전송에 필요한 private journal에만 보존합니다. 서버 저장 실패 시 ack하지 말고 다음 SMS를 중단해야 합니다. 결과 저장에 성공한 뒤 다음 대상에 대한 서버 claim 후 발송합니다.

## Android 동작 및 실기기 확인

발신번호는 선택한 SIM 회선의 통신사 번호이며 임의 발신번호 지정은 제공하지 않습니다. SEND_SMS와 SIM 선택을 위한 READ_PHONE_STATE runtime permission이 필요합니다. 문자 제한을 우회하지 않습니다.

앱은 `content://sms` 또는 `content://sms/sent`에 INSERT하지 않습니다. 다만 [Android SmsManager 공식 문서](https://developer.android.com/reference/android/telephony/SmsManager)에 따라 비기본 SMS 앱의 발송은 **Android 시스템이 SMS Provider에 자동 기록할 수 있습니다**. 따라서 기본 메시지 앱에서 기록이 절대 보이지 않는다고 보장할 수 없습니다. 앱의 이력 저장소는 Backend입니다.

실제 SIM 단말에서 권한 허용/거절, SIM 없음·듀얼 SIM 선택, 단일 SMS·한국어 LMS·이미지 MMS, 오류·통신 제한, 순차 30~50건, 중단, 프로세스 종료 후 복구, 서버 저장 실패, 기본 메시지함 동작을 확인해야 합니다. 자동 테스트에서는 실제 SMS를 발송하지 않습니다.

## 자동 검증

Android prebuild 후 `cd android && ./gradlew :nature-sms:compileDebugKotlin :nature-sms:testDebugUnitTest`로 Kotlin 컴파일과 Robolectric 17개 테스트(journal/중복 방지 8개, PDU·Android reference parser 7개, 이미지 단독 발송 준비 2개)를 수행합니다. 테스트용 가상 번호를 쓰고 발송 경로는 Robolectric SmsManager shadow로만 확인하므로 실제 무선 발송은 없습니다. 결과 reconcile과 acknowledge 호출은 앱 서비스에서 직렬화합니다.

## SMS / LMS / 이미지 MMS

첨부 없는 짧은 본문은 `sendTextMessage`, Android 분할 결과가 2개 이상인 본문은 텍스트형 MMS(LMS), 이미지 첨부가 있으면 MMS로 발송한다. 선택 SIM의 `smsToMmsTextThreshold` / `smsToMmsTextLengthThreshold`가 더 낮은 양수면 이 값도 적용한다. 통신사별 요금·실제 SMS/LMS 분류가 다를 수 있으므로 한국어 고정 byte 수를 과금 기준으로 단정하지 않는다. MMS/LMS 실패 시 자동으로 SMS를 대신 보내지 않는다.

입력의 `attachments`는 선택 사항이며 `{ name, mimeType, dataBase64 }[]` 형식이다. JPG/PNG 최대 3개, 파일당 300KiB, 합계 600KiB를 허용한다. 실제 이미지 형식/해상도를 검증하고 최종 PDU 크기는 선택 SIM의 `maxMessageSize`(미제공 시 보수적으로 300KiB)로 한 번 더 제한한다. 이미지 크기나 용량 제한을 넘으면 무선 호출 전에 `FAILED / MMS_PREPARATION_FAILED`로 반환한다. PDF 등 일반 파일은 지원하지 않는다. 이미지 자동 변환·압축은 하지 않는다.

`capabilities.mmsSupported`와 `capabilities.lmsSupported`는 새 네이티브 빌드에서만 `true`다. 앱은 첨부를 예전 SMS 전용 빌드에 전달하지 않아야 한다. 결과의 `transport`는 `SMS | LMS | MMS`이며 저널에도 보관한다.

MMS Encapsulation 1.2의 단일 수신자 M-Send.req PDU를 생성한다. UTF-8 본문, SMIL, 이미지별 part를 포함하고 발신 주소는 insert-address-token을 사용해 SIM/통신사에서 정한다. PDU는 앱 `noBackupFilesDir`에 저장한다. 별도 비공개 `MmsPduProvider`는 읽기만 허용하며 Android `MmsServiceBroker`가 telephony 및 선택 SIM의 carrier 서비스에 URI 읽기 권한을 부여한다. 이것은 `content://sms` / `content://mms` 메시지 Provider에 기록하는 작업이 아니다. 확정 callback 후 파일과 읽기 권한을 제거하며 앱 종료로 남은 24시간 경과 파일은 다음 PDU 준비 때 정리한다.

MMS/LMS도 `sendMultimediaMessage`의 SENT PendingIntent 결과가 와야 완료된다. 함수 반환만으로 성공 처리하지 않으며 120초 타임아웃·프로세스 종료·Binder 오류는 UNKNOWN으로 유지한다. 저널/중복 차단/늦게 도착한 SENT 동기화 규칙은 SMS와 같다. 실제 Android/통신사의 APN, MMS 데이터 연결, 이미지 수신 및 요금은 실기기 검증이 필요하다. 테스트에서는 무선 발송을 호출하지 않는다.

구현 기준:
- [Android SmsManager API](https://developer.android.com/reference/android/telephony/SmsManager)
- [AOSP MmsServiceBroker URI grants](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/MmsServiceBroker.java)
- [AOSP MMS PduComposer wire format](https://android.googlesource.com/platform/packages/apps/Messaging/+/master/src/com/android/messaging/mmslib/pdu/PduComposer.java)


## Nature 식별자

Expo 모듈 이름은 `NatureSms`, Kotlin 패키지는 `kr.redhead.nature.sms`다.
새 PendingIntent 식별자는 `nature-sms://sent/...`이며 receiver는 이전 `jayeon-sms`도
허용한다. journal 파일 이름 `jayeon_sms_journal_v1`은 복구 호환성을 위해 유지한다.
다만 Android 앱 package 변경은 별도 sandbox를 만들기 때문에 구형 앱의 파일이 새 패키지로
자동 이전되지는 않는다. 기존 앱에서 진행 중인 결과를 서버와 동기화한 뒤 전환해야 한다.
