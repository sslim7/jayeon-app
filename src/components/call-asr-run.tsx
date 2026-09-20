/**
 * 폰에서 받아쓰는 화면 — **등록과 서버 사이의 나머지 절반.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이 화면이 끝까지 가지 못하면 통화는 실패한다.** `asr: "client"` 로 등록된 통화는  │
 * │ 서버가 받아쓰기를 하지 않고 기다린다. 6시간 안에 전사문이 닿지 않으면 서버가           │
 * │ `TRANSCRIPTION_FAILED` + `CLIENT_TRANSCRIPT_TIMEOUT` 으로 정리한다.               │
 * │ ⚠️ 다만 **늦게 도착한 전사문도 받아 준다** — 타임아웃을 봤다고 포기하지 않는다.        │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * # 이 화면이 지키는 세 가지
 *
 * ① **진행률을 지어내지 않는다.** 막대는 `runLocalAsr` 의 `onProgress` 가 준 값만 쓴다.
 *    변환 단계는 진행률을 낼 수 없어 **막대를 그리지 않는다**(→ `docs/call-analysis.md`).
 * ② **끊겨도 잃는 것은 2분이다.** 엔진이 120초 청크마다 디스크에 남긴다. 다시 열면 그
 *    지점부터 이어간다 — 「처음부터 다시」와 「포기」는 사용자가 고른다.
 * ③ **다 받아쓴 글을 잃지 않는다.** 보내기 직전에 디스크에 적고(→ `lib/asr-pending.ts`),
 *    서버가 200 을 준 뒤에 지운다. 전송에 실패해도 다음에 열면 그 글부터 보낸다.
 *
 * ⚠️ **앱이 백그라운드로 가면 멈춘다.** iOS 는 백그라운드 앱에 CPU 를 주지 않는다. 막을 수
 * 없으므로 **멈췄다는 것과 이 화면으로 돌아와야 이어진다는 것**을 말해 준다 — 조용히 멈춰
 * 있으면 사용자는 끝난 줄 안다.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ButtonRow, Loading, Notice, ProgressBar, SmsButton, SmsPage, s } from '@/components/sms-ui';
import { colors, fonts, spacing, text as textSize } from '@/constants/theme';
import { callWavExists, clearCallWav, convertCallToWav, durationLabel } from '@/lib/asr-audio';
import { loadAsrCapability } from '@/lib/asr-capability';
import { asrDurationLabel } from '@/lib/asr-capability-types';
import { asrEta, asrEtaSample, asrRemainingMs, type AsrEtaMark, type AsrEtaSample } from '@/lib/asr-eta';
import {
  clearAsrLocalState, loadAsrLocalState, runLocalAsr,
  type AsrLocalInput, type AsrLocalProgress, type AsrLocalSegment, type AsrLocalState, type AsrLocalStop,
} from '@/lib/asr-local';
import { ASR_MODELS, modelStatus, type AsrModelId } from '@/lib/asr-models';
import { asrFailurePlan, asrResumePlan } from '@/lib/asr-outcome';
import { clearPendingTranscript, loadPendingTranscript, savePendingTranscript } from '@/lib/asr-pending';
import { asrThreads } from '@/lib/asr-threads';
import { callAudioNativeAvailable, cpuCores } from '@/lib/call-native';
import { failureCode } from '@/lib/call-errors';
import { ALREADY_DONE, sendCallTranscript, TranscriptSendError } from '@/lib/call-transcript';

export type CallAsrRunProps = {
  callId: string;
  /** 등록 시트가 고른 모델. 이어하기로 열었을 때는 **저장된 상태의 모델이 이긴다.** */
  model?: string;
  /** 사용자가 고른 원본. 이어하기로 다시 열면 없을 수 있다(저장된 상태가 대신한다). */
  sourceUri?: string;
  sourceName?: string;
  sourceBytes?: number;
};

/** 지금 무엇을 하고 있나. 🔴 **하나뿐인 진행 상태다** — 두 군데서 따로 들면 어긋난다. */
type Phase = 'loading' | 'converting' | 'transcribing' | 'sending' | 'done' | 'stopped' | 'failed';

const KEEP_AWAKE_TAG = 'asr-run';

