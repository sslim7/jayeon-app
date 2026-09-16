# jayeon-app

「자연」 앱. Expo(React Native) 기반이고 **웹이 주 무대**다.

안드로이드 앱은 껍데기에 가깝다. 인증까지만 네이티브 화면으로 그리고, 그 다음부터는
웹뷰로 `https://jayeon.redhead.kr` 을 연다. 화면을 앱에 복사하지 않는 이유는 문구나 흐름을
고칠 때마다 스토어 심사를 다시 받지 않기 위해서다. 카메라처럼 웹으로 안 되는 일부 기능만
앞으로 네이티브로 구현할 예정이다.

## 관련 저장소

| 저장소 | 역할 |
| --- | --- |
| `jayeon-was` | 백엔드(API). `https://jayeon-api.redhead.kr` |
| `redhead-terraform` | `redhead.kr` 우산 도메인과 그 아래 앱들의 인프라 관리 |
| `birdieup-app` | 형제 프로젝트. 이 저장소의 빌드·배포 규칙이 여기서 왔다 |

## 시작하기

```bash
npm install
cp -n .env.example .env # 최초 1회. 기존 .env는 보존한다
npm run dev             # Expo 개발 서버 (3103 포트). 실행 후 w로 웹 열기
```

웹을 바로 열거나 Android에서 실행할 때는 아래 명령 중 하나를 사용한다.

```bash
npm run dev:web         # 웹 (3103 포트)
npm run android         # 안드로이드
```

웹 주소는 **http://localhost:3103**이다. `npm run dev`는 앱 개발 서버만 실행한다.
실제 로그인에는 **Firestore 에뮬레이터(8090)와 jayeon-was(8091)**가 함께 실행되어야 한다.

### WAS와 초대 계정 준비

