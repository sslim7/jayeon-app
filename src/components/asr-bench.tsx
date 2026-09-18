/**
 * 받아쓰기 시험 — **측정만 하는 화면. 이 파일 하나가 나중에 버려진다.**
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **통화분석 등록 흐름에 붙이지 않는다.** 속도가 감당 안 되면(28분 통화에 30분)     │
 * │ 폰 받아쓰기는 통째로 버려야 한다. 그 전에 흐름을 갈아 끼우면 되돌릴 것이 많아진다.     │
 * │ 재사용할 부분은 전부 `src/lib/asr-*.ts` 와 네이티브 모듈에 있고, 버려지는 것은       │
 * │ **이 화면 하나로 국한**되어 있다.                                              │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 무엇을 재는지는 `docs/on-device-asr.md` 7절 「남은 측정」의 ①②⑤다:
 * ① 폰 실측 속도(bench) ② 28분 전체 처리 ⑤ NPU 실효성.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { ButtonRow, Notice, ProgressBar, SmsButton, SmsPage, s } from '@/components/sms-ui';
import { colors, fonts, spacing, text as textSize } from '@/constants/theme';
import { clearWorkFiles, convertToWav, durationLabel, pickAudio, type ConvertedAudio, type PickedAudio } from '@/lib/asr-audio';
import { ASR_MODELS, asrDownloadMessage, asrModel, downloadModel, modelStatus, deleteModel, type AsrModelId, type AsrModelStatus } from '@/lib/asr-models';
import { copyText, exportTranscript, reportLines, type AsrReport } from '@/lib/asr-report';
import { benchAsr, closeAsrSession, openAsrSession, transcribeAsr, type AsrBenchResult, type AsrSession } from '@/lib/asr-run';
import { asrThreads } from '@/lib/asr-threads';
import { callAudioNativeAvailable, cpuCores } from '@/lib/call-native';

/** 지금 무엇을 하고 있나. 🔴 **하나뿐인 진행 상태다** — 두 군데서 「도는 중」을 따로 들면 어긋난다. */
type Phase = 'idle' | 'downloading' | 'opening' | 'benching' | 'converting' | 'transcribing';

const PHASE_LABEL: Record<Phase, string> = {
  idle: '',
  downloading: '모델 내려받는 중',
  opening: '모델 여는 중',
  benching: '벤치 도는 중',
  converting: '16kHz 로 바꾸는 중',
  transcribing: '받아쓰는 중',
};

const KEEP_AWAKE_TAG = 'asr-bench';

