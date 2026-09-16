# SMS Phase 1 앱·WAS 연동 계약

2026-09-16 구현 기준. 정본은 [WAS 계약](../../jayeon-was/docs/SMS_API_CONTRACT.md)이다.
기존 Bearer 인증, camelCase JSON, `{code,message,details?}` 오류를 사용한다.
모든 데이터는 인증된 사용자 소유 범위에서 처리한다.

## REST API

| 요청 | 입력·응답 |
| --- | --- |
| GET /recipients | q/groupId/includeSent/limit/cursor, `{items,nextCursor,total}` |
| POST /recipients | `{name,phone,groupId,customFields?}` → Recipient |
| PUT /recipients/:id | `{name,phone,groupId,customFields?}` → Recipient |
| POST /recipients/:id/external-sends | `{requestId,sentAt}` → `{recipient,history}`, 외부 발송 1건 멱등 등록 |
| DELETE /recipients/:id | 204 |
| POST /sms/campaigns | `{requestId,title,message,recipientIds}` → Campaign |
| GET /sms/history | q/limit/cursor → `{items,nextCursor,total}`, 발송 시각 내림차순 수신자 이력 |
| GET /sms/campaigns | limit/cursor, `{items,nextCursor}` |
| GET /sms/campaigns/:id | Campaign |
| GET /sms/campaigns/:id/recipients | `{items}` |
| POST /sms/campaigns/:id/start | Campaign |
| POST /sms/campaigns/:id/cancel | Campaign |
| PATCH /sms/campaigns/:cid/recipients/:rid | `{status:"SENDING",attemptId}`로 발송 대상 확보 |
| PATCH 같은 경로 | `{status:"SENT" 또는 "FAILED",attemptId,errorCode?,errorMessage?}` 결과 저장 |
| POST /sms/campaigns/:cid/recipients/:rid/retry | 명시 선택한 확실한 FAILED를 READY로 전환 |

대상 변경 응답은 `{campaign,recipient,dispatchAllowed}`다. 실제 최초 claim에서만
`dispatchAllowed:true`이며 응답 재조회나 동일 요청 재시도는 발송 권한을 새로 주지 않는다.
캠페인당 최대 50명, 제목 100자, 본문 2,000자다. 목록은 전체 페이지를 조회한다.
생성 requestId와 본문은 요청 전에 사용자별 로컬 저장소에 보관한다.
응답 유실 시 같은 요청을 재사용하며, 서버가 확정 거절한 입력 오류는 수정할 수 있다.

## 상태와 snapshot

Recipient는 id/name/phone/groupId/customFields/sentCount/latestSentAt/createdAt/updatedAt을 가진다.
customFields는 엑셀 첫 행의 추가 제목과 값을 원래 순서로 보존하는 `{name,value}[]`다.
목록은 이름순으로 전체 페이지를 읽고, 모바일 기본 열과 모든정보 보기로 전환한다.
신규 전화번호는 하이픈 제거 후 `010` 뒤 정확히 8자리만 허용한다. DB에는 숫자로 저장하며 UI는 `010-1234-5678`로 표시한다.
기존 `+8210` 번호는 중복 검사와 읽기에서 호환하지만 캠페인 snapshot은 변경하지 않는다.
Campaign에는 제목·본문·recipientCount·상태·생성/시작/완료 시각과 상태별 집계가 있다.
CampaignRecipient에는 원본 recipientId와 이름·번호·본문 snapshot, attemptId,
상태·성공/실패 시각·오류가 있다. 원본 수정·삭제는 과거 snapshot을 바꾸지 않는다.

Campaign: READY/SENDING/COMPLETED/PARTIAL_FAILED/CANCELLED.
서버 CampaignRecipient: READY/SENDING/SENT/FAILED.
단말 UNKNOWN은 서버 `FAILED + OUTCOME_UNKNOWN`으로 저장하고 재발송을 차단한다.
PARTIAL_SENT도 확인 필요 대상으로 취급한다. 늦은 SENT가 확인되면 같은 attempt의
OUTCOME_UNKNOWN만 SENT로 보정할 수 있다. SENT는 FAILED로 되돌리지 않는다.
완료 집계와 timestamp는 서버가 계산하고 중단은 기존 SENT를 보존한다.

## 발송 순서와 복구

사용자 전송 → 권한/SIM 확인 → 기존 단말 결과 동기화 → start → READY 하나 claim →
Android SENT callback → 결과 PATCH 성공 → 단말 acknowledge → 다음 대상 순서다.
실패한 서버 저장은 다음 SMS를 중단하고 단말 결과를 유지한다.
확보 응답이 유실되거나 결과를 알 수 없는 SENDING은 자동 재확보하지 않는다.
조회·앱 시작은 결과만 동기화하며 사용자 클릭 없이 발송하지 않는다.
실패 재발송은 선택한 대상만 처리하고 다른 READY를 함께 보내지 않는다.

## Native 인터페이스

`sendAsync({campaignRecipientId,attemptId,phone,message,subscriptionId})`는
`{campaignRecipientId,attemptId,phone,status,success,errorCode,errorMessage}`를 반환한다.
SENT는 모든 multipart 조각의 Android SENT 성공이며 배달·읽음을 뜻하지 않는다.
Native 세부 규칙은 [모듈 README](../modules/nature-sms/README.md)를 참고한다.


## 템플릿·첨부·수신자 확장

[WAS 확장 계약](../../jayeon-was/docs/MESSAGING_EXTENSION_CONTRACT.md)을 함께 따른다.
`includeSent=false`는 SENT 이력 없는 수신자만 조회하며 true/미지정은 전체다.
관리 화면은 전체, 문자 보내기는 false로 시작하고 체크 시 true로 조회한다.
캠페인 생성 입력에 attachmentIds를 전달하며 서버는 첨부 메타데이터를 snapshot으로 보존한다.
단말 입력에는 `{name,mimeType,dataBase64}[]`를 전달한다. 첨부content는 claim 전에 준비한다.
결과 PATCH의 optional transport(SMS/LMS/MMS)는 단말이 선택한 실제 요청 유형이다.
LMS는 텍스트형 MMS이며 자동 SMS 대체 전송을 하지 않는다.
