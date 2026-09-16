# Nature SMS Android 모듈

Expo Modules API의 Android 전용 local module입니다. `index.ts`의 `smsNative`만 호출하며 React 화면에서 Android API를 직접 호출하지 않습니다. Expo Go에서는 사용할 수 없고 `npx expo prebuild --platform android` 후 개발 빌드가 필요합니다. `modules/` 기본 autolinking과 library manifest merge로 등록됩니다.

## 인터페이스

- `getCapabilitiesAsync()` / `requestPermissionsAsync()`: 지원 여부, SEND_SMS와 READ_PHONE_STATE 권한, 활성 SIM ID/라벨, 기본 SMS SIM ID를 반환합니다. SIM의 전화번호를 읽지 않습니다.
- `sendAsync({campaignRecipientId, attemptId, phone, message, subscriptionId, attachments?})`: 명시적으로 선택된 활성 SIM에서 한 건을 발송합니다. attemptId는 영숫자/하이픈/밑줄 1~128자입니다.
- `getResultsAsync()`: 서버에 아직 확인 처리하지 않은 단말 결과입니다. 프로세스 종료로 결과가 불명확하면 `UNKNOWN`을 반환합니다.
- `acknowledgeAsync(attemptId)`: 서버 저장 성공 후 호출합니다. 중복 차단 기록은 삭제하지 않습니다. UNKNOWN은 늦은 Android 확정 결과를 놓치지 않도록 계속 반환됩니다.

결과는 `{campaignRecipientId, attemptId, phone, success, errorCode, errorMessage, status, transport}`이며 status는 SENT/FAILED/UNKNOWN입니다. SENT는 모든 분할 조각의 Android SENT callback 성공이며 상대방 배달/읽음 확인이 아닙니다. multipart 일부만 성공, 120초 callback timeout, 불확실한 Android 예외는 UNKNOWN이고 자동 재발송하지 않습니다.

## 중복 방지와 복구

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
