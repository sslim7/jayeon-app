# SMS Phase 1 구현과 검증

## 기존 구조 유지

앱은 Expo SDK 57, React Native 0.86, Expo Router, TypeScript, Zustand를 사용한다.
기존 API 클라이언트와 토큰 재발급, 인증 후 WebView 화면 구조, 환경변수·디자인 토큰을 재사용한다.
Android package는 kr.redhead.nature이며 prebuild로 생성하는 android 디렉터리는 추적하지 않는다.
Expo Modules API의 modules/nature-sms가 자동 연결된다.

WAS는 Go 1.26, net/http 라우터, Firestore SDK, 기존 JWT 인증·오류 형식을 유지한다.
SQL ORM이나 별도 migration/queue infrastructure를 추가하지 않는다.
별도 WAS 작업과 API 계약을 맞췄으며 서버 구현 정본은 jayeon-was에 있다.

## 책임 분리

- recipients 및 sms 라우트: 수신자·작성·진행·이력 화면.
- sms-api: 기존 인증 API 클라이언트 위의 REST 계약.
- sms-runner: claim, 순차 발송, 결과 저장, 중지·복구.
- sms-device 및 WebView 브리지: UI가 모르는 Android 모듈 호출 경계.
- modules/nature-sms: 권한·활성 SIM·SmsManager·SENT receiver·단말 결과 저장.

## 중복 방지의 경계

물리적 SMS와 서버 DB를 하나의 트랜잭션으로 만들 수 없다.
서버의 READY→SENDING 원자적 확보와 단말의 전송 전 동기 저장을 함께 사용한다.
전송 여부를 확정할 수 없으면 자동 재발송보다 확인 필요 상태를 우선한다.
따라서 claim 직후 응답이 사라지고 단말 결과도 없는 SENDING은 사용자 조사가 필요하며,
앱이 임의로 READY로 되돌리지 않는다. 앱 데이터 삭제/재설치도 이 불확실성을 없애지 않는다.

중지는 이미 시작된 1건의 결과를 저장한 뒤 다음 대상을 중단한다.
서버 저장 실패 시 단말 결과를 보존하고 다음 발송을 멈춘다.
단말의 UNKNOWN은 서버 FAILED/OUTCOME_UNKNOWN으로 저장하고 재시도에서 제외한다.
늦게 성공이 확인되면 동일 attempt만 성공으로 보정한다.
앱 재시작은 동기화만 하며 미발송 재개는 명시 클릭이 필요하다.

## 자동 검증

2026-09-16 기준 다음 검증을 수행했다. 실제 무선 SMS 호출은 하지 않았다.

- 앱 타입검사·lint, 웹 정적 export.
- 인증 단위 회귀와 SMS 순차 발송·중복 차단·서버 저장 실패·세션 변경·UNKNOWN 복구 테스트.
- 데스크톱·모바일 브라우저에서 인증 및 SMS API/Native 모의 시나리오.
- 독립 Inspector의 diff·계약·타입검사·SMS 단위 검증.
- Android Kotlin 컴파일, Robolectric 17건, 전체 debug APK assembleDebug.

```bash
npm run typecheck
npm run lint
npm run test:auth
npm run test:sms
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
npm run export:web
npx expo prebuild --platform android --no-install
cd android
./gradlew :nature-sms:testDebugUnitTest :app:assembleDebug
```

APK 위치는 android/app/build/outputs/apk/debug/app-debug.apk다.
개발용 APK는 Metro 개발 서버 연결이 필요하며 운영 배포물이 아니다.
WAS의 실제 Firestore 통합 검증은 WAS 저장소의 tests 및 docs/SMS_PHASE1.md를 참고한다.
앱 브라우저 자동 검사는 실제 WAS 통합 검증을 대신하지 않는다.

## 사용자가 실제 Android에서 확인할 순서

1. 최신 WAS와 에뮬레이터를 실행하고 앱 API/WebView 환경변수를 PC LAN 주소로 설정한다.
2. USB 디버깅 단말에서 npm run android:dev로 설치하고 로그인한다.
3. 통제 가능한 테스트 수신자 1명을 등록하고 SEND_SMS·READ_PHONE_STATE 권한 및 발송 SIM을 확인한다.
4. 짧은 SMS 1건의 실제 수신과 서버 SENT를 비교한다. SENT는 읽음 확인이 아니다.
5. 한국어 장문 multipart의 실제 수신과 조각 전체 결과를 확인한다.
6. 권한 거절·SIM 없음·듀얼 SIM·통신 오류와 제한이 화면에 표시되는지 확인한다.
7. 동의한 수신자 30~50명으로 순차 발송, 중지, 서버 연결 단절, 강제종료 후 복구를 확인한다.
8. 재실행만으로 발송하지 않으며 SENT 제외·미발송 명시 재개·실패 선택 재발송을 확인한다.
9. 제조사·Android 버전·기본 메시지 앱에 따른 보낸 메시지함 표시를 기록한다.

앱은 SMS Provider에 INSERT하지 않지만 Android 시스템의 자체 저장은 별개다.
외부 SMS API, 제한 우회, iOS 자동 SMS, 예약발송, PDF 첨부, 주소록 동기화는 구현 범위에 없다.

추가 구현: 템플릿·JPG/PNG 첨부·SMS/LMS/MMS 자동 구분·엑셀 수신자 가져오기·
발송자 포함 필터·개별 발송 이력. 최신 실행 방법과 제한은 README 및
[WAS 확장 계약](../../jayeon-was/docs/MESSAGING_EXTENSION_CONTRACT.md)을 참고한다.
실제 SIM의 LMS/MMS 수신과 기본 메시지함 표시는 아직 검증하지 않았다.


## 확장 최종 검증 기록 (2026-09-16)

- 데스크톱·모바일 브라우저 34건 통과(인증 14, 메시지 기능 20).
- 발송 runner 14건, Android Robolectric 17건 통과 및 debug APK 빌드 성공.
- WAS Firestore 에뮬레이터에서 전체 go test -race -p 1 ./... 통과(Backend Worker 실행).
- 타입검사·lint·웹 export·diff 검사 통과, 독립 Inspector 지적 해소.
- 문자 보내기의 표·이름/그룹 필터·전체 선택·발송일시 이력을 브라우저와 화면 캡처로 확인.
- 이미지 단독 메시지 입력 검증과 닫힌 모달의 포커스 잔류 문제를 수정하고 회귀 검증.
- 실제 SIM SMS/LMS/MMS 송수신은 미수행. Android에서 최신 개발 앱 재설치 후 확인 필요.