/** 멈춘 이유를 사람 말로. 🔴 **「돌아와야 이어진다」를 반드시 말한다.** */
const STOP_TEXT: Record<AsrLocalStop, string> = {
  done: '',
  canceled: '받아쓰기를 멈췄습니다. 끝낸 부분은 남아 있어 이어서 할 수 있어요.',
  background: '앱이 화면 밖으로 나가 받아쓰기가 멈췄습니다. 폰은 화면 밖의 앱에 계산을 맡기지 않아요 — 이 화면에서 「이어서 받아쓰기」를 눌러야 다시 돕니다.',
  interrupted: '받아쓰기가 예상하지 못한 이유로 멈췄습니다. 끝낸 부분은 남아 있어 이어서 할 수 있어요.',
};

export function CallAsrRun({ callId, model, sourceUri, sourceName, sourceBytes }: CallAsrRunProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState<AsrLocalProgress | null>(null);
  const [saved, setSaved] = useState<AsrLocalState | null>(null);
  /** 보내야 할 원문. 🔴 이 값이 비어 있지 않은 동안에는 디스크에도 같은 글이 있다. */
  const [body, setBody] = useState('');
  /**
   * 그 원문의 구간들 — **통화 원문 화면이 대화로 그릴 유일한 근거다**(→ `lib/call-transcript.ts`).
   *
   * ⚠️ **`body` 와 달리 디스크에 남지 않는다.** 보험 파일(`lib/asr-pending.ts`)은 글만 담는
   * 형식이라, 앱이 전송 전에 죽으면 다음에 열었을 때 글만 다시 보낸다. 그 통화는 화면에서
   * 한 덩어리로 보인다(안전망은 있다) — 잃는 것은 시각뿐이고 말은 아니다.
   */
  const [parts, setParts] = useState<AsrLocalSegment[]>([]);
  const [stopped, setStopped] = useState<AsrLocalStop | null>(null);
  /**
   * 실패 코드 하나. 🔴 **영구/재시도 판정을 여기 들고 있지 않는다** — 그 판단은 원문이 손에
   * 있는지에 따라 달라지므로 `lib/asr-outcome.ts` 가 매번 다시 내린다(경로 오류가 그 예다).
   */
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  /** 「받아쓰기를 건너뛰고 보내기부터 합니다」. 🔴 조용히 건너뛰면 화면이 멈춘 것처럼 보인다. */
  const [resumeNote, setResumeNote] = useState('');
  /** 전송만 실패한 상태의 「처음부터 다시」는 되돌릴 수 없다. 한 번 더 묻는다. */
  const [restarting, setRestarting] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [backgrounded, setBackgrounded] = useState(false);
  /** 끝난 청크들의 실측 소요 시간. 🔴 남은 시간 추정의 **본 자료**다(→ `lib/asr-eta.ts`). */
  const [samples, setSamples] = useState<AsrEtaSample[]>([]);
  /** 저장된 판정의 벤치 인코더 시간. 첫 청크가 끝나기 전까지의 유일한 근거다. */
  const [encodeMs, setEncodeMs] = useState<number | null>(null);
  /** 「포기」는 되돌릴 수 없다. 한 번 더 묻는다. */
  const [quitting, setQuitting] = useState(false);

  const cancelRef = useRef<(() => void) | null>(null);
  /** 두 번 도는 것을 막는다. 같은 WAV 에 세션 두 개를 열면 메모리가 먼저 무너진다. */
  const lock = useRef(false);
  /** 이번 단계가 시작된 시각. 경과 시간의 유일한 근거다. */
  const startedAt = useRef(0);
  /** 지금 도는 청크를 언제부터 재고 있나. 청크 번호가 넘어가는 순간 표본 하나가 된다. */
  const mark = useRef<AsrEtaMark | null>(null);

  const threads = useMemo(() => asrThreads(cpuCores()), []);
  const supported = Platform.OS !== 'web' && callAudioNativeAvailable();
  const busy = phase === 'converting' || phase === 'transcribing' || phase === 'sending';

  /**
   * 🔴 **처리 중에 화면이 꺼지면 받아쓰기가 멈추고 사용자는 7분을 다시 기다린다.**
   * 도는 동안에만 깨워 둔다 — 항상 켜 두면 이 화면을 열어 둔 사람의 배터리를 태운다.
   */
  useEffect(() => {
    if (!busy) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    // ⚠️ 프라미스를 돌려주는 함수다. catch 를 달지 않으면 화면을 떠날 때 처리되지 않은 거절이 뜬다.
    return () => { void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}); };
  }, [busy]);

  /**
   * 경과 시간. 🔴 **실제로 흐른 시간만 센다** — 진행률과 달리 이 값은 지어낼 여지가 없다.
   *
   * ⚠️ 시작 시각은 ref 에 둔다. 효과 안에서 곧바로 `setState` 를 부르면 렌더가 한 번 더
   * 도는데(react-compiler 규칙), 그 한 번이 여기서는 아무것도 바꾸지 않는다.
   */
  useEffect(() => {
    if (phase !== 'converting' && phase !== 'transcribing') return;
    startedAt.current = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 500);
    return () => clearInterval(timer);
  }, [phase]);

  /**
   * 화면을 떠나면 반드시 멈춘다.
   *
   * 🔴 **834MB 짜리 모델이 열려 있다.** 뒤로 나간 뒤에도 그대로 돌게 두면 OS 가 앱을 죽이고,
   * 그 죽음은 다른 화면에서 일어나 원인이 전혀 드러나지 않는다. 멈춰도 끝낸 청크는 디스크에
   * 남아 있어 다시 들어오면 그 지점부터 이어간다(→ `lib/asr-local.ts`).
   */
  useEffect(() => () => { cancelRef.current?.(); }, []);

  /**
   * 화면 밖으로 나갔다는 사실을 **기록만** 한다. 막을 수는 없다.
   *
   * ⚠️ **멈춤 판정과 시간 재기는 기준이 다르다.** 엔진은 `background` 에서만 멈춘다 —
   * `inactive`(전화가 왔거나 알림 센터를 내린 상태)에서는 CPU 가 계속 도는 경우가 있어
   * 거기서 멈추면 멀쩡한 청크를 버린다. 반대로 **시간을 재는 쪽은 의심스러우면 버리는 편이
   * 싸다**: 표본 하나를 잃으면 앞선 표본이나 판정으로 답하면 되지만, 얼어 있던 시간이 한 번
   * 섞이면 그 뒤 몇 분 동안 틀린 숫자를 보여 준다.
   */
  useEffect(() => {
    if (!busy) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && mark.current) mark.current = { ...mark.current, paused: true };
      if (state === 'background') setBackgrounded(true);
    });
    return () => sub.remove();
  }, [busy]);

  /**
   * 진행 보고 하나를 받는다 — **여기가 남은 시간의 유일한 자료다.**
   *
   * 🔴 청크 번호가 하나 올라간 순간이 「방금 청크가 끝났다」는 유일한 신호다. 엔진은 청크를
   * 저장한 직후 `report(null)` 을 부르고, 그때 `chunkIndex` 가 올라간다(→ `lib/asr-local.ts`).
   * ⚠️ 그래서 **엔진의 저장 형식은 더하기만 한다** — 실기기에 진행 중인 작업이 남아 있어,
   * 기존 필드의 뜻을 바꾸면 그 작업들이 통째로 버려진다(→ `lib/asr-local-types.ts` 의 `segments`).
   */
  const track = useCallback((next: AsrLocalProgress) => {
    setProgress(next);
    const now = Date.now();
    const previous = mark.current;
    if (previous && previous.index === next.chunkIndex) return;
    if (previous) {
      const sample = asrEtaSample(previous, next, now);
      if (sample) setSamples((all) => [...all, sample]);
    }
    mark.current = { index: next.chunkIndex, startedAt: now, paused: false };
  }, []);

  const fail = useCallback((code: string) => {
    setFailure(code);
    setPhase('failed');
  }, []);

  /**
   * 받아쓴 글을 서버로. **다시 보내도 안전하다**(서버가 멱등을 보장한다).
   *
   * 🔴 `CALL_ALREADY_COMPLETED` 는 **실패가 아니다.** 앞선 시도가 실제로는 닿았던 경우인데,
   * 그것을 빨간 글씨로 그리면 사용자는 끝난 일을 계속 다시 누른다.
   */
  const deliver = useCallback(async (transcript: string, segments: AsrLocalSegment[]) => {
    setPhase('sending');
    setFailure(null);
    try {
      await sendCallTranscript(callId, transcript, segments);
    } catch (error) {
      if (!(error instanceof TranscriptSendError) || error.code !== ALREADY_DONE) {
        fail(error instanceof TranscriptSendError ? error.code : failureCode(error));
        return;
      }
      setNotice('서버에는 이미 이 통화의 원문이 들어가 있었습니다. 더 보내지 않아도 됩니다.');
    }
    // 🔴 **200 을 받은 뒤에만** 보험을 지운다. 55MB WAV 도 여기서 걷는다.
    await clearPendingTranscript(callId).catch(() => {});
    await clearCallWav(callId).catch(() => {});
    setPhase('done');
  }, [callId, fail]);

  /** 깔려 있는 모델 하나. 등록 때 고른 것이 없으면 남아 있는 것으로 돈다. */
  const pickModel = useCallback(async (preferred?: string): Promise<AsrModelId | null> => {
    const wanted = ASR_MODELS.find((item) => item.id === preferred);
    if (wanted && (await modelStatus(wanted)).installed) return wanted.id;
    for (const item of ASR_MODELS) if ((await modelStatus(item)).installed) return item.id;
    return null;
  }, []);

  /**
   * 이번에 돌릴 입력을 만든다 — **이어할 수 있으면 저장된 것으로, 아니면 변환부터.**
   *
   * 🔴 저장된 상태가 있어도 **WAV 가 사라졌으면 이어갈 수 없다.** 변환본은 캐시에 있고
   * OS 가 언제든 지운다. 그때 경로만 믿고 이어가면 whisper 가 없는 파일을 읽는다.
   */
  const prepare = useCallback(async (fresh: boolean): Promise<AsrLocalInput | null> => {
    const previous = fresh ? null : await loadAsrLocalState(callId);
    if (previous && (await callWavExists(callId))) {
      setSaved(previous);
      return {
        callId, wavUri: previous.wavUri, sourceName: previous.sourceName,
        sourceBytes: previous.sourceBytes, modelId: previous.modelId, totalMs: previous.totalMs,
      };
    }
    // 이어갈 수 없다. 원본이 없으면 여기서 끝이다 — 없는 파일을 지어낼 수는 없다.
    if (!sourceUri) { fail('ASR_AUDIO_MISSING'); return null; }
    // 쓸 수 없게 된 상태를 남겨 두면 다음에 열었을 때 또 이어가려 든다.
    await clearAsrLocalState(callId).catch(() => {});
    setSaved(null);

    const modelId = await pickModel(model);
    if (!modelId) { fail('ASR_MODEL_MISSING'); return null; }

    setPhase('converting');
    const name = sourceName?.trim() || '녹음';
    const bytes = typeof sourceBytes === 'number' && Number.isFinite(sourceBytes) ? sourceBytes : 0;
    let wav;
    try {
      wav = await convertCallToWav(callId, { name, uri: sourceUri, bytes });
    } catch {
      // ⚠️ 네이티브 예외에는 파일 경로가 섞인다. 코드만 남긴다(→ `lib/call-errors.ts`).
      fail('ASR_CONVERT_FAILED');
      return null;
    }
    // 길이를 모르면 청크를 나눌 수 없고, 진행률의 분모도 없다. 0 을 지어내지 않는다.
    if (!(wav.seconds > 0)) { fail('ASR_CONVERT_FAILED'); return null; }
    return { callId, wavUri: wav.uri, sourceName: name, sourceBytes: bytes, modelId, totalMs: Math.round(wav.seconds * 1000) };
  }, [callId, fail, model, pickModel, sourceBytes, sourceName, sourceUri]);

  /**
   * 한 판 돈다. `fresh` 면 저장된 것을 버리고 처음부터.
   *
   * 순서가 곧 설계다: **보내지 못하고 남은 글이 있으면 받아쓰기를 아예 건너뛴다.** 그것이
   * 「7분을 기다렸는데 전파가 끊겨 처음부터」를 막는 유일한 길이다.
   */
  const begin = useCallback(async (fresh: boolean) => {
    if (lock.current || !supported || !callId) return;
    lock.current = true;
    setFailure(null); setNotice(''); setStopped(null); setQuitting(false); setRestarting(false); setBackgrounded(false); setElapsedMs(0);
    // 🔴 이어하기는 **새 실행**이다. 표시를 그대로 두면 앞 실행이 멈춰 있던 시간까지 이번
    // 청크의 소요로 세어 「청크당 4분」 같은 값이 나온다.
    mark.current = null;
    try {
      if (fresh) {
        await clearAsrLocalState(callId).catch(() => {});
        await clearPendingTranscript(callId).catch(() => {});
        setSaved(null); setBody(''); setParts([]); setProgress(null); setSamples([]); setResumeNote('');
      } else {
        /*
          🔴 **보내지 못하고 남은 원문이 있으면 받아쓰기를 아예 건너뛴다.** 그리고 그 사실을
          화면에 적는다 — 조용히 건너뛰면 7분을 기다렸던 사람은 화면이 멈춘 줄 안다
          (→ `lib/asr-outcome.ts` 의 `asrResumePlan`).
        */
        const pending = await loadPendingTranscript(callId);
        const resume = asrResumePlan({ fresh, pending });
        setResumeNote(resume.note);
        if (resume.skipTranscribe && pending) {
          setBody(pending);
          // ⚠️ 보험 파일에는 글만 있다. 구간은 되찾을 수 없으므로 **지어내지 않고** 빈 채로
          // 보낸다 — 그 통화는 원문 화면에서 한 덩어리로 보인다(→ `lib/call-transcript.ts`).
          setParts([]);
          await deliver(pending, []);
          return;
        }
      }

      const input = await prepare(fresh);
      if (!input) return;

      // 저장된 판정의 벤치 시간. ⚠️ 없어도 그냥 진행한다 — 그때는 첫 청크가 끝날 때까지
      // 남은 시간을 **말하지 않을** 뿐이다(→ `lib/asr-eta.ts`).
      setEncodeMs((await loadAsrCapability(input.modelId).catch(() => null))?.encodeMs ?? null);

      setPhase('transcribing');
      const handle = runLocalAsr(input, { threads, onProgress: track });
      cancelRef.current = handle.cancel;
      const result = await handle.promise;
      cancelRef.current = null;
      setSaved(result.state);

      if (!result.done) { setStopped(result.reason); setPhase('stopped'); return; }
      setBody(result.text);
      setParts(result.segments);
      // 🔴 보내기 **전에** 적어 둔다. 엔진은 완료와 동시에 이어하기 상태를 지웠다.
      await savePendingTranscript(callId, result.text).catch(() => {});
      await deliver(result.text, result.segments);
    } catch (error) {
      fail(failureCode(error));
    } finally {
      lock.current = false;
      cancelRef.current = null;
    }
  }, [callId, deliver, fail, prepare, supported, threads, track]);

  // 화면에 들어오면 바로 시작한다. 이어할 것이 있으면 그 지점부터다.
  useEffect(() => {
    // 다음 틱으로 미룬다. 효과 안에서 곧바로 상태를 바꾸면 렌더 중 갱신으로 잡힌다(react-compiler 규칙).
    void Promise.resolve().then(() => begin(false));
  }, [begin]);

  /** 포기. 🔴 되돌릴 수 없고, **서버는 6시간 뒤 이 통화를 실패로 정리한다.** */
  const giveUp = useCallback(async () => {
    cancelRef.current?.();
    await clearAsrLocalState(callId).catch(() => {});
    await clearPendingTranscript(callId).catch(() => {});
    await clearCallWav(callId).catch(() => {});
    router.back();
  }, [callId]);

  if (!supported) {
    return <SmsPage title="폰에서 받아쓰기">
      <Notice message="받아쓰기는 앱에서만 됩니다. 이 통화는 웹에서 이어갈 수 없어요." />
      <SmsButton label="돌아가기" secondary onPress={() => router.back()} />
    </SmsPage>;
  }
  if (!callId) {
    return <SmsPage title="폰에서 받아쓰기">
      <Notice error message="어느 통화를 받아쓸지 알 수 없습니다. 통화 목록에서 다시 열어 주세요." />
      <SmsButton label="돌아가기" secondary onPress={() => router.back()} />
    </SmsPage>;
  }

  const total = progress?.totalMs ?? saved?.totalMs ?? 0;
  const ratioPercent = progress ? progress.ratio * 100 : 0;
  /**
   * 남은 시간. 🔴 **막대와 섞지 않는다** — 막대는 끝난 청크만으로 그린다(→ `docs/call-analysis.md`).
   *
   * ⚠️ 화면 밖으로 한 번 나간 뒤에는 감춘다. 그 순간부터 받아쓰기는 멈춰 있는데 숫자만 계속
   * 줄어들면 그건 거짓말이고, 돌아와서 「이어서 받아쓰기」를 눌러야 한다는 사실도 가린다.
   */
  const eta = progress && phase === 'transcribing' && !backgrounded
    ? asrEta({ samples, remainingMs: asrRemainingMs(progress), encodeMs })
    : null;
  const resumable = !!saved && saved.nextOffsetMs > 0;
  /**
   * 실패 화면의 구성. 🔴 **원문을 들고 있는지에 따라 전혀 다른 화면이 된다**
   * (→ `lib/asr-outcome.ts`). 여기서 조건을 다시 적지 않는 이유는, 두 곳이 서로 다르게
   * 판단하기 시작하면 「왜 보내기 버튼이 없지」를 화면만 봐서는 알 수 없기 때문이다.
   */
  const plan = failure ? asrFailurePlan({ hasTranscript: !!body, code: failure }) : null;

  return <SmsPage title="폰에서 받아쓰기">
    {/* 무엇을 받아쓰는지. 이어하기로 들어온 사람은 이 줄로 자기 통화를 알아본다. */}
    <View style={s.card}>
      <Text style={s.subtitle}>{saved?.sourceName ?? sourceName ?? '이 통화의 녹음'}</Text>
      <Text style={s.meta}>{total > 0 ? `길이 ${durationLabel(total / 1000)} · ` : ''}스레드 {threads}</Text>
      <Text style={s.meta}>받아쓰기가 끝나면 원문만 서버로 보냅니다. 녹음 파일은 등록할 때 이미 올라갔어요.</Text>
    </View>

    {/*
      🔴 **건너뛴 일을 말해 준다.** 받아쓰기 막대가 뜨기를 기다리던 사람에게 아무 설명 없이
      「서버로 보내는 중」만 보이면, 자기 7분이 어디로 갔는지 알 수 없다.
    */}
    {resumeNote && phase !== 'done' ? <Notice message={resumeNote} /> : null}

    {/* 저장된 이어하기 상태와 못 보낸 원문을 읽는 잠깐. 🔴 이 사이에 조작을 내주지 않는다. */}
    {phase === 'loading' ? <View style={s.card}>
      <Loading />
      <Text style={s.meta}>이어서 할 것이 있는지 확인하는 중…</Text>
    </View> : null}

    {/* ── 도는 중 ─────────────────────────────────────────────── */}
    {busy ? <View style={s.card}>
      <Text style={s.subtitle}>
        {phase === 'converting' ? '받아쓰기용으로 바꾸는 중' : phase === 'transcribing' ? '받아쓰는 중' : '서버로 보내는 중'}
      </Text>
      <Text accessibilityLiveRegion="polite" style={s.body}>{Math.floor(elapsedMs / 60000)}분 {Math.floor(elapsedMs / 1000) % 60}초 경과</Text>
      {/*
        🔴 **막대는 끝난 청크로만 그린다.** whisper 가 주는 청크 안 진행률(0~100)을 전체에
        섞어 넣으면 우리가 센 적 없는 숫자가 된다. 그래서 두 값을 **따로** 보여 준다 —
        변환 단계는 잴 수가 없으므로 막대 대신 스피너다.
      */}
      {phase === 'transcribing' && progress ? <>
        <ProgressBar percent={ratioPercent} label="받아쓰기 진행률" />
        <Text style={s.meta}>
          {durationLabel(progress.doneMs / 1000)} / {durationLabel(progress.totalMs / 1000)} 완료
          {progress.chunkCount > 0 ? ` · 조각 ${Math.min(progress.chunkIndex + 1, progress.chunkCount)}/${progress.chunkCount}` : ''}
          {progress.chunkPercent !== null ? ` · 지금 조각 ${Math.round(progress.chunkPercent)}%` : ''}
        </Text>
        {/*
          🔴 **어림값이라는 것이 문장에 드러나야 한다.** 「4분 12초 남음」처럼 적으면 시계처럼
          읽히고, 1분만 어긋나도 사용자는 앱이 멈춘 줄 안다. 그래서 **무엇으로 구한 값인지**를
          앞에 붙인다 — 벤치로 찍은 어림값과 이 파일을 실제로 돌려 잰 값은 신뢰도가 다르다.

          ⚠️ 값이 없으면 줄 자체를 만들지 않는다. 「계산 중…」은 곧 온다는 약속인데, 판정도
          없고 끝난 청크도 없으면 그 값은 끝내 오지 않을 수도 있다.
        */}
        {eta ? <Text style={s.meta}>
          {eta.source === 'measured' ? '지금 속도로는' : '이 기기 성능으로 어림하면'} 앞으로 약 {asrDurationLabel(eta.remainingMs)} 남았습니다
        </Text> : null}
      </> : <Loading />}
      {/* ⚠️ 이 한 줄이 이 화면에서 가장 자주 읽힐 문장이다. */}
      <Text style={styles.warn}>이 화면을 열어 두세요. 앱을 나가면 받아쓰기가 멈춥니다.</Text>
      {phase === 'transcribing'
        ? <SmsButton label="멈추기" secondary onPress={() => {
            cancelRef.current?.();
            setNotice('멈추라고 보냈어요. whisper 가 지금 30초 조각을 끝내고 나옵니다.');
          }} />
        : null}
    </View> : null}

    {/* ── 멈춤 ────────────────────────────────────────────────── */}
    {phase === 'stopped' && stopped ? <View style={s.card}>
      <Text style={s.subtitle}>멈췄습니다</Text>
      <Notice error={stopped === 'background' || stopped === 'interrupted'} message={STOP_TEXT[stopped]} />
      {progress ? <Text style={s.meta}>{durationLabel(progress.doneMs / 1000)} / {durationLabel(progress.totalMs / 1000)} 까지 끝냈어요. 다시 하는 부분은 마지막 조각(최대 2분)뿐입니다.</Text> : null}
      <SmsButton label="이어서 받아쓰기" onPress={() => void begin(false)} />
    </View> : null}

    {/*
      ── 실패 ──────────────────────────────────────────────────
      🔴 **제목부터 갈린다.** 전송만 실패했으면 「받아쓰기는 끝났습니다」가 첫 줄이어야 한다 —
      이 한 줄이 사용자가 7분치를 스스로 버리는 것을 막는다. 문구·버튼은 전부
      `lib/asr-outcome.ts` 가 정하고 여기서는 그리기만 한다.
    */}
    {phase === 'failed' && plan ? <View style={s.card}>
      <Text style={s.subtitle}>{plan.title}</Text>
      <Notice error message={plan.message} />
      {plan.notes.map((note) => <Text key={note} style={s.meta}>{note}</Text>)}
      {/*
        🔴 **다시 보내도 안전하다** — 서버가 같은 요청을 두 번 받아도 200 이다. 할 수 있는 일이
        정말 없을 때(`action === null`)만 버튼을 걷고, 그 사실은 위 문장이 말한다.
      */}
      {plan.action === 'resend' ? <SmsButton label={plan.actionLabel} onPress={() => void deliver(body, parts)} /> : null}
      {plan.action === 'retry' ? <SmsButton label={plan.actionLabel} onPress={() => void begin(false)} /> : null}
    </View> : null}

    {/* ── 끝 ──────────────────────────────────────────────────── */}
    {phase === 'done' ? <View style={s.card}>
      <Text style={s.subtitle}>보냈습니다</Text>
      <Text style={s.body}>받아쓴 내용을 서버로 보냈습니다. 이제 서버가 내용을 정리합니다 — 통화 목록에서 이어 보세요.</Text>
      <ButtonRow>
        <SmsButton fill label="통화 목록으로" onPress={() => router.replace('/calls')} />
      </ButtonRow>
    </View> : null}

    {/* 받아쓴 글이 있으면 보여 준다. 28분치를 다 그리면 느려지므로 앞부분만이다. */}
    {body ? <View style={s.card}>
      {/* ⚠️ 「폰에 저장된」을 제목에 둔다. 미리보기가 메모리에만 있는 것처럼 읽히면 안 된다. */}
      <Text style={s.subtitle}>폰에 저장된 받아쓰기 원문</Text>
      <ScrollView style={styles.preview} nestedScrollEnabled>
        <Text selectable style={styles.previewText}>{body.slice(0, 2000)}</Text>
      </ScrollView>
    </View> : null}

    {notice ? <Notice message={notice} /> : null}
    {backgrounded && busy ? <Notice error message="앱이 한 번 화면 밖으로 나갔습니다. 그동안은 받아쓰기가 진행되지 않습니다." /> : null}

    {/*
      ── 다시/포기 ───────────────────────────────────────────────
      🔴 **보내고 나면 이 칸은 없다.** 끝난 통화에 「처음부터 다시」를 남겨 두면 7분을 다시
      태우고 같은 원문을 또 보내게 되고, 「포기하기」는 이미 끝난 일을 되돌리는 말처럼 읽힌다.
    */}
    {!busy && phase !== 'loading' && phase !== 'done' ? <View style={s.card}>
      <Text style={s.subtitle}>다르게 하기</Text>
      {/*
        🔴 **원문을 들고 있을 때 「처음부터 다시」는 지우기 버튼이다.** 저장된 원문을 버리고
        7분을 다시 태운다. 그래서 곧바로 내주지 않고, 무엇을 잃는지 말한 뒤 한 번 더 받는다
        (→ `plan.restartGuarded`). 전송이 아직 성공하지 않았을 뿐인데 사용자가 실수로 자기
        자료를 버리게 두면, 그건 화면이 만든 손실이다.
      */}
      {plan?.restartGuarded
        ? (restarting
            ? <>
                {/* ⚠️ 녹음 길이를 지어내지 않는다 — 아는 경우에만 말한다. */}
                <Notice error message={`처음부터 다시 하면 폰에 저장된 받아쓰기 원문을 지우고 ${total > 0 ? `${durationLabel(total / 1000)} 녹음을 ` : ''}처음부터 다시 받아씁니다. 지금까지 기다린 시간이 그대로 사라집니다 — 보내기만 실패한 상태라면 「원문 서버 전송」을 먼저 눌러 보세요.`} />
                <ButtonRow>
                  <SmsButton fill label="원문을 버리고 처음부터" disabled={!sourceUri} onPress={() => void begin(true)} />
                  <SmsButton fill secondary label="그만두기" onPress={() => setRestarting(false)} />
                </ButtonRow>
              </>
            : <SmsButton label="처음부터 다시 받아쓰기…" secondary disabled={!sourceUri} onPress={() => setRestarting(true)} />)
        : <>
            {/* 이어할 것이 있을 때만 「처음부터」가 뜻이 있다. 없으면 「다시 시도」와 같은 말이다. */}
            {resumable ? <Text style={s.meta}>처음부터 다시 하면 지금까지 끝낸 {progress ? durationLabel(progress.doneMs / 1000) : '부분'}을 버리고 다시 받아씁니다.</Text> : null}
            <SmsButton label="처음부터 다시" secondary disabled={!sourceUri} onPress={() => void begin(true)} />
          </>}
      {!sourceUri ? <Text style={s.meta}>원본 녹음을 다시 고를 수 없어 처음부터 다시 할 수는 없습니다. 이어하기만 됩니다.</Text> : null}
      {quitting
        ? <>
            {/* 🔴 포기하면 되돌릴 수 없다. 무슨 일이 일어나는지 말한 뒤에 묻는다. */}
            <Notice error message="포기하면 폰에 남은 받아쓰기가 지워집니다. 서버는 6시간 뒤 이 통화를 「받아쓰지 못함」으로 정리합니다 — 녹음 파일은 서버에 남아 있으니 다시 등록하면 서버가 받아씁니다." />
            <ButtonRow>
              <SmsButton fill label="정말 포기하기" onPress={() => void giveUp()} />
              <SmsButton fill secondary label="계속하기" onPress={() => setQuitting(false)} />
            </ButtonRow>
          </>
        : <SmsButton label="포기하기" secondary onPress={() => setQuitting(true)} />}
    </View> : null}
  </SmsPage>;
}

const styles = StyleSheet.create({
  warn: { ...fonts.bodySemi, color: colors.red, fontSize: textSize.md, lineHeight: 20 },
  preview: { maxHeight: 220, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.sm },
  previewText: { ...fonts.body, color: colors.ink, fontSize: textSize.md, lineHeight: 20 },
});
