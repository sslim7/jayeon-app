# 폰에서 받아쓰기 — 모델 조사 (2026-09-18)

## 왜 보나

통화 1건 원가 105원 중 **90원(85%)이 받아쓰기**다. 공급자를 바꿔서는 한 푼도 못 아낀다는
것이 이미 확인됐으므로(→ `jayeon-was/docs/llms.md`), 줄이는 길은 **받아쓰기를 폰에서
하는 것** 하나뿐이다. 그러면 서버는 분석만 하므로 **105원 → 13원**이 된다.

품질이 되는지는 이미 확인했다(→ `jayeon-was/docs/asr-comparison.md`): 맥북에서 돌린
`large-v3-turbo` 가 알리바바와 대등했다. 이 문서는 **그 품질을 폰에 넣을 수 있는 크기·속도로
낼 수 있는가**를 조사한 기록이다.

🔴 **전제가 바뀌었다는 것을 먼저 알아야 한다.** 예전에 폰 받아쓰기를 접었을 때는 787MB 안에
**받아쓰기 모델과 요약 모델을 둘 다** 넣어야 했다. 지금은 요약을 서버가 하므로 **그 용량
전부를 받아쓰기에 줄 수 있다.** 그때의 실패를 근거로 이 선택지를 버리면 안 된다.

---

## 1. 🔴 결정적 근거 — 한국어 「전화 통화」 벤치마크

**OpenKoASR 리더보드**, AIHub **저품질 전화망**(LowQualityTelephone) 39,916 샘플 전수.
낭독체가 아니라 **우리 조건과 같은** 데이터다.

| 모델 | CER | WER | 크기(f16) |
|---|---|---|---|
| whisper **large-v3** | **0.1062** | 0.2837 | 2.9GB |
| whisper **large-v3-turbo** | **0.1087** | 0.2882 | 1.5GB |
| qwen3-asr-1.7b | 0.1993 | 0.4445 | ~3.4GB |
| qwen3-asr-0.6b | 0.2437 | 0.5212 | ~1.2GB |
| whisper medium | 0.3017 | 0.5637 | 1.5GB |
| whisper **small** ← 예전 폰이 쓰던 급 | **0.3358** | 0.6126 | 466MB |
| whisper base | 0.4344 | 0.7466 | 142MB |
| whisper tiny | 0.5404 | 0.8429 | 75MB |

출처: https://gt-kim.github.io/open-korean-automatic-speech-recognition/leaderboard.md (2026-09-18 확인)

**읽는 법 셋:**

1. **turbo 는 large-v3 대비 오류가 2.4%만 늘어난다.** 크기는 절반인데. 맥북 실측(9,863자 vs
   알리바바 9,976자)과 정확히 맞아떨어진다.
2. 🔴 **small → turbo 는 CER 0.336 → 0.109, 오류가 3분의 1이다.** 「더메이」가 「도매」가 되고
   「아저씨」가 「저시」가 된 이유가 여기 있다. **체급 문제라 프롬프트로 메울 수 있는 수준이
   아니었다.**
3. 🔴 **중간 선택지가 없다.** medium(0.3017)부터 이미 무너진다. 「적당히 작은 모델로 타협」이라는
   길은 이 데이터에 존재하지 않는다 — large 계열이거나 포기거나 둘 중 하나다.

⚠️ **Qwen3-ASR 오픈소스판(0.6B/1.7B)은 이 조건에서 Whisper 보다 크게 나쁘다**(0.2437 / 0.1993).
서버에서 쓰는 알리바바 `qwen-audio-3.0-asr-flash` 와 **이름만 비슷할 뿐 다른 물건이다.**
낭독체(Fleurs-ko CER 3.72%)에서는 좋아 보이는데 전화 음성에서 무너진다 — **낭독체 점수에
속으면 안 되는 대표 사례다.**

---

## 2. 한국어 파인튜닝 모델 — 권하지 않는다

