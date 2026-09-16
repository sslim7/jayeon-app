# 배포

> 아래는 배포 절차와 사전 확인 항목이다. 리소스의 실제 생성·배포 여부는 이 문서만으로
> 판단하지 않고 `redhead-terraform`과 클라우드 상태를 확인한다.

## 브랜치 흐름

```
  작업 ──▶ staging ──(머지)──▶ release ──(v* 태그 push)──▶ Cloud Build ──▶ Cloud Run
           │                     │                          │
           기본 브랜치.          배포되는 커밋만            트리거 정규식
           main 은 삭제됨        여기로 올라온다            ^v.*$
```

- 모든 작업은 `staging` 에서 한다. (기본 브랜치이며 `main` 은 삭제됐다)
- 배포할 때 `staging` 을 `release` 로 머지한다.
- `release` 에 `v*` 태그를 붙여 푸시하면 트리거가 돌아 배포된다.

### 태그와 브랜치에 대해

Git 에서 **태그는 브랜치에 속하지 않는다.** 태그는 커밋 하나를 가리킬 뿐이라
"release 브랜치에 붙은 v 태그" 라는 조건 자체를 Cloud Build 가 표현할 수 없고,
트리거는 `^v.*$` 로 "v 로 시작하는 태그가 푸시됐다" 까지만 안다.

즉 실수로 `staging` 의 커밋에 `v0.2.0` 을 붙여 밀어도 **빌드는 똑같이 돈다.**
release 의 커밋에 태그를 붙이는 것은 도구가 막아 주는 일이 아니라
**사람이 지키는 규칙**이다.
(근거: `birdieup-terraform/modules/cicd/variables.tf` 의 `tag_regex` 주석)

## 배포 절차

```
git checkout release && git merge staging && git push
git tag v0.1.0 && git push origin v0.1.0
```

태그 이름은 `v` 로 시작하기만 하면 된다. 앞으로 같은 저장소에서 다른 대상(예: 소개 사이트)을
따로 배포하게 된다면 `^v.*$` 와 겹치지 않는 접두사를 써야 한다 — 앵커가 없으면 태그 하나가
빌드 두 개를 돌린다.

## 도메인이 붙는 경로

Cloud Run 앞에 Firebase Hosting 이 한 겹 있다. 바로 Cloud Run 을 가리키지 않는다.

```
jayeon.redhead.kr     ─(CNAME)─▶ redhead-jayeon-app.web.app ─(rewrite)─▶ Cloud Run jayeon-app
jayeon-api.redhead.kr ─(CNAME)─▶ redhead-jayeon-api.web.app ─(rewrite)─▶ Cloud Run jayeon-was
```

이 한 겹 때문에 이 저장소가 알아야 할 것이 둘 있다.

**1. 앞단에 프록시가 있다.** 그래서 `deploy/nginx.conf` 의 `gzip_proxied any` 가 반드시
필요하고(없으면 Via 헤더 때문에 압축이 통째로 안 걸린다), 캐시 헤더를 우리가 명시하지 않은
경로에는 Hosting 이 `private` 를 붙인다.

**2. `appAssociation` 이 `NONE` 이어야 앱 링크가 검증된다.** 기본값 `AUTO` 면 Firebase 가
`/.well-known/assetlinks.json` 을 **자기가 만든 빈 배열로 가로챈다.** 그러면 우리 nginx 의
`/.well-known/` 블록이 아무리 정확해도 요청이 거기까지 내려오지 않아, 앱 링크 검증이
조용히 실패한다. 이 값은 `redhead-terraform` 이 소유한다
(형제 프로젝트가 같은 벽에 부딪힌 기록: `birdieup-app/deploy/nginx.conf` 의 `/.well-known/` 주석).

## Cloud Build 가 하는 일

`cloudbuild.yaml` 의 3단계다.

1. **build** — `Dockerfile` 로 이미지를 만든다. 안에서 `npx expo export --platform web` 이
   돌아 `dist/` 가 나오고, 그걸 `nginx:alpine` 이미지에 얹는다(8080 포트).
   `EXPO_PUBLIC_*` 값이 `--build-arg` 로 들어가 **이때 번들에 박힌다.**