export function AsrBench() {
  const [modelId, setModelId] = useState<AsrModelId>('q5_0');
  const [useGpu, setUseGpu] = useState(true);
  const [status, setStatus] = useState<Partial<Record<AsrModelId, AsrModelStatus>>>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [picked, setPicked] = useState<PickedAudio | null>(null);
  const [converted, setConverted] = useState<ConvertedAudio | null>(null);
  const [bench, setBench] = useState<AsrBenchResult | null>(null);
  const [session, setSession] = useState<AsrSession | null>(null);
  const [percent, setPercent] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [transcript, setTranscript] = useState<{ text: string; aborted: boolean; elapsedMs: number } | null>(null);
  const [backgrounded, setBackgrounded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const cancelRef = useRef<(() => void) | null>(null);
  const model = asrModel(modelId);
  const busy = phase !== 'idle';
  const supported = Platform.OS !== 'web' && callAudioNativeAvailable();

  /**
   * 스레드 수는 기기 코어에서 나온다. 🔴 **화면에 반드시 띄운다** — 예전 폰 받아쓰기 실패가
   * 모델이 아니라 「1스레드 CPU」라는 나쁜 설정 때문이었을 가능성이 있는데(→ 문서 3절),
   * 숫자 없이 「느렸다」만 남기면 그 오해를 한 번 더 반복하게 된다.
   */
  const threads = useMemo(() => asrThreads(cpuCores()), []);

  const refresh = useCallback(async () => {
    const next: Partial<Record<AsrModelId, AsrModelStatus>> = {};
    for (const item of ASR_MODELS) next[item.id] = await modelStatus(item);
    setStatus(next);
  }, []);

  // 모델이 이미 있는지는 파일을 봐야 안다. 첫 진입에 한 번 확인한다.
  // 다음 틱으로 미룬다. 효과 안에서 곧바로 상태를 바꾸면 렌더 중 갱신으로 잡힌다(react-compiler 규칙).
  useEffect(() => { if (supported) void Promise.resolve().then(() => refresh()); }, [supported, refresh]);

  /**
   * 🔴 **28분을 기다리는 동안 화면이 꺼지면 측정이 중간에 죽고 28분을 다시 기다려야 한다.**
   * 처리 중에만 화면을 깨워 둔다 — 항상 켜 두면 이 화면을 열어 둔 채 둔 사람의 배터리를 태운다.
   */
  useEffect(() => {
    if (!busy) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    // ⚠️ 프라미스를 돌려주는 함수다. catch 를 달지 않으면 화면을 떠날 때 처리되지 않은 거절이 뜬다.
    return () => { void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}); };
  }, [busy]);

  /**
   * 백그라운드로 갔는지 **기록만** 한다. 막을 수는 없다.
   *
   * ⚠️ 안드로이드는 백그라운드 앱의 CPU 를 조이고, 메모리가 모자라면 죽인다. 그 상태로 잰
   * 시간은 기기 성능이 아니라 **OS 정책**의 숫자다. 결과에 그 사실이 적혀 있지 않으면
   * 「왜 이번엔 느렸지」를 영원히 알 수 없다.
   */
  useEffect(() => {
    if (!busy) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setBackgrounded(true);
    });
    return () => sub.remove();
  }, [busy]);

  /** 경과 시간. 🔴 **실제로 흐른 시간만 센다** — 진행률과 달리 이 값은 지어낼 여지가 없다. */
  useEffect(() => {
    if (phase !== 'converting' && phase !== 'transcribing') return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  function fail(where: string, e: unknown) {
    setError(`${where}: ${e instanceof Error ? e.message : String(e)}`);
  }

  /** 열려 있던 모델을 닫는다. 🔴 547MB 를 쥔 채 다른 모델을 열면 두 개가 동시에 올라가 죽는다. */
  const closeSession = useCallback(async (current: AsrSession | null) => {
    if (!current) return;
    try { await closeAsrSession(current); } catch { /* 이미 닫혔다. */ }
  }, []);

  async function download() {
    setError(null); setNotice(null);
    setPhase('downloading');
    setDownloadedBytes((await modelStatus(model)).partialBytes);
    const task = downloadModel(model, setDownloadedBytes);
    cancelRef.current = task.cancel;
    try {
      await task.promise;
      setNotice(`${model.label} 준비됐습니다.`);
    } catch (e) {
      setError(asrDownloadMessage(e));
    } finally {
      cancelRef.current = null;
      setPhase('idle');
      await refresh();
    }
  }

  async function remove() {
    await closeSession(session);
    setSession(null); setBench(null);
    await deleteModel(model);
    await refresh();
    setNotice(`${model.label} 을 지웠습니다.`);
  }

  /** 모델을 열고 **NPU 가 실제로 잡혔는지**를 받아 온다. 벤치와 받아쓰기가 같은 세션을 쓴다. */
  async function open(): Promise<AsrSession | null> {
    if (session) return session;
    setError(null);
    setPhase('opening');
    try {
      const opened = await openAsrSession(modelId, useGpu);
      setSession(opened);
      return opened;
    } catch (e) {
      fail('모델을 열지 못했어요', e);
      return null;
    } finally {
      setPhase('idle');
    }
  }

  /**
   * 🔴 **전체 받아쓰기 전에 이것부터.** 몇 초면 끝나고, 인코더가 1초를 넘으면 28분짜리는
   * 이미 수 분이다 — 30분 기다린 뒤에 알 이유가 없다.
   */
  async function runBench() {
    const opened = await open();
    if (!opened) return;
    setPhase('benching');
    try {
      setBench(await benchAsr(opened, threads));
    } catch (e) {
      fail('벤치를 돌리지 못했어요', e);
    } finally {
      setPhase('idle');
    }
  }

  async function pick() {
    setError(null); setNotice(null);
    try {
      const file = await pickAudio();
      if (!file) return;
      setPicked(file);
      // 파일이 바뀌면 이전 변환·전사는 남의 것이다. 남겨 두면 다른 파일의 숫자를 읽게 된다.
      setConverted(null);
      setTranscript(null);
    } catch (e) {
      fail('파일을 고르지 못했어요', e);
    }
  }

  /** 변환 → 받아쓰기를 이어서 돈다. **두 시간을 따로 잰다**(→ `asr-report.ts`). */
  async function run() {
    if (!picked) return;
    const opened = await open();
    if (!opened) return;
    setError(null); setNotice(null); setTranscript(null); setBackgrounded(false);
    setElapsedMs(0); setPercent(0);

    let wav = converted;
    if (!wav) {
      setPhase('converting');
      try {
        wav = await convertToWav(picked);
        setConverted(wav);
      } catch (e) {
        fail('16kHz 변환에 실패했어요', e);
        setPhase('idle');
        return;
      }
    }

    setPhase('transcribing');
    const task = transcribeAsr(opened, wav.uri, threads, setPercent);
    cancelRef.current = task.stop;
    try {
      const result = await task.promise;
      setTranscript(result);
    } catch (e) {
      fail('받아쓰기에 실패했어요', e);
    } finally {
      cancelRef.current = null;
      setPhase('idle');
    }
  }

  /** 멈춤은 「즉시」가 아니다. 그 사실을 말해 주지 않으면 사용자는 버튼을 계속 누른다. */
  function cancel() {
    cancelRef.current?.();
    setNotice(phase === 'downloading'
      ? '내려받기를 멈추는 중입니다. 받아 둔 부분은 남습니다.'
      : '멈추라고 보냈어요. whisper 가 지금 30초 창을 끝내고 나옵니다.');
  }

  const report: AsrReport | null = transcript && converted ? {
    modelLabel: model.label,
    gpu: session?.gpu ?? false,
    reasonNoGPU: session?.reasonNoGPU ?? '',
    threads,
    benchConfig: bench?.config ?? null,
    benchEncodeMs: bench?.encodeMs ?? null,
    benchDecodeMs: bench?.decodeMs ?? null,
    audioSeconds: converted.seconds,
    convertMs: converted.elapsedMs,
    transcribeMs: transcript.elapsedMs,
    loadMs: session?.loadMs ?? 0,
    characters: transcript.text.length,
    aborted: transcript.aborted,
  } : null;

  if (!supported) {
    return <SmsPage title="받아쓰기 시험">
      <Notice message="이 화면은 받아쓰기 네이티브 모듈이 실린 안드로이드/iOS 앱에서만 동작합니다. Expo Go 와 웹에서는 열 수 없어요." />
    </SmsPage>;
  }

  const current = status[modelId];
  const downloadPercent = model.bytes > 0 ? (downloadedBytes / model.bytes) * 100 : 0;

  return <SmsPage title="받아쓰기 시험">
    <Notice message="폰에서 whisper 가 얼마나 걸리는지만 재는 화면입니다. 통화분석 등록과는 이어져 있지 않습니다." />

    {/* ── 1. 모델 ─────────────────────────────────────────────── */}
    <View style={s.card}>
      <Text style={s.subtitle}>1. 모델</Text>
      <ButtonRow>
        {ASR_MODELS.map((item) => <SmsButton
          key={item.id}
          fill
          secondary={item.id !== modelId}
          label={`${status[item.id]?.installed ? '● ' : '○ '}${item.label}`}
          accessibilityLabel={`${item.label} ${status[item.id]?.installed ? '설치됨' : '없음'}`}
          disabled={busy}
          onPress={() => {
            if (item.id === modelId) return;
            // 🔴 모델을 바꾸면 열린 세션과 벤치는 다른 모델의 것이다. 반드시 같이 버린다.
            void closeSession(session);
            setSession(null); setBench(null); setTranscript(null);
            setModelId(item.id);
          }}
        />)}
      </ButtonRow>
      <Text style={s.meta}>{model.note}</Text>
      <Text style={s.meta}>
        {model.npuCapable
          ? 'NPU(Hexagon)가 돌릴 수 있는 양자화입니다.'
          : '⚠️ ggml-hexagon 이 q5 를 지원하지 않아 NPU 를 켜도 CPU 로 떨어집니다.'}
      </Text>

      {phase === 'downloading' ? <>
        <ProgressBar percent={downloadPercent} label="모델 내려받기" />
        <Text style={s.meta}>{(downloadedBytes / 1e6).toFixed(0)} / {(model.bytes / 1e6).toFixed(0)} MB</Text>
        <SmsButton label="멈추기" secondary onPress={cancel} />
      </> : current?.installed
        ? <ButtonRow>
            <SmsButton fill secondary label="모델 지우기" disabled={busy} onPress={() => void remove()} />
          </ButtonRow>
        : <>
            {/* ⚠️ 「이어받는다」고 단정하지 않는다. OS 가 이어받기 정보를 주지 못하면 처음부터 받는다(→ `asr-models.ts`). */}
            {current && current.partialBytes > 0
              ? <Text style={s.meta}>{(current.partialBytes / 1e6).toFixed(0)}MB 받아 뒀습니다. 가능하면 이어받고, 안 되면 처음부터 받습니다.</Text>
              : null}
            <SmsButton label={`${model.label} 내려받기`} disabled={busy} onPress={() => void download()} />
          </>}
    </View>

    {/* ── 2. NPU ──────────────────────────────────────────────── */}
    <View style={s.card}>
      <Text style={s.subtitle}>2. 백엔드</Text>
      <ButtonRow>
        <SmsButton fill secondary={!useGpu} label="NPU/GPU 켬" disabled={busy || !!session} onPress={() => setUseGpu(true)} />
        <SmsButton fill secondary={useGpu} label="CPU 만" disabled={busy || !!session} onPress={() => setUseGpu(false)} />
      </ButtonRow>
      <Text style={s.meta}>스레드 {threads} (코어 {cpuCores() ?? '?'})</Text>
      {session
        /* 🔴 기대가 아니라 결과다. 이 줄이 이번 측정에서 가장 중요한 한 줄이다. */
        ? <Text style={[s.body, { color: session.gpu ? colors.greenText : colors.red }]}>
            {session.gpu ? '● NPU/GPU 로 열렸습니다' : `○ CPU 로 열렸습니다${session.reasonNoGPU ? ` — ${session.reasonNoGPU}` : ' — 이유를 라이브러리가 남기지 않았습니다'}`}
          </Text>
        : <Text style={s.meta}>모델을 열면 실제로 무엇이 잡혔는지 여기에 표시됩니다.</Text>}
      {session
        ? <SmsButton label="모델 닫기 (백엔드 바꾸려면)" secondary disabled={busy} onPress={() => {
            void closeSession(session);
            setSession(null); setBench(null);
          }} />
        : null}
    </View>

    {/* ── 3. 벤치 ─────────────────────────────────────────────── */}
    <View style={s.card}>
      <Text style={s.subtitle}>3. 벤치 (30초 청크 1회)</Text>
      <Text style={s.meta}>몇 초면 끝납니다. 전체 받아쓰기 전에 먼저 돌려 보세요.</Text>
      <SmsButton label="벤치 돌리기" disabled={busy || !current?.installed} onPress={() => void runBench()} />
      {bench ? <View style={styles.rows}>
        <Row label="백엔드" value={bench.config} />
        <Row label="스레드" value={String(bench.nThreads)} />
        <Row label="인코더" value={`${bench.encodeMs.toFixed(2)} ms`} />
        <Row label="디코더(토큰당)" value={`${bench.decodeMs.toFixed(2)} ms`} />
        <Row label="배치" value={`${bench.batchMs.toFixed(2)} ms`} />
        <Row label="프롬프트" value={`${bench.promptMs.toFixed(2)} ms`} />
      </View> : null}
      {/* ⚠️ 곱셈으로 28분을 추정하지 말라는 경고를 숫자 바로 옆에 둔다. 표만 남으면 반드시 곱한다. */}
      {bench ? <Text style={s.meta}>⚠️ 이 값에 57(=28분/30초)을 곱하지 마세요. mel 추출·재시도·발열이 빠져 있습니다.</Text> : null}
    </View>

    {/* ── 4. 파일 ─────────────────────────────────────────────── */}
    <View style={s.card}>
      <Text style={s.subtitle}>4. 녹음 고르기</Text>
      <SmsButton label="파일 고르기" secondary disabled={busy} onPress={() => void pick()} />
      {picked
        ? <Text style={s.body}>{picked.name} · {(picked.bytes / 1e6).toFixed(1)} MB</Text>
        : <Text style={s.meta}>다운로드 폴더의 consult-test.m4a 를 고르면 됩니다.</Text>}
      {converted ? <Text style={s.meta}>변환됨 · {durationLabel(converted.seconds)} · {(converted.elapsedMs / 1000).toFixed(1)}초 걸림</Text> : null}
    </View>

    {/* ── 5. 전체 받아쓰기 ────────────────────────────────────── */}
    <View style={s.card}>
      <Text style={s.subtitle}>5. 전체 받아쓰기</Text>
      <SmsButton label="변환 + 받아쓰기 시작" disabled={busy || !picked || !current?.installed} onPress={() => void run()} />
      {busy ? <>
        <Text style={s.body}>{PHASE_LABEL[phase]} · {Math.floor(elapsedMs / 1000 / 60)}분 {Math.floor(elapsedMs / 1000) % 60}초 경과</Text>
        {/*
          진행률은 whisper.cpp 가 준 값일 때만 그린다. 변환 단계는 진행률을 낼 수 없으므로
          🔴 **막대를 그리지 않는다** — 없는 숫자를 지어내면 이 측정의 신뢰가 통째로 무너진다.
        */}
        {phase === 'transcribing' ? <ProgressBar percent={percent} label="받아쓰기 진행률" /> : null}
        {phase === 'transcribing' || phase === 'downloading' ? <SmsButton label="멈추기" secondary onPress={cancel} /> : null}
      </> : null}
      {/* 같은 파일을 다시 잴 때 28분짜리 변환을 두 번 하지 않는다. 변환 시간은 앞서 잰 값을 그대로 쓴다. */}
      {converted && !busy
        ? <Text style={s.meta}>변환본이 남아 있어 다시 누르면 받아쓰기부터 시작합니다(변환 시간은 앞서 잰 값).</Text>
        : null}
    </View>

    {/* ── 6. 결과 ─────────────────────────────────────────────── */}
    {report && transcript ? <View style={s.card}>
      <Text style={s.subtitle}>6. 결과</Text>
      {backgrounded ? <Notice error message="⚠️ 처리 중 앱이 백그라운드로 갔습니다. OS 가 CPU 를 조였을 수 있어 이 시간은 믿을 수 없습니다. 다시 재세요." /> : null}
      <View style={styles.rows}>
        {reportLines(report).map((line, index) => <Text key={index} selectable style={s.body}>{line}</Text>)}
      </View>
      <ButtonRow>
        <SmsButton fill label="원문 내보내기" onPress={() => void exportTranscript(modelId, transcript.text).catch((e) => fail('내보내지 못했어요', e))} />
        <SmsButton fill secondary label="원문 복사" onPress={() => void copyText(transcript.text).then(() => setNotice('원문을 복사했습니다.')).catch((e) => fail('복사하지 못했어요', e))} />
      </ButtonRow>
      <SmsButton label="측정값 복사" secondary onPress={() => void copyText(reportLines(report).join('\n')).then(() => setNotice('측정값을 복사했습니다.')).catch((e) => fail('복사하지 못했어요', e))} />
      <Text style={s.subtitle}>원문 미리보기</Text>
      {/* 28분치를 한 화면에 그리면 느려진다. 전체는 내보내기·복사로 꺼낸다. */}
      <ScrollView style={styles.preview} nestedScrollEnabled>
        <Text selectable style={styles.previewText}>{transcript.text.slice(0, 2000) || '(빈 결과)'}</Text>
      </ScrollView>
      <SmsButton label="변환 파일 지우기" secondary disabled={busy} onPress={() => void clearWorkFiles().then(() => { setConverted(null); setNotice('캐시의 WAV 를 지웠습니다.'); })} />
    </View> : null}

    {notice ? <Notice message={notice} /> : null}
    {error ? <Notice error message={error} /> : null}
  </SmsPage>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}>
    <Text style={s.meta}>{label}</Text>
    <Text selectable style={styles.value}>{value}</Text>
  </View>;
}

const styles = StyleSheet.create({
  rows: { gap: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  value: { ...fonts.mono, color: colors.ink, fontSize: textSize.lg },
  preview: { maxHeight: 260, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.sm },
  previewText: { ...fonts.body, color: colors.ink, fontSize: textSize.md, lineHeight: 20 },
});