실재를 확인한 것(2026-09-18, HuggingFace API 로 파일 실물 확인):

| 저장소 | 내용 | 점수 | 주의 |
|---|---|---|---|
| `royshilkrot/whisper-large-v3-turbo-korean-ggml` | zeroth-korean + STT_Korean_Dataset_80000, ~102k 문장 | WER 24 → 16 | Apache-2.0. 평가셋 불명시 |
| `JoaoZaokk/whisper-large-v3-turbo-korean-ggml` | 위 모델의 GGML 변환판. f16 1,625MB / q8_0 874MB / q5_0 574MB / q4_0 474MB | 자체 측정 없음 | **2026-09-12 생성, 다운로드 0회 — 전혀 검증 안 됨** |
| `ghost613/whisper-large-v3-turbo-korean` | zeroth-korean 206시간 | val CER 1.78% | zeroth **자체 test셋** 점수. 작성자가 "수렴 안 됨" 명시 |

🔴 **셋 다 학습·평가가 전부 `zeroth-korean`(낭독체 고음질)이다.** CER 1.78% 는 「낭독체를
낭독체로 평가」한 숫자라 전화 통화에 적용되지 않는다. 오히려 **낭독체 단일 도메인에
과적합되어 전화 대화체에서 원본보다 나빠질 위험**이 실재한다.

전화·대화체로 파인튜닝된 공개 한국어 Whisper 는 **찾지 못했다.**

→ **원본 turbo 로 먼저 가고**, 파인튜닝판은 같은 통화로 A/B 해 본 뒤에만 고려한다.

### 그 밖에 검토하고 버린 것

| 모델 | 이유 |
|---|---|
| NVIDIA Parakeet TDT 0.6B v3 | **한국어 없음**(영어 + 유럽 24개어). whisper.rn 이 이미 내장 지원하지만 무의미 |
| Qwen3-ASR 0.6B/1.7B | 전화 CER 2배 나쁨 + **오디오 5분 제한** |
| Moonshine tiny-ko (27M) | 전화 측정치 없음(전부 낭독체), 라이선스 `other` 불명확, 모델 카드가 환각·반복 경향 명시 |
| NVIDIA Canary / Riva | 서버(NIM/Riva) 전용, 온디바이스 경로 없음 |
| Meta MMS / SeamlessM4T | 전화 한국어 벤치마크 없음, 경량 온디바이스 경로 없음 |
| 네이버 CLOVA / 리턴제로 / 카카오 | **폰에 넣을 수 있는 공개 가중치를 공개한 국내 업체를 찾지 못했다.** 전부 API·온프레미스 서버 |

---

## 3. 속도 — 예상보다 낙관적이다