2. **push** — Artifact Registry 로 올린다. 태그는 `$COMMIT_SHA` 와 `latest` 둘 다.
3. **deploy** — `gcloud run deploy` 로 **이미지만 교체한다.**
   포트·IAM·환경변수·CPU·min-instances 같은 서비스 설정은 Terraform 이 소유한다.
   CI 가 같이 넘기면 두 곳이 서로 덮어써서 "배포하고 나니 설정이 사라졌다" 로 나타난다.
   설정을 바꿀 일은 Terraform 에서 한다.

빌드는 전용 배포 서비스 계정으로 돈다. 커스텀 SA 는 기본 로그 버킷에 쓸 수 없어
`options.logging: CLOUD_LOGGING_ONLY` 가 없으면 빌드가 시작조차 못 한다.

## 먼저 갖춰야 할 것

아래 표는 필요한 리소스 목록이다. 체크 표시는 현재 생성 상태를 보증하지 않는다.

이 인프라의 소유 저장소는 **`redhead-terraform`** 이다. `redhead.kr` 은 여러 앱이
서브도메인으로 사는 **우산 도메인**이라, DNS 존과 Artifact Registry 는 앱별 저장소가 아니라
`redhead-terraform` 한 곳이 소유한다 — 두 곳에서 같은 존에 쓰면 서로의 상태를 덮어쓴다.

참고 구현은 `birdieup-terraform/production/` 이다.

### 체크리스트

| | 항목 | 비고 |
| --- | --- | --- |
| ⏳ | **Cloud DNS 존 `redhead.kr` + 등록기관 NS 변경** | **여기부터 걸어라.** 체크리스트에서 **리드타임이 있는 유일한 항목**이다 — NS 전파에 수 시간이 걸리고, 그동안 도메인 매핑도 인증서 발급도 진행되지 않는다 |
| ☐ | GCP 프로젝트 + API 활성화 | Cloud Run, Cloud Build, Artifact Registry, Cloud DNS |
| ☐ | Artifact Registry 저장소 `redhead` (`asia-northeast3`) | 우산 도메인 아래 앱들이 공유한다 |
| ☐ | Cloud Run 서비스 `jayeon-app` / `jayeon-was` (`asia-northeast3`) | **Terraform 이 먼저 만들어야 한다.** `gcloud run deploy` 는 서비스가 없으면 자기가 기본 설정으로 만들어 버리는데, 그러면 포트·IAM·CPU 를 Terraform 이 아니라 CI 가 정한 상태가 되고 다음 apply 와 어긋난다 |
| ☐ | Firebase Hosting 사이트 `redhead-jayeon-app` / `redhead-jayeon-api` + 커스텀 도메인 | **Cloud Run 도메인 매핑은 `asia-northeast3` 에서 지원되지 않는다.** 남은 길은 External HTTPS LB(트래픽이 0이어도 전달 규칙 고정비 월 약 $18)와 Firebase Hosting(무료 + 관리형 SSL 무료) 둘뿐이라 Hosting 으로 간다 (근거: `birdieup-terraform/production/hosting.tf` 첫 줄). site_id 는 Firebase **전역** 유일값이라 프로젝트 접두어를 붙였다 |
| ☐ | Hosting rewrite 릴리스 (`redhead-terraform/scripts/hosting-release.sh`) | 🔴 **Terraform 이 올리지 않는다.** 프로바이더가 `appAssociation` 을 노출하지 않아 스크립트가 Hosting API 로 직접 올린다. 이 단계를 빼면 apply 는 성공하는데 도메인은 Firebase 기본 404 다 |
| ☐ | 배포용 서비스 계정 | Cloud Run 배포 · Artifact Registry 쓰기 · 로그 쓰기 |
| ☐ | GitHub 저장소 연결 | **Terraform 으로 만들 수 없다.** 콘솔에서 GitHub App 을 1회 설치해야 하고, 연결 전에 apply 하면 트리거 생성이 실패한다 (birdieup-terraform/production/cicd.tf 의 선행 조건과 같다) |
| ☐ | Cloud Build 트리거 2개 (`jayeon-app`, `jayeon-was`), `tag_regex = "^v.*$"` | 앱 트리거는 `_EXPO_PUBLIC_*` substitution 을 함께 넘겨야 한다 |

### 태그를 밀기 전에 끝나야 하는 순서

`redhead-terraform` 세션이 확인해 준 실제 순서다.