먼저 [jayeon-was 로컬 개발 안내](../jayeon-was/README.md#로컬-개발-시작하기)에 따라
WAS의 `.env`와 서로 다른 JWT 시크릿을 준비한다. 아래 명령은 `jayeon-was`에서 실행한다.

```bash
# 터미널 1: 개발 데이터 저장·복원용 Firestore 에뮬레이터
firebase emulators:start --only firestore --project demo-jayeon \
  --import=./emulator-data --export-on-exit=./emulator-data

# 터미널 2: WAS (.env의 PORT=8091)
go run .
```

계정은 공개 가입 대신 CLI로 만든다. 에뮬레이터가 실행된 상태에서 별도 터미널로 실행한다.
CLI는 `.env`를 읽지 않으므로 대상 환경변수를 직접 전달한다.

```bash
GOOGLE_CLOUD_PROJECT=demo-jayeon FIRESTORE_EMULATOR_HOST=localhost:8090 \
  go run ./cmd/create-user --email invitee@example.com --name '초대 사용자' \
  --password '<8자 이상 임시 비밀번호>' --write
```

생성한 이메일과 임시 비밀번호로 앱에 로그인하면 비밀번호 변경 화면이 나온다.
변경 후에는 **새 비밀번호로 다시 로그인**한다. 새 비밀번호는 8자 이상, UTF-8 기준
72바이트 이하이며 현재 비밀번호와 달라야 한다. 정책 검증은 WAS가 수행한다.

WAS 상태는 http://localhost:8091/health, API 문서는 http://localhost:8091/docs에서 확인한다.
실기기에서는 개발 PC와 같은 네트워크를 사용하고 PC의 3103·8091 포트에 접근할 수 있어야 한다.
필요하면 앱 `.env`의 API·웹뷰 주소에 개발 PC의 사설 IP를 지정한다.

### 검사와 빌드

```bash
npm run lint
npm run typecheck
npm run test:auth
npm run test:e2e
npm run export:web      # 웹 정적 빌드 → dist/
```

인증 회귀 검사는 `npm run test:auth`, 브라우저 검사는 `npm run test:e2e`로 실행한다.
브라우저 최초 실행 전 `npx playwright install chromium`이 필요하다. 이미 설치된 Chrome을
쓰려면 `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`로 실행한다. 브라우저 검사는 3103의
개발 서버를 자동으로 시작하거나 재사용하며, 인증 API 응답을 모의하므로 실제 서버 연동
검증을 대신하지 않는다. 데스크톱과 모바일 화면 크기를 각각 검사한다.

## 실제 서버에 붙여 보기

위 `npm run test:e2e` 는 **인증 API 를 모의한다** — 화면과 스토어의 계약은 지키지만 서버가
정말 그렇게 답하는지는 확인하지 못한다. 계약이 바뀌었을 때 그 사실이 드러나는 곳은 여기다.

```bash
# 1) 백엔드 (다른 터미널 두 개)
cd ../jayeon-was
cp .env.example .env    # JWT_SECRET 과 ADMIN_JWT_SECRET 을 서로 다른 값으로 채운다
firebase emulators:start --only firestore --project demo-jayeon   # 8090
go run .                                                          # 8091

# 2) 계정 만들기 — 가입 API 가 없으므로 CLI 로만 만들어진다
FIRESTORE_EMULATOR_HOST=localhost:8090 GOOGLE_CLOUD_PROJECT=demo-jayeon \
  go run ./cmd/create-user -email you@redhead.kr -name 이름 -password temp-pass-1234 -write

# 3) 앱
cd ../jayeon-app && npm run dev:web    # 3103
```

만들어진 계정은 `mustChangePassword: true` 라 **첫 로그인이 곧 강제 변경 화면**이다. 즉 한
번 로그인해 보는 것만으로 로그인 → 강제 변경 → 재로그인까지 다 지나간다.

`.env` 의 `EXPO_PUBLIC_API_URL` 이 `http://localhost:8091` 이어야 한다. 이 값이 운영 주소를
가리킨 채로 로컬을 확인하면 **아무것도 틀리지 않았는데 로그인만 안 되는** 상태가 된다.

## 디렉터리 구조

```
src/app/         expo-router 라우트. 파일 경로가 곧 URL 이다
src/lib/         API 클라이언트·저장소 접근 등 화면에 종속되지 않는 코드
src/config/      환경변수를 읽어 타입 있는 설정 객체로 바꾸는 곳
src/constants/   색·간격·글꼴 같은 디자인 토큰
src/store/       zustand 전역 상태
src/components/  화면 간 공용 컴포넌트
deploy/          nginx.conf — 운영 이미지가 dist/ 를 내보내는 설정
docs/            문서. 배포 절차는 docs/deploy.md
```

현재 로그인·비밀번호 변경·계정 확인 홈과 네이티브 웹뷰 연결이 구현되어 있다.
인증 이후 서비스 도메인 화면은 추가 구현 대상이다.

## 로컬 포트

🔴 **jayeon 의 포트는 `31xx` / `809x` 대역에서 고른다.**

한 머신에 birdieup 과 jayeon 이 같이 있고 둘을 동시에 띄우는 일이 실제로 있다. 겹치면
나중에 뜬 쪽이 「주소가 이미 사용 중」으로 죽는데, **더 나쁜 것은 죽지 않는 경우다** —
앱이 자기 API 대신 다른 프로젝트의 서버를 부르게 되고, 엉뚱한 404 를 받고도 원인이 자기
코드에 있다고 생각하며 한참을 헤맨다.

| | admin | app(dev) | Firestore 에뮬레이터 | 에뮬 UI | was | 테스트 에뮬 |
| --- | --- | --- | --- | --- | --- | --- |
| birdieup | 3000 | 3003 | 8080 | 4000 | 8081 | 8085 |
| **jayeon** | (3100) | **3103** | **8090** | **4090** | **8091** | **8095** |

새 포트를 잡을 일이 생기면 이 표에 먼저 적고 쓴다.

## 브랜치와 배포

- **모든 작업은 `staging` 브랜치에서 한다.** 기본 브랜치이며 `main` 은 삭제됐다.
- 배포할 때 `staging` 을 `release` 로 머지한다.
- `release` 에 `v*` 태그를 붙여 푸시하면 Cloud Build 트리거가 돌아 배포된다
  (트리거 정규식 `^v.*$`).

```
git checkout release && git merge staging && git push
git tag v0.1.0 && git push origin v0.1.0
```

Git 에서 **태그는 브랜치에 속하지 않는다.** 그래서 "release 브랜치에 붙인 v 태그" 라는
조건은 Cloud Build 가 표현할 수 없고, 트리거는 "v 로 시작하는 태그가 푸시됐다" 까지만
안다. 어느 브랜치의 커밋에 태그를 붙였는지는 **태그를 미는 사람이 지키는 규칙**이다
(근거: `birdieup-terraform/modules/cicd/variables.tf` 의 `tag_regex` 주석).

자세한 절차와 배포 전 확인 항목은 [docs/deploy.md](docs/deploy.md).
`staging` 커밋·푸시만으로 배포하지 않는다. 배포는 별도 요청이 있을 때 진행한다.

## 환경변수

`EXPO_PUBLIC_*` 만 앱 번들에 노출된다. 서버 시크릿을 넣지 마라.
그리고 이 값들은 **빌드 시점에 번들 안으로 박힌다** — Cloud Run 환경변수를 고쳐도 반영되지
않는다. 운영 값을 바꾸려면 Cloud Build 트리거의 substitution 을 고치고 다시 빌드해야 한다.

| 이름 | 기본값(운영) | 설명 |
| --- | --- | --- |
| `EXPO_PUBLIC_ENV` | `production` | `development` \| `production`. 디버그 동작을 켤지 판단하는 유일한 스위치 |
| `EXPO_PUBLIC_API_URL` | `https://jayeon-api.redhead.kr` | WAS 주소. 끝에 슬래시를 붙이지 마라 (로컬은 `http://localhost:8091`) |
| `EXPO_PUBLIC_WEBVIEW_URL` | `https://jayeon.redhead.kr` | 네이티브 껍데기의 웹뷰가 열 주소. 네이티브에서만 읽는다 |
| `EXPO_DEV_PORT` | (로컬 전용) `3103` | 로컬 dev 서버 포트. `EXPO_PUBLIC_WEBVIEW_URL` 의 포트와 어긋나면 네이티브 웹뷰가 빈 화면이 된다 |

로컬 값은 `.env.example` 의 각 항목 주석에 `[로컬]` 로 적혀 있다.

## 코드 규칙

- **주석은 한국어로, "무엇"이 아니라 "왜"를 적는다.** 코드를 읽으면 아는 것을 옮겨 적지 말고,
  읽어도 모르는 배경(왜 이 순서인지, 왜 이 값인지, 무엇이 깨졌었는지)을 남긴다.
- 문자열은 홑따옴표, 줄 길이 100 (`.prettierrc.js`).
- **`prettier --write .` 를 저장소 전체에 돌리지 마라.** 관련 없는 파일까지 통째로 바뀌어
  리뷰에서 실제 변경을 못 찾게 된다. 고친 파일만 포매팅한다.

## 제품 결정

**빠뜨린 것이 아니라 만들지 않기로 한 것들이다.** 다음 사람이 「이게 왜 없지?」 하고 다시
만들지 않도록 적어 둔다.

- **가입 화면이 없다.** 「자연」은 초대받은 사람만 쓰는 내부 서비스다. 계정은 서버 CLI
  (`jayeon-was` 의 `cmd/create-user`)로 발급하고 임시 비밀번호를 사람이 직접 전달한다.
  약관 동의도, 이메일 중복 확인도, 회원가입 경로도 두지 않는다.
- **비밀번호 찾기가 없다.** 재설정 메일을 보낼 경로가 아직 없어서 만들 수 없다. 로그인
  화면의 「비밀번호를 잊으셨나요?」는 **안내만** 띄운다 — 눌러도 아무 일도 안 나는 버튼을
  놓으면 사람은 자기 손가락이나 앱을 의심하며 몇 번을 더 누른다.
- **임시 비밀번호로 발급된 계정은 `mustChangePassword: true` 로 시작한다.** 그 사람은 비밀번호를
  바꾸기 전에는 다른 화면으로 갈 수 없다. 막는 방법은 리다이렉트가 아니라 **스택에서 그 화면
  말고 아무것도 없게 하는 것**이다(`src/app/_layout.tsx` 의 `Stack.Protected`). 이 관문은 앱을
  껐다 켜도 살아 있어야 해서, 부팅 복구가 `GET /users/me` 의 같은 플래그로 단계를 되살린다.
- **이름 변경(`PATCH /users/me`)은 이번 범위가 아니다.**
- **비밀번호 변경 후 새 비밀번호로 다시 로그인한다.** 서버는 변경 시 기존 리프레시 토큰을
  모두 무효화하고 `204`만 반환한다. 앱은 기존 토큰을 지우고 로그인 화면에 완료 안내를
  표시한다. 다른 기기의 액세스 토큰은 최대 1시간 동안 유효할 수 있다.
- **일시적인 연결 장애로 저장된 세션을 지우지 않는다.** 부팅 중 프로필을 확인하지 못하면
  보호 화면을 열지 않고 로그인 안내를 보인다. 연결 복구 후 새로고침하면 저장된 세션을
  다시 확인한다. 인증 만료가 확인되거나 사용자가 로그아웃하면 토큰을 지운다.

## 인증 API 연동 상태

2026-09-16 기준, WAS 사용자 인증 구현과 앱 계약을 코드·OpenAPI 문서로 대조했다.

| API | 요청 | 성공 응답·앱 동작 |
| --- | --- | --- |
| `POST /auth/login` | `email`, `password` | `accessToken`, `refreshToken`, `expiresInSec`, `mustChangePassword`. 참이면 최초 변경 강제 |
| `POST /auth/refresh` | `refreshToken` | 토큰 세트. `mustChangePassword`는 포함하지 않음 |
| `POST /auth/change-password` | Bearer 인증, `currentPassword`, `newPassword` | `204`, 본문 없음. 앱 토큰 삭제 후 재로그인 안내 |
| `GET /users/me` | Bearer 인증 | `userId`, `email`, `userName`, `mustChangePassword`, `createdAt` |

앱 타입은 [src/types/api.ts](src/types/api.ts), 서버 스펙은
[jayeon-was/docs/openapi.yaml](../jayeon-was/docs/openapi.yaml)을 참고한다.
`INVALID_CREDENTIALS`는 입력 오류로 처리하며, 비밀번호 변경 중 이 오류가 나도 세션은 유지한다.
`UNAUTHORIZED`에는 토큰 재발급을 시도하고, 재발급 자격도 만료되었으면 로그아웃한다.
네트워크·타임아웃·서버 장애는 자격 오류와 구분한다.

## 남은 구현과 검증

- **실제 서버 통합 검증**: 앱 자동 테스트는 모의 응답 기반이다. 실제 WAS·에뮬레이터·초대
  계정으로 로그인 → 최초 변경 → 재로그인 → 세션 복구를 별도로 확인해야 한다.
- **Android 실기기 검증**: 웹뷰·SecureStore·앱 재실행 후 로그인 복구는 실기기 확인이 필요하다.
- **서비스 도메인 화면**: 현재 홈은 계정 확인·비밀번호 변경·로그아웃을 제공한다.
- **디자인 토큰**: `src/constants` 의 색·간격 값은 임시값이다. 디자인이 정해지면 바뀐다.
- **운영 배포 상태**: 이 문서 갱신에서는 클라우드 리소스의 실제 생성·배포 여부를 확인하지
  않았다. `redhead-terraform`과 [배포 체크리스트](docs/deploy.md)를 기준으로 확인한다.