whisper.rn 이 **2026-09-17(조사 하루 전)** 갤럭시 Hexagon NPU 백엔드를 머지했다(PR #337).
그 PR 본문의 **Galaxy S25 Ultra** 실측(30초 청크 1회, ms):

| 모델 | 인코더 | 디코더(토큰당) |
|---|---|---|
| small-q8_0 | 164.13 | 7.24 |
| medium-q8_0 | 372.72 | 21.90 |
| **large-v3-turbo** | **1010.32** | 7.46 |
| **large-v3-turbo-q8_0** | **946.34** | 7.12 |

> PR 원문 주석: **"q5_0 / q5_1 are not supported in ggml-hexagon (will fallback to cpu)"**

출처: https://github.com/mybigday/whisper.rn/pull/337 (2026-09-18 확인)

28분 26초(1,706초) 러프 추정: 30초 청크 57개 × 946ms ≈ 인코더 54초, 디코더 6,000~8,000토큰
× 7.12ms ≈ 43~57초 → **합계 1분 40초 ~ 2분.**

⚠️ **이 추정을 믿지 마라.** mel 추출·temperature 재시도·VAD·파일 I/O 가 빠져 있고, 발열
스로틀링도 미반영이다. 표의 `Config` 열이 전부 `NEON` 이라 **이 수치가 NPU 경로인지 CPU
경로인지 PR 본문만으로는 단정할 수 없다.** **현실적 기대치는 2~5분**으로 잡고 실측한다.

### 🔴 예전 폰 실패를 다시 해석해야 한다

이 조사 중에 잰 「whisper.cpp `small`, **CPU 1스레드**, 120초 오디오 → 149초」(실시간보다 느림)는
위 표의 small 인코더 165.76ms/30초청크와 **수십 배** 차이가 난다. 즉 그 측정은 **설정이 나쁜
조건**이었고, 예전 폰 받아쓰기 실패도 모델 크기뿐 아니라 **스레드·백엔드 설정 문제였을
가능성이 있다.** 이것도 재측정 대상이다.

---

## 4. 🔴 고유명사 프롬프트 — 함정이 있다

기준선 실패가 전부 고유명사였다. 회사명 「더메이」와 상담사 이름은 **매번 나오는 고정값**이라
미리 알려 줄 수 있다.

**whisper.cpp 는 hotword/biasing API 가 없다.** 전용 API 요청(issue #1979)은 *closed as not
planned* 로 닫혔다. 쓸 수 있는 것은 셋뿐이다:

1. `--prompt` (initial prompt) — 지원됨
2. `--grammar` (GBNF) + `--grammar-penalty` — 자유 발화 전사엔 부적합
3. 모델 밖 후처리 교정 테이블 — 「도매」→「더메이」 치환

### 함정: 28분 통화에서 프롬프트는 첫 30초에만 걸린다

whisper.cpp 소스 확인 결과, `carry_initial_prompt` 가 `false`(기본값)면 initial prompt 가
롤링 컨텍스트에 밀려 **이후 창에서 사라진다.** `true` 여야 모든 30초 창에 계속 주입된다.

🔴 **그런데 whisper.rn 의 `TranscribeOptions` 에 `carryInitialPrompt` 가 없다.** 노출된 것은
`prompt`, `beamSize`, `bestOf`, `maxContext`, `temperature`, `maxThreads`, `maxLen`,
`tokenTimestamps`, `tdrzEnable` 등이다.

**우회책 둘** (측정해서 고른다):
- **(a)** JS 에서 오디오를 청크로 잘라 각각 transcribe 하며 **매번 같은 prompt 전달.** 코드 수정
  없이 가능. 청크 경계에서 문장이 끊기므로 경계를 무음 지점으로 잡으면 완화된다.
- **(b)** whisper.rn 에 `carryInitialPrompt` 옵션 추가 패치. 네이티브 한 줄 + 타입 한 줄 수준.
  업스트림 PR 가치가 있다.

### ⚠️ 프롬프트의 부작용

initial prompt 는 「부드러운 힌트」가 아니라 **강한 의미적 제약**으로 작동해, 오디오에 없는
표현을 넣는 **환각과 반복 루프**를 유발한다. **일본어·한국어에서 반복 환각 보고가 특히 많다.**
프롬프트가 문어체면 「어…」 같은 간투사를 생략하는 경향도 있어 **구어체로 쓰는 편**이 낫다.
권장 길이는 20~100 토큰의 고관련 어휘.

→ 프롬프트 **있음/없음 두 버전을 같은 통화로 비교한 뒤** 채택한다. 회사명 목록이 확정적이면
후처리 교정 테이블을 병행하는 편이 안전하다.

---

## 5. 화자 분리 — 35MB 로 해결된다

**이 발견으로 「타협 불가」 전제가 풀린다.** 원래 화자 분리 때문에 Groq(68% 저렴)을 탈락시켰고
서버 ASR 을 못 바꾼다고 판단했는데, 폰에서 붙일 수 있다.

**sherpa-onnx**(k2-fsa) 오프라인 화자분리. 세그멘테이션 + 임베딩 2단:

| 역할 | 모델 | 크기 |
|---|---|---|
| 화자 세그멘테이션 | `sherpa-onnx-pyannote-segmentation-3-0` | **6.6MB** |
| 화자 임베딩 | `3dspeaker_speech_campplus_sv_zh_en_16k` | **27.0MB** |

- **언어 무관** — 음향 특징 기반이라 한국어와 상관없다
- 안드로이드 공식 지원(전용 APK 배포 중), React Native 바인딩 `react-native-sherpa-onnx`
  v0.4.4 (MIT, 2026-09-08) 존재. ⚠️ 서드파티라 검증은 직접 해야 한다
- ⚠️ Whisper 세그먼트 타임스탬프와 sherpa 화자 구간을 **병합하는 로직은 직접 짜야 한다**
  (공개 RN 레퍼런스 없음)

❌ **whisper.cpp tinydiarize(`-tdrz`)는 쓰지 마라.** whisper.rn 에 `tdrzEnable` 이 있지만
**`small.en` 영어 전용 모델**이 필요하고, 「화자가 바뀜」만 표시할 뿐 **같은 사람을 파일
전체에서 묶지 못한다.**

참고: 이번 비교에서 **화자 분리 없이도 LLM 이 대화 흐름으로 상담원과 고객을 갈라 요약했다.**
즉 화자 분리는 **있으면 좋은 것**이지 필수가 아닐 수 있다(→ `asr-comparison.md`).

---

## 6. 추천안

### 1순위 — `large-v3-turbo` **q8_0** (약 874MB) + whisper.rn + Hexagon NPU + 고유명사 프롬프트

| 항목 | 값 |
|---|---|
| 크기 | 약 874MB. 앱 번들이 아니라 **최초 실행 시 다운로드** |
| 한국어 전화 CER | 0.1087 (원본 f16 기준. 양자화 손실은 한국어 미측정) |
| 속도 | **2~5분 추정, 측정 필요** |
| 라이선스 | 모델 MIT / whisper.rn MIT / whisper.cpp MIT — **상업 이용 가능** |
| 화자분리 | 별도 sherpa-onnx +35MB |

🔴 **q5_0(547MB)이 아니라 q8_0 을 고르는 이유**: ggml-hexagon(NPU)이 q5 를 지원하지 않아
**CPU 로 폴백**한다. 속도가 병목이므로 300MB 를 내주고 NPU 를 사는 것이 맞다. NPU 가 실측에서
효과 없으면 그때 q5_0 으로 내려가면 된다.

⚠️ **q4_0(474MB)은 피한다.** 영어 기준으로도 WER +4.9% 가 통계적으로 유의하게 나타나는
지점이고(p=0.001), **고유명사처럼 저빈도 토큰이 양자화에 먼저 깨진다.** 양자화 손실 측정
(whisper large-v3, LibriSpeech test-clean): F16 5.35% / Q8_0 5.25% / Q5_0 5.19% / **Q4_0 5.61%**.
출처: https://github.com/yoarajota/whisper-quantization-wer-degradation
⚠️ 이건 **영어 낭독체** 측정이다. 한국어·전화 음성의 양자화 손실은 **확인 불가**.

### 정직한 대가

- **크기**: 앱이 874MB 무거워진다. 오늘 기기 AI 모듈을 걷어내 239MB → 134MB 로 줄인 것을
  상당 부분 되돌리는 셈이다. Play Store 번들 한도 때문에 최초 실행 다운로드가 사실상 유일한 길.
- **속도**: 서버 1분 38초 → 폰 2~5분. 즉시성은 확실히 손해다. 백그라운드 처리 + 완료 알림
  UX 가 필요하다.
- **정확도**: 알리바바와 대등할 가능성이 높지만, **양자화 + 폰 스레드 제약**이 붙은 상태의
  한국어 정확도는 **아무도 측정한 적이 없다.**
- **배터리·발열**: 28분 통화를 수 분간 풀로드. 미측정.

### 2순위 / 3순위

- **2순위**(1순위가 느리면): q5_0 (547MB, CPU 8스레드). NPU 를 포기하고 크기를 줄인다.
- **3순위**(정확도가 부족하면): 한국어 파인튜닝 turbo q8_0. **반드시 같은 통화로 A/B 후** 채택.

---

## 7. 측정 목록 — 권장 순서 ③ → ④ → ① → ②

🔴 **①②는 폰이 필요하지만 ③④는 맥북에서 오늘 할 수 있다.** 여기서 「q8_0 + 프롬프트로
충분」이 확인되면 폰 작업이 단순 이식 문제로 줄어든다.

| # | 측정 | 방법 |
|---|---|---|
| ③ | **한국어 양자화 손실** | 같은 통화를 맥북에서 f16 / q8_0 / q5_0 / q4_0 로 전사하고 **f16 을 정답 삼아 CER 계산.** 10분이면 끝난다. **이 하나로 「874MB 면 충분한가」가 결정된다.** |
| ④ | **고유명사 프롬프트 효과** | ⓐ 프롬프트 없음 ⓑ 회사명·인명 프롬프트(단일 호출) ⓒ 청크 분할 + 매 청크 프롬프트 반복. 「더메이」「아저씨」「마지노선」의 정오를 직접 센다. **ⓑ와 ⓒ 차이가 곧 `carryInitialPrompt` 패치의 가치다.** 환각·반복이 늘지 않았는지도 함께 본다 |
| ① | **폰 실측 속도** | whisper.rn 의 `bench()` API(`[config, nThreads, encodeMs, decodeMs, batchMs, promptMs]` 반환). q8_0 / q5_0 × `useGpu` true/false 4조합. 가장 싸고 빠른 첫 실험 |
| ② | **28분 전체 처리·발열** | 원본을 16kHz 모노 WAV 로 변환해 실기기 end-to-end 1회. 배터리·스로틀링 포함 |
| ⑤ | **NPU 실효성** | ①에서 `NativeWhisperContext.gpu` / `reasonNoGPU` 확인. 안 잡히면 `libcdsprpc.so` 매니페스트 선언 필요(whisper.rn README) |
| ⑥ | 파인튜닝판 A/B | 맥북에서 먼저 거른다 |
| ⑦ | 화자분리 정확도 | sherpa-onnx 예제를 맥북에서 같은 통화에 돌려 알리바바 0/1 결과와 비교. 폰 통합은 통과 후 |

---

## 확인 불가로 남은 것

- 한국어(특히 전화 음성)에서의 GGML **양자화별 CER** — 공개 측정치 없음
- Galaxy S 계열에서 `large-v3-turbo` 로 **장시간 오디오**를 처리한 공개 실측 — 30초 벤치만 존재
- 전화·대화체로 파인튜닝된 공개 한국어 Whisper — 없음(전부 zeroth 낭독체)
- Qualcomm AI Hub 의 Whisper-Large-V3-Turbo Galaxy S24/S25 수치 — 페이지에 "Not supported"
- 국내 업체의 온디바이스 공개 모델 — 없음
- Moonshine tiny-ko 의 정확한 라이선스 조건

## 주요 출처 (전부 2026-09-18 확인)

- OpenKoASR 리더보드: https://gt-kim.github.io/open-korean-automatic-speech-recognition/
- whisper.cpp: models/README.md · examples/cli/README.md · src/whisper.cpp · issue #1979
- whisper.rn: PR #337(S25 Ultra 벤치) · src/NativeRNWhisper.ts · README
- 양자화 WER: https://github.com/yoarajota/whisper-quantization-wer-degradation
- HuggingFace: royshilkrot / JoaoZaokk / ghost613 의 korean turbo, Qwen/Qwen3-ASR-0.6B, moonshine-tiny-ko
- sherpa-onnx: https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/ · npm react-native-sherpa-onnx
- 프롬프트 환각: https://github.com/openai/whisper/discussions/1992