1. Cloud DNS 존 + **기존 메일 레코드 이전** — `redhead.kr` 은 지금 purelymail 로 메일을 쓰고
   있다. MX·SPF·DKIM·DMARC 를 옮기지 않은 채 NS 를 바꾸면 **메일이 끊긴다.**
2. 등록기관(가비아) 네임서버 변경 → 전파 수 시간. **리드타임이 있는 유일한 단계다.**
3. 콘솔에서 Cloud Build ↔ `sslim7/jayeon-app` GitHub 연결 (Terraform 불가, 1회 수동)
4. `apps/jayeon/` apply → Cloud Run · Hosting · 트리거 생성
5. `hosting-release.sh` 로 rewrite 릴리스 ← **이걸 빼면 도메인이 404 다**
6. 그 다음에야 `release` 에 `v*` 태그

### `redhead-terraform` 예상 구조

```
modules/          birdieup-terraform 에서 복사 (cicd, service-account, cloud-run 등)
shared/           redhead.kr DNS 존 · Artifact Registry `redhead` · 프로젝트 공통 설정
apps/jayeon/      Cloud Run 2개 · 도메인 매핑 · Cloud Build 트리거 2개 · 배포 SA
```

### 이 저장소가 인프라와 맺는 계약

`jayeon-app` 이 인프라에 대해 갖는 약속은 **셋뿐**이다. 나머지는 전부 Terraform 소관이다.

| 값 | 어디에 적혀 있나 |
| --- | --- |
| Artifact Registry 저장소 이름 `redhead` | `cloudbuild.yaml` 의 `_REPO` |
| Cloud Run 서비스 이름 `jayeon-app` | `cloudbuild.yaml` 의 `_SERVICE` |
| 트리거 정규식 `^v.*$` | 트리거 쪽(`redhead-terraform`). 이 저장소는 태그 이름 규칙으로 맞춘다 |

**이 셋이 어긋나면 배포가 조용히 실패한다.** 저장소 이름이 다르면 push 가 거부되고,
서비스 이름이 다르면 `gcloud run deploy` 가 엉뚱한 서비스를 새로 만들거나 실패하며,
정규식이 다르면 태그를 밀어도 아무 일도 일어나지 않는다(실패 알림조차 없다).

## 환경변수를 바꿀 때

🔴 `EXPO_PUBLIC_*` 는 **빌드 시점에 번들 안으로 인라인된다.**
Cloud Run 서비스의 환경변수를 고쳐도 브라우저가 받는 값은 그대로다 — 이미 만들어진 정적
파일을 nginx 가 내보낼 뿐이기 때문이다.

바꾸는 순서는 이렇다.

1. Cloud Build 트리거의 substitution 을 고친다 (`redhead-terraform` 에서 apply).
2. `cloudbuild.yaml` 의 `substitutions:` 에 그 이름이 **선언돼 있는지 확인한다.**
   🔴 선언이 없으면 트리거가 값을 줘도 빌드가 그 값을 무시한다. 형제 프로젝트에서
   트리거만 고치고 이 파일을 빼먹어 지도 기능이 통째로 꺼진 채 배포된 적이 있다
   (출처: `birdieup-app/cloudbuild.yaml` 주석, v1.27.0).
3. 새 태그를 밀어 다시 빌드한다. 재빌드 없이는 절대 반영되지 않는다.

## 롤백

두 가지 길이 있다.

**Cloud Run 리비전 되돌리기 (빠르다)** — 이전 리비전으로 트래픽을 옮긴다.
이미지를 다시 만들지 않으므로 몇 초면 끝난다.

```
gcloud run revisions list --service jayeon-app --region asia-northeast3
gcloud run services update-traffic jayeon-app --region asia-northeast3 --to-revisions <리비전이름>=100
```

단 이 상태는 Terraform 이나 다음 배포가 다시 덮어쓴다. **응급 처치로만 쓰고**,
원인을 고친 새 태그를 밀어 정상 상태로 돌아와야 한다.

**이전 태그로 다시 빌드 (정공법)** — 되돌릴 커밋에 새 태그를 붙여 민다.

```
git tag v0.1.1 v0.1.0^{commit}
git push origin v0.1.1
```

같은 태그를 지웠다 다시 미는 방법은 쓰지 마라. 태그가 가리키는 커밋이 바뀌면
"v0.1.0 이 무엇이었는지" 를 나중에 아무도 알 수 없다.
