# 기기 내 통화 분석

Nature 네이티브 껍데기가 파일 선택, 다운로드, 오디오 변환, STT, 분석, SQLite 체크포인트 및 서버 동기화를 담당한다. 웹 화면은 명령을 브리지로 보내며 결과 탭 전환은 저장된 데이터만 읽는다. 일반 브라우저에서는 저장된 서버 결과만 조회할 수 있다.

## 엔진과 모델

- [whisper.rn 0.7.4](https://github.com/mybigday/whisper.rn): multilingual Whisper base, 한국어(`ko`) 고정. 원문 구간은 Whisper 10ms tick에서 초로 변환한다.
- [llama.rn 0.12.3](https://github.com/mybigday/llama.rn): Qwen3-0.6B Q8_0, 8,192 context, temperature 0, JSON schema grammar. Android CPU 2 threads, iOS Metal 99 layers. 더 큰 모델을 자동 선택하지 않는다.
- [Whisper 모델](https://huggingface.co/ggerganov/whisper.cpp/blob/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin): 147,951,465 bytes.
- [Qwen 모델](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/blob/23749fefcc72300e3a2ad315e1317431b06b590a/Qwen3-0.6B-Q8_0.gguf): 639,446,688 bytes.
- 합계 787,398,153 bytes(약 787MB). 배포 제공자의 고정 revision과 LFS SHA-256을 `call-models.ts`에 고정했다. 설치 버튼을 누를 때만 다운로드하며 파일 전체를 JS 메모리로 읽지 않고 native streaming SHA-256으로 검증한다.
- 전체 SHA-256은 설치 직후와 복구(=`manifest.json` 없음/불일치) 때만 계산한다. 설치 뒤 실행에서는 `manifest.json`의 revision·SHA·크기와 실제 파일 크기만 확인한다. 검증 프라미스를 공유해 검증 중 들어온 호출도 같은 결과를 기다린다.
- 백그라운드 전환으로 다운로드가 멈춘 것은 오류가 아니라 「설치가 멈췄어요. 다시 누르면 이어받습니다」 안내로, 저장 공간 부족은 필요한 용량을 밝힌 오류로 구분해 보여 준다.
- 최소 총 RAM 3GiB를 요구한다. 이 기준은 실행 게이트이며 한국어 품질·발열·속도 보증이 아니다. 설치 시 파일 용량 외 300MiB 여유를 검사한다. 원본 복사와 최대 120분 WAV에는 추가 저장 공간이 필요하다.

## 빌드

Expo Go로 실행할 수 없다. 기존 Expo prebuild 구조를 유지한다. Node 20에서 llama.rn 기본 플러그인의 ESM import가 실패해 `plugins/with-call-ai.cjs`에서 공개 Expo API로 C++20/proguard 설정을 적용한다.

```sh
npm ci
npx expo prebuild --platform android --no-install
npx expo run:android
# iOS 개발 환경 및 서명이 설정된 Mac
npx expo prebuild --platform ios
npx expo run:ios
```

`modules/nature-call-audio`는 Expo 로컬 모듈로 자동 연결한다. Android backup은 `allowBackup:false`로 비활성화한다(android 전용). APK/IPA에 모델 파일을 포함하지 않는다.

네이티브 모듈은 앱 컨테이너 밖 경로를 거부한다. Android는 `dataDir`/`filesDir`/`noBackupFilesDir`/`cacheDir`를 **양쪽 모두 canonical 경로로** 비교한다(`/data/user/0`가 `/data/data` 심링크인 기기에서 한쪽만 정규화하면 항상 실패한다). iOS는 `resolvingSymlinksInPath` 기준으로 홈 컨테이너 안인지 확인한다(`/var` → `/private/var`).

## 오디오와 처리 한계

m4a/mp3/wav/aac/3gp/ogg 확장자, 최대 500MiB 파일을 받는다. Android MediaExtractor/MediaCodec과 iOS AVAssetReader가 실제 코덱을 디코딩한 후 16kHz mono PCM16 WAV로 변환한다. 플랫폼이 지원하지 않는 컨테이너/코덱 조합(예: 일부 iOS Ogg)은 명시적 음성 변환 실패로 남는다. 최대 120분 제한이 있다. Android 변환은 bounded buffer와 선형 resampling을 사용하며 실제 녹음 품질 평가는 필요하다.

발화/문장 경계 기준 1,800자 chunk를 생성하고 선택 모델 tokenizer로 실제 5,300 token 이하인지 확인한다. 출력용 2,300 token과 템플릿 여유를 예약한다. 경계를 찾을 수 없는 지나치게 긴 발화는 조용히 자르지 않고 분석 실패로 처리한다. chunk 결과와 요약 통합 단계 각각을 저장한다. 할 일/결정/주제/상담항목은 구조적으로 합치고 완전 동일 중복만 제거한다. 의미가 비슷한 서로 다른 표현은 유지한다. 상대 날짜로 실제 날짜를 추측하지 않고 null을 사용한다.

## 복구와 개인정보

SQLite의 calls/transcripts/call_analyses/analysis_chunks/sync_status는 모든 쿼리를 인증 사용자 ID로 제한한다. 파일은 앱 전용 document storage(`documentDirectory/call-audio/`)에 복사한다. 원본 오디오 업로드 경로가 없다. 완료된 원문/분석 JSON만 Nature API로 전송한다. 출시 모드는 TLS를 요구한다. transcript 및 native exception 원문을 로그/브리지 오류에 넣지 않는다.

iOS의 `documentDirectory`는 기본 iCloud 백업 대상이다. 통화 원본 사본·WAV·모델 파일과 SQLite 디렉터리에는 네이티브 `excludeFromBackup`(= `isExcludedFromBackup`)을 설정해 백업에서 뺀다. 완료된 분석은 서버에 있으므로 백업 없이도 복원할 수 있다. Android는 `allowBackup:false`라 같은 호출이 no-op이다.

파일 경로는 `documentDirectory` 기준 **상대 경로**로 저장한다. iOS는 앱을 업데이트하면 컨테이너 UUID가 바뀌어 저장해 둔 절대 경로가 깨진다. 읽을 때 현재 `documentDirectory`와 결합한다(`file://`로 시작하는 옛 값은 그대로 쓴다).

업로드가 끝나면(`COMPLETED`) WAV와 원본 사본, `analysis_chunks`를 지운다. 사용자가 고른 원본 파일은 기기에 그대로 있고 완료된 통화를 다시 분석하는 경로가 없어, 지워도 재시도가 막히지 않는다. 원문과 분석 JSON은 SQLite에 남겨 조회할 수 있다.

브리지 입력은 화이트리스트로 재조립한다. `contact`는 `{name, phone, recipient_id?}`만 남기고 `recipient_id`는 `^[A-Za-z0-9_-]{1,128}$`로 검사한다(서버는 unknown field를 400으로 거부한다). 껍데기는 웹이 보낸 메시지 원문을 64KB로 제한한다.

화면을 이동해도 단일 직렬 작업자는 유지된다. 앱이 background로 전환되면 inference 중단을 요청하며 foreground 복귀/재실행 시 저장 단계부터 재개한다. OS가 무제한 background 실행을 제공한다고 가정하지 않는다. 실행 중인 STT 자체는 중단되어 다시 실행되지만 완료된 STT는 저장된다. LLM 실패는 저장된 원문부터, 업로드 실패는 JSON 업로드만 재시도한다. **재개는 foreground에서만 동작한다** — 60초 간격 점검도 앱이 활성 상태일 때만 돈다.

업로드는 실패 종류를 나눈다. 네트워크/5xx/401·403·408·429는 재시도 대상이며 `sync_status.retry_count`로 60초 → 최대 30분까지 간격을 벌린다(수동 재시도는 간격을 0으로 되돌린다). 그 밖의 4xx는 다시 보내도 같은 답이 오므로 `UPLOAD_REJECTED`로 끝내고 「분석 결과를 서버가 받지 못했습니다. 다시 분석해 주세요.」로 알린다. 이 상태는 자동 재시도 큐에 넣지 않으며, 사용자가 다시 시도하면 분석 결과와 chunk 캐시를 지우고 저장된 원문부터 다시 분석한다.

업로드 직전에 서버 계약을 그대로 확인한다. 공백 세그먼트를 버리고 `start`를 비감소로 맞추며 시각을 상한에 맞춘다. 남는 세그먼트가 없거나 세그먼트 수·세그먼트 길이·원문 용량 상한을 넘으면 조용히 자르지 않고 명시적으로 실패한다. 통화일시는 기기 시계 여유 5분까지만 인정하고, 미래 시각을 현재 시각으로 고정하지 않고 이유를 밝혀 거절한다. chunk 요약은 1,500자로 잘라 통합 단계가 context를 넘겨 영구 실패하지 않게 한다.

다운로드는 OS가 pause resumeData를 제공한 경우 이어받고 강제 종료로 체크포인트가 없으면 현재 파일을 다시 다운로드한다. 설치 완료한 다른 모델 파일은 다시 받지 않는다.

로그아웃/계정전환은 실행 generation을 무효화하고 이전 계정 결과를 새 계정으로 업로드하거나 브리지에 반환하지 않는다. 이 버전은 앱 데이터 삭제/개별 통화 삭제 UI를 추가하지 않는다.

## 검증

`npm run test:calls`는 JSON 계약/날짜/길이/중복 제거, 업로드 전 원문 정리(공백 세그먼트·비감소 start·상한), 업로드만 재시도, LLM 실패 후 STT 재사용, 분석 중 계정전환 차단, 400의 영구 실패 분류와 재분석 경로, 401의 재시도 유지, 업로드 백오프, contact 화이트리스트, 기기 시계 여유, 앱 재시작 후 `ANALYZING` 재개, 완료 후 정리를 검증한다. 타입 검사와 웹 빌드 검증을 별도로 수행한다. 실제 모델 다운로드·실기기 inference·한국어 평가 데이터 품질·RAM/열/배터리·장시간 실제 오디오·iOS 전체 native 빌드는 실기기 출시 전 확인해야 한다. 테스트용 가짜 분석 결과를 운영 코드에서 반환하지 않는다.
