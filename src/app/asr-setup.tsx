import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import * as FS from 'expo-file-system/legacy';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useScreenHeader } from '@/components/app-navigation';
import { useShellExit } from '@/hooks/use-shell-exit';
import { ButtonRow, Loading, Notice, ProgressBar, SmsButton, SmsPage, s } from '@/components/sms-ui';
import { APP_VERSION } from '@/constants/app-meta';
import { colors, fonts, radii, spacing, text } from '@/constants/theme';
import {
  ASR_ENCODE_LIMIT_MS, asrCapabilityMessage, asrDurationLabel, buildAsrCapability,
  isFreshCapability, loadAsrCapability, measureAsrCapability, modelDownloadBlockReason, preBenchReason,
  type AsrCapability, type SocInfo,
} from '@/lib/asr-capability';
import { asrLocalProgress, clearAsrLocalState, listAsrLocalStates, type AsrLocalState } from '@/lib/asr-local';
import {
  ASR_MODELS, asrDownloadMessage, asrModel, deleteModel, downloadModel, modelStatus,
  type AsrModel, type AsrModelId, type AsrModelStatus,
} from '@/lib/asr-models';
import { callAudioNativeAvailable, socInfo } from '@/lib/call-native';
import { sessionDayLabel } from '@/lib/session-api';

/**
 * 로컬 받아쓰기 설정 — **「내 폰에서 되나?」에 숫자로 답하는 화면.**
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **되는지 안 되는지만 말하지 않는다.** 아이폰 15 Pro 는 28분 26초 통화를 7분 18초에  │
 * │ 받아썼고, 엑시노스·미디어텍 갤럭시는 같은 일에 33분~3시간이 걸린다. 그 차이를 숫자     │
 * │ 없이 「안 됩니다」로만 적으면 사용자는 기기를 의심하는 대신 **앱을 의심한다.** 그래서   │
 * │ 이 화면은 결론 옆에 언제나 **근거**(AP · 인코더 시간 · 28분 예상)를 함께 세운다.       │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * 판단은 하나도 여기서 하지 않는다 — 전부 `lib/asr-capability-types.ts` 의 규칙과
 * `lib/asr-models.ts` 의 파일 상태에서 나온다. 문구도 마찬가지다: 「왜 안 되는지」는
 * `asrCapabilityMessage(...)` 가 이미 한국어 한 줄로 만들어 두었으므로 **여기서 새로 짓지
 * 않는다.** 화면이 문장을 따로 지으면 규칙이 바뀌는 날 둘이 서로 다른 말을 한다.
 *
 * 나가는 길은 헤더가 맡는다 — 껍데기 모드에서는 「제목 + 닫기」, 아니면 「‹ 뒤로 + 제목」이다
 * (→ `components/app-navigation.tsx`, `hooks/use-shell-exit.ts`).
 * 🔴 **`confirm()`·`alert()` 를 쓰지 않는다** — 이 앱은 WebView 안에서도 돌고, 그 안에서
 * 브라우저 모달이 뜨면 화면이 그대로 멈춘다. 확인은 화면 안의 두 단계로 받는다.
 */
export default function AsrSetupScreen() {
  /**
   * 나가는 길. 🔴 **껍데기에서 열렸을 때는 웹뷰로 돌아간다** — 사용자는 웹 설정에서 왔고,
   * 껍데기 모드의 `/settings` 는 네이티브에 그릴 화면이 아니다(→ `hooks/use-shell-exit.ts`).
   * 이 화면에 머리가 서지 않아 **앱을 강제 종료해야 벗어날 수 있던** 자리다.
   */
  const exit = useShellExit('/settings');
  /** ⚠️ `useMemo` 는 멋이 아니다 — 매 렌더 새 객체를 넘기면 헤더가 매번 다시 올라간다. */
  useScreenHeader(useMemo(() => ({ title: 'NPU 기기확인', onBack: exit }), [exit]));

  /**
   * 이 앱에서 받아쓰기를 할 수 있나 — **기기 성능이 아니라 「기능이 실려 있나」다.**
   * 웹 번들과 옛 네이티브 껍데기에는 whisper 가 아예 없다(→ `lib/call-native.ts`).
   */
  const native = Platform.OS !== 'web' && callAudioNativeAvailable();

  /** 지금 화면이 다루는 모델. 🔴 기본값이 권장값이다 — 아래 `RECOMMENDED` 의 근거를 보라. */
  const [modelId, setModelId] = useState<AsrModelId>(RECOMMENDED);
  const [status, setStatus] = useState<Partial<Record<AsrModelId, AsrModelStatus>>>({});
  /** 남은 저장 공간. 못 읽었으면 `null` — **0 으로 채우면 「꽉 찼다」는 거짓말이 된다.** */
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  /** 지금 보여 줄 판정. `null` 은 「불가」가 아니라 **「아직 재 보지 않았다」**다. */
  const [capability, setCapability] = useState<AsrCapability | null>(null);
  const [capabilityLoaded, setCapabilityLoaded] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [downloading, setDownloading] = useState<AsrModelId | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  /** 지우기 확인을 기다리는 모델. 🔴 **누르기 전에 받는다** — 다시 받으려면 834MB 다. */
  const [confirmModel, setConfirmModel] = useState<AsrModelId | null>(null);
  const [jobs, setJobs] = useState<AsrLocalState[]>([]);
  const [confirmJob, setConfirmJob] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  /**
   * 이 기기의 AP. 🔴 **한 번만 읽는다** — 렌더마다 네이티브를 부를 값이 아니고, 기기가
   * 도중에 바뀌지도 않는다.
   */
  const soc = useMemo(() => socInfo(), []);
  /**
   * 모델을 받아도 쓸 수 없는 기기인가. 🔴 **판단은 규칙이 한다**(→ `lib/asr-capability-types.ts`).
   * 여기서 `socVerdict` 를 다시 풀어 쓰면 판정 카드와 버튼이 서로 다른 말을 하는 날이 온다.
   */
  const blocked = modelDownloadBlockReason({ platform: Platform.OS, soc });

  const alive = useRef(true);
  /** 내려받기를 멈추는 손잡이. 화면을 떠날 때도 이것을 당긴다(아래 효과). */
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      /*
       * 🔴 **화면을 떠나면 내려받기를 멈춘다.** 놔두면 아무도 진행률을 보지 못하는 채로
       * 834MB 가 흐르고, 그 사이의 실패는 어디에도 표시되지 않는다. 받아 둔 바이트는
       * 남으므로(→ `lib/asr-models.ts`) 다시 들어와 이어받으면 된다.
       */
      cancelRef.current?.();
    };
  }, []);

  const refreshModels = useCallback(async () => {
    const next: Partial<Record<AsrModelId, AsrModelStatus>> = {};
    for (const model of ASR_MODELS) next[model.id] = await modelStatus(model);
    let free: number | null = null;
    // 못 읽으면 적지 않는다. 남은 공간을 지어내면 「받을 수 있다」를 잘못 말하게 된다.
    try { free = await FS.getFreeDiskStorageAsync(); } catch { /* 값 없이 그린다. */ }
    if (!alive.current) return;
    setStatus(next);
    setFreeBytes(free);
  }, []);

  /**
   * 판정을 **재지 않고** 읽는다.
   *
   * ⚠️ 순서가 곧 판단이고, 그 순서는 `measureAsrCapability` 와 같아야 한다: 재 보기 전에
   * 이미 결론이 나는 것(AP·모델 없음)이 저장된 판정보다 **앞선다.** 뒤집으면 모델을 지운
   * 뒤에도 옛 「사용 가능」이 남아, 쓸 수 없는 기능을 쓸 수 있다고 말하게 된다.
   */
  const refreshCapability = useCallback(async (id: AsrModelId) => {
    const installed = (await modelStatus(asrModel(id))).installed;
    const soc = socInfo();
    // `nativeAvailable` 은 참으로 못 박는다 — 거짓이면 이 함수에 닿기 전에 화면이 통째로
    // 「앱에서만 됩니다」로 끝난다(아래 `if (!native)`).
    const early = preBenchReason({ platform: Platform.OS, nativeAvailable: true, soc, modelInstalled: installed });
    if (early) {
      if (!alive.current) return;
      setCapability(buildAsrCapability({ reason: early, modelId: id, soc, encodeMs: null, now: Date.now(), appVersion: APP_VERSION }));
      setCapabilityLoaded(true);
      return;
    }
    const saved = await loadAsrCapability(id);
    if (!alive.current) return;
    // 🔴 저장본이 낡았으면(모델·앱 버전이 바뀜) **버린다.** 옛 백엔드의 숫자는 이 앱의 숫자가 아니다.
    setCapability(isFreshCapability(saved, id, APP_VERSION) ? saved : null);
    setCapabilityLoaded(true);
  }, []);

  /**
   * 아직 안 끝난 로컬 받아쓰기 목록.
   *
   * 🔴 **폴더는 엔진만 안다.** 여기서 경로를 복제해 직접 훑던 시절이 있었는데, 그러면 엔진이
   * 폴더를 옮기는 날 이 목록이 오류 없이 **조용히 비어** 「하던 일이 사라졌다」로 보였다.
   * 깨진 파일 건너뛰기와 정렬까지 전부 엔진 쪽에 있다(→ `lib/asr-local.ts`).
   */
  const refreshJobs = useCallback(async () => {
    const found = await listAsrLocalStates();
    if (!alive.current) return;
    setJobs(found);
  }, []);

  // 다음 틱으로 미룬다. 효과 안에서 곧바로 상태를 바꾸면 렌더 중 갱신으로 잡힌다(react-compiler 규칙).
  useEffect(() => {
    if (!native) return;
    void Promise.resolve().then(() => refreshModels());
    void Promise.resolve().then(() => refreshJobs());
  }, [native, refreshModels, refreshJobs]);

  useEffect(() => {
    if (!native) return;
    void Promise.resolve().then(() => refreshCapability(modelId));
  }, [native, modelId, refreshCapability]);

  /**
   * 이 기기에서 실제로 재 본다. **이 화면에서 18초 이상 걸리는 유일한 동작이다.**
   *
   * ⚠️ `measureAsrCapability` 는 던지지 않는다 — 열지도 재지도 못하면 `ERROR` 판정을 돌려주고,
   * 그 판정은 캐시에 남지 않는다(→ `lib/asr-capability-types.ts` 의 `isFreshCapability`).
   */
  async function measure() {
    setError(''); setNotice('');
    setMeasuring(true);
    const result = await measureAsrCapability(modelId);
    if (!alive.current) return;
    setCapability(result);
    setCapabilityLoaded(true);
    setMeasuring(false);
  }

  async function download(model: AsrModel) {
    setError(''); setNotice('');
    setDownloading(model.id);
    // 이미 받아 둔 만큼에서 시작한다. 0 부터 그리면 이어받기가 「처음부터 다시」로 보인다.
    setDownloadedBytes((await modelStatus(model)).partialBytes);
    const task = downloadModel(model, (bytes) => { if (alive.current) setDownloadedBytes(bytes); });
    cancelRef.current = task.cancel;
    try {
      await task.promise;
      if (alive.current) setNotice(`${model.label} 준비됐어요. 이제 이 기기에서 되는지 재 볼 수 있어요.`);
    } catch (e) {
      // 🔴 실패를 「알 수 없는 오류」로 뭉개지 않는다. 사유별 한 줄이 이미 있다.
      if (alive.current) setError(asrDownloadMessage(e));
    } finally {
      cancelRef.current = null;
      if (!alive.current) return;
      setDownloading(null);
      await refreshModels();
      await refreshCapability(modelId);
    }
  }

  async function remove(model: AsrModel) {
    setError(''); setNotice('');
    setConfirmModel(null);
    await deleteModel(model);
    if (!alive.current) return;
    setNotice(`${model.label} 을 지웠어요.`);
    await refreshModels();
    /*
     * 🔴 저장된 판정은 그대로 둔다. 그 숫자는 **이 기기에서 실제로 잰 사실**이라 모델을
     * 다시 받으면 18초를 아낄 수 있다. 대신 위 `refreshCapability` 가 모델 유무를 먼저
     * 보므로, 모델이 없는 동안에는 「먼저 모델을 내려받아야…」가 표시된다.
     */
    await refreshCapability(modelId);
  }

  async function dropJob(callId: string) {
    setError(''); setNotice('');
    setConfirmJob(null);
    try {
      await clearAsrLocalState(callId);
      if (alive.current) setNotice('진행 중이던 받아쓰기를 지웠어요.');
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '지우지 못했어요.');
    }
    await refreshJobs();
  }

  /**
   * 🔴 **웹과 옛 껍데기에서는 여기서 끝난다.** 아래 카드들은 전부 파일과 네이티브 모듈을
   * 만지므로 그릴 수 없다. 문구는 판정 규칙이 쓰는 것과 **같은 문장**을 쓴다 — 여기서 새로
   * 지으면 같은 상황을 두 군데가 다르게 설명하게 된다.
   */
  if (!native) {
    return <SmsPage title="로컬 받아쓰기" hideTitle>
      <Notice message={asrCapabilityMessage(Platform.OS === 'web' ? 'WEB' : 'NO_NATIVE', null, null)} />
    </SmsPage>;
  }

  const model = asrModel(modelId);
  const current = status[modelId];
  const busy = measuring || downloading !== null;

  return (
    <SmsPage title="로컬 받아쓰기" hideTitle>
      <Notice message="통화 녹음을 서버로 보내지 않고 이 폰에서 바로 받아쓰는 기능이에요. 되는 기기가 정해져 있어서, 모델을 내려받고 이 기기에서 되는지 한 번 재 봐야 합니다." />
      {error ? <Notice error message={error} /> : null}
      {notice ? <Notice message={notice} /> : null}

      {/* ── 이 기기에서 되는가 ───────────────────────────────── */}
      <View style={s.card}>
        <Text style={s.subtitle}>이 기기에서 되는가</Text>
        {!capabilityLoaded ? <Loading /> : null}
        {capabilityLoaded && !capability ? <Text style={s.body}>
          아직 재 보지 않았어요. 기기 이름으로는 알 수 없어서, 실제로 한 번 돌려 봐야 속도를 말할 수 있어요.
        </Text> : null}
        {capability ? <>
          {/*
            🔴 **결론 한 줄은 규칙이 만든 문장 그대로다**(→ `asrCapabilityMessage`). 불가일
            때도 그 안에 「왜」와 「28분 통화에 얼마나」가 이미 들어 있다.
            ⚠️ 색만으로 뜻을 전하지 않는다 — 문장이 같은 말을 글자로도 한다.
          */}
          <Text selectable style={[s.body, { color: capability.ok ? colors.greenText : colors.red }]}>
            {capability.message}
          </Text>
          <Evidence capability={capability} />
        </> : null}
        {/*
          🔴 **판정이 비싸다는 사실을 적는다.** 적어 두지 않으면 사용자는 20초 멈춘 화면을
          고장으로 읽고, 저장본을 다시 쓰는 것도 「검사를 안 한 것」으로 오해한다.
        */}
        <Text style={s.meta}>검사는 모델을 여는 데만 18초쯤 걸려요. 한 번 잰 값을 저장해 두고 다시 쓰기 때문에, 이 화면을 열 때마다 다시 재지는 않아요.</Text>
        <SmsButton
          secondary
          label={measuring ? '재는 중…' : capability?.encodeMs != null ? '다시 검사' : '이 기기에서 되는지 검사'}
          accessibilityLabel={`${model.label} 로 이 기기 속도 검사`}
          // 모델이 없으면 잴 수가 없다. 그 사실은 위의 결론 한 줄이 이미 말하고 있다.
          disabled={busy || !current?.installed}
          onPress={() => void measure()}
        />
      </View>

      {/* ── 모델 ────────────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={s.subtitle}>모델</Text>
        {/*
          🔴 **받아도 쓸 수 없는 기기에서는 받기를 막고, 그 이유를 이 자리에서 말한다.**
          834MB 를 받아 놓고 「그래서 안 됩니다」를 나중에 듣는 것이 가장 나쁘다. 문장은 판정
          규칙이 만든 것을 그대로 쓴다 — 위 판정 카드와 한 글자도 어긋나지 않아야 한다.

          ⚠️ **지우기는 막지 않는다.** 이미 받아 둔 사람에게는 이 화면이 용량을 되찾는
          유일한 길이다(→ `lib/asr-capability-types.ts` 의 `modelDownloadBlockReason`).
        */}
        {blocked ? <Notice
          error
          message={`${asrCapabilityMessage(blocked, null, soc)} 받아 두어도 쓸 수 없어서 내려받기와 고르기를 막아 두었어요 — 이미 받아 둔 모델은 아래에서 지울 수 있습니다.`}
        /> : null}
        {/*
          🔴 **어느 쪽을 권하는지 먼저 적는다.** 두 줄을 나란히 세워 놓고 고르라고만 하면
          사용자는 대개 작은 쪽(=덜 정확한 쪽)을 고른다. 맥북 실측에서는 q8_0 이 **더 빠르고
          더 정확했다**(→ `docs/on-device-asr.md` 7절).
        */}
        <Text style={s.body}>
          q8_0 을 권해요. 맥북 실측에서 q8_0 이 더 빨랐고(1분 22초 vs 1분 33초) 더 정확했어요(오탈자율 3.75% vs 4.84%). q5_0 은 300MB 작은 대신 정확도가 조금 낮습니다.
        </Text>
        <Text style={s.meta}>아래에서 고른 모델로 검사합니다.</Text>
        {ASR_MODELS.map((item) => <ModelRow
          key={item.id}
          model={item}
          status={status[item.id]}
          selected={item.id === modelId}
          recommended={item.id === RECOMMENDED}
          freeBytes={freeBytes}
          blocked={blocked !== null}
          downloading={downloading === item.id}
          downloadedBytes={downloadedBytes}
          busy={busy}
          confirming={confirmModel === item.id}
          onSelect={() => {
            setModelId(item.id);
            setConfirmModel(null);
            /*
             * 🔴 **앞 모델의 판정을 지운다.** 남겨 두면 새 모델을 고른 화면에 옛 모델의
             * 「사용 가능 · 7분 18초」가 잠깐 그대로 서 있다 — 두 모델의 속도는 다르므로
             * 그 한 순간이 틀린 숫자다. 비우면 그 자리에 「불러오는 중」이 선다.
             */
            setCapability(null);
            setCapabilityLoaded(false);
          }}
          onDownload={() => void download(item)}
          onCancel={() => {
            cancelRef.current?.();
            setNotice('내려받기를 멈추는 중이에요. 받아 둔 부분은 남습니다.');
          }}
          onAskRemove={() => { setConfirmModel(item.id); setError(''); setNotice(''); }}
          onCancelRemove={() => setConfirmModel(null)}
          onRemove={() => void remove(item)}
        />)}
        {/*
          🔴 **834MB 를 받는 화면이다.** Wi-Fi 이야기를 빼면 지하철에서 누른 사람이 요금을
          문다. 「나가면 멈춘다」도 함께 적는다 — 위 언마운트 처리가 실제로 그렇게 동작한다.
        */}
        <Notice message={`권장 모델이 ${sizeLabel(asrModel(RECOMMENDED).bytes)} 예요. Wi-Fi 에서 받는 것을 권해요 — 이동통신으로 받으면 데이터 요금이 나갈 수 있어요. 받는 동안에는 이 화면을 열어 두세요. 나가면 멈추고, 다시 들어오면 이어받습니다.`} />
        <Text style={s.meta}>
          {freeBytes !== null
            ? `남은 저장 공간 ${sizeLabel(freeBytes)} · 받으려면 모델 크기 + 300MB 가 필요해요(변환한 음성과 OS 몫).`
            : '남은 저장 공간을 읽지 못했어요. 모델 크기 + 300MB 가 필요합니다.'}
        </Text>
      </View>

      {/* ── 진행 중인 받아쓰기 ──────────────────────────────── */}
      {jobs.length ? <View style={s.card}>
        <Text style={s.subtitle}>진행 중인 받아쓰기</Text>
        {/*
          ⚠️ 앱이 백그라운드로 밀리면 받아쓰기는 그 자리에서 멈춘다 — 실패가 아니라 **설계**다
          (→ `lib/asr-local.ts`). 그 사실을 적어야 사용자가 「고장 난 작업」으로 읽지 않는다.
        */}
        <Text style={s.meta}>앱을 벗어나면 받아쓰기가 멈춰요. 여기서 이어 하면 끝낸 부분 다음부터 계속합니다.</Text>
        <View style={styles.jobs}>
          {jobs.map((job, index) => <JobRow
            key={job.callId}
            job={job}
            first={index === 0}
            confirming={confirmJob === job.callId}
            onOpen={() => openAsrRun(job.callId)}
            onAsk={() => { setConfirmJob(job.callId); setError(''); setNotice(''); }}
            onCancel={() => setConfirmJob(null)}
            onDrop={() => void dropJob(job.callId)}
          />)}
        </View>
      </View> : null}
    </SmsPage>
  );
}

/**
 * 기본으로 고르고, 화면이 권하는 모델.
 *
 * 🔴 **Metal/NPU 경로에서는 q8_0 이 더 빠르고 더 정확했다.** 「작을수록 빠르다」는 직관이
 * 여기서는 틀린다 — 양자화가 낮으면 GPU 경로를 못 타거나(안드로이드 Hexagon) 역양자화
 * 비용이 더 든다. 값을 바꾸려면 실측을 먼저 하라(→ `docs/on-device-asr.md`).
 */
const RECOMMENDED: AsrModelId = 'q8_0';

/**
 * 진행 중이던 받아쓰기를 이어 하는 화면으로.
 *
 * 🔴 **통화 ID 만 넘긴다.** `/asr-run` 은 원본 경로·모델·크기도 받지만(→ `app/asr-run.tsx`),
 * 그것들은 **새로 시작할 때** 필요한 값이다. 여기서 보내는 것은 이미 중간까지 간 작업이라,
 * 그 값들은 디스크의 이어하기 상태가 이미 들고 있다(→ `lib/asr-local-types.ts` 의
 * `AsrLocalState`). ⚠️ 여기서 다시 넘기면 **저장된 것과 어긋날 수 있고**, 그때 엔진은
 * 이어하기를 버리고 처음부터 다시 돈다.
 */
function openAsrRun(callId: string) {
  router.push({ pathname: '/asr-run', params: { callId } });
}

/**
 * 판정의 **근거**.
 *
 * 🔴 이 표가 이 화면의 존재 이유다. 「안 됩니다」 한 줄만 있으면 사용자는 앱을 의심하지만,
 * 「엑시노스 · 인코더 31초 · 28분 통화에 2시간 10분」이 함께 있으면 기기의 한계로 읽는다.
 * ⚠️ **없는 값은 줄을 만들지 않는다** — 재 보기 전에 결론이 난 판정(AP 가 퀄컴이 아님)에는
 * 인코더 시간이 없고, 거기에 0 을 적으면 재 본 것처럼 보인다.
 */
function Evidence({ capability }: { capability: AsrCapability }) {
  const rows: { label: string; value: string }[] = [];
  if (capability.estimateMs !== null) rows.push({ label: '28분 통화 예상', value: asrDurationLabel(capability.estimateMs) });
  if (capability.encodeMs !== null) {
    rows.push({ label: '30초 인코더', value: `${Math.round(capability.encodeMs)}ms (기준 ${ASR_ENCODE_LIMIT_MS}ms 이하)` });
  }
  if (capability.benchConfig) rows.push({ label: '백엔드', value: capability.benchConfig });
  if (capability.gpu !== null) {
    // 🔴 기대가 아니라 **결과**다. NPU 를 켜도 조용히 CPU 로 떨어지는 것이 이 기능의 함정이다.
    rows.push({
      label: Platform.OS === 'ios' ? 'Metal' : 'NPU',
      value: capability.gpu ? '잡혔어요' : '안 잡혀 CPU 로 돌았어요',
    });
  }
  if (capability.threads !== null) rows.push({ label: '스레드', value: String(capability.threads) });
  const soc = socText(capability.soc);
  if (soc) rows.push({ label: 'AP', value: soc });
  rows.push({ label: '모델', value: capability.modelId });
  // 🔴 시:분을 적지 않는다. 판정은 며칠 전 것일 수 있고, 여기서 중요한 것은 「언제쯤」뿐이다.
  rows.push({ label: '잰 때', value: sessionDayLabel(new Date(capability.checkedAt).toISOString()) || '알 수 없음' });

  return <View style={styles.rows}>
    {rows.map((row) => <View key={row.label} style={styles.row}>
      <Text style={styles.rowLabel}>{row.label}</Text>
      {/* 눌러 복사할 수 있어야 문의할 때 그대로 옮겨 적는다. */}
      <Text selectable style={styles.rowValue}>{row.value}</Text>
    </View>)}
  </View>;
}

/**
 * 모델 한 줄.
 *
 * 고르기·내려받기·지우기가 **한 덩이**에 있다. 고르는 자리와 버튼을 갈라 두면 「어느 모델을
 * 지우는 건가」가 화면에서 사라진다.
 * ⚠️ **고르는 `Pressable` 안에 버튼을 넣지 않는다.** react-native-web 에서는 이벤트가 위로
 * 올라가 「지우기」를 누른 것이 고르기까지 함께 일으킨다(→ `app/devices.tsx` 의 같은 함정).
 */
function ModelRow({
  model, status, selected, recommended, freeBytes, blocked, downloading, downloadedBytes, busy,
  confirming, onSelect, onDownload, onCancel, onAskRemove, onCancelRemove, onRemove,
}: {
  model: AsrModel;
  status: AsrModelStatus | undefined;
  selected: boolean;
  recommended: boolean;
  freeBytes: number | null;
  /** 🔴 받아도 쓸 수 없는 기기인가. 참이면 **받기와 고르기만** 잠근다 — 지우기는 열어 둔다. */
  blocked: boolean;
  downloading: boolean;
  downloadedBytes: number;
  busy: boolean;
  confirming: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
}) {
  const installed = !!status?.installed;
  const partial = status?.partialBytes ?? 0;
  // 🔴 「받을 공간이 있나」의 기준은 엔진과 같아야 한다 — 모델 크기 + 300MB(→ `lib/asr-models.ts`).
  const tight = freeBytes !== null && freeBytes + partial < model.bytes + 300 * 1024 ** 2;
  const percent = model.bytes > 0 ? (downloadedBytes / model.bytes) * 100 : 0;

  return <View style={[styles.model, selected && styles.modelOn]}>
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      // aria-* 로도 적는다. react-native-web 은 RN 의 `checked` 상태를 옮기지 않는다(→ `components/sms-ui.tsx`).
      aria-checked={selected}
      accessibilityLabel={`${model.label} ${installed ? '내려받음' : '없음'} 고르기`}
      // 고르기는 「이 모델로 재 본다」는 뜻이다. 잴 수 없는 기기에서는 고를 일도 없다.
      disabled={busy || blocked}
      onPress={onSelect}
      style={styles.modelHead}
    >
      <Text style={[s.body, styles.modelName]} numberOfLines={1}>{selected ? '◉' : '○'} {model.label}</Text>
      {recommended ? <Text style={styles.badge}>권장</Text> : null}
      <Text style={[s.meta, installed && { color: colors.greenText }]}>{installed ? '내려받음' : '없음'}</Text>
    </Pressable>

    {/*
      🔴 **q5_0 의 「NPU 가 못 돌린다」는 안드로이드 Hexagon 이야기다.** `asr-models.ts` 의
      `note` 를 그대로 옮기면 아이폰 사용자가 없는 제약을 믿고 q5_0 을 피하게 된다 —
      iOS 는 Metal 이라 두 양자화 모두 GPU 로 돈다.
    */}
    <Text style={s.meta}>{backendNote(model)}</Text>

    {downloading ? <>
      {/* 진행률은 서버가 알려 준 실제 바이트 수다 — 지어내지 않는다. */}
      <ProgressBar percent={percent} label={`${model.label} 내려받기`} />
      <Text style={s.meta}>{sizeLabel(downloadedBytes)} / {sizeLabel(model.bytes)}</Text>
      <SmsButton secondary label="멈추기" onPress={onCancel} />
    </> : installed ? <>
      {/*
        🔴 확인을 받는 동안에는 「지우기」를 **치운다**(비활성으로 두지 않는다). 같은 이름의
        버튼이 위아래로 둘이면 어느 쪽이 진짜인지 고르느라 한 번 더 멈춘다(→ `app/devices.tsx`).
      */}
      {confirming ? <>
        <Text style={s.meta}>지우면 {sizeLabel(model.bytes)} 를 다시 받아야 해요.</Text>
        <ButtonRow>
          <SmsButton fill label="지우기 확인" accessibilityLabel={`${model.label} 지우기 확인`} disabled={busy} onPress={onRemove} />
          <SmsButton fill secondary label="취소" disabled={busy} onPress={onCancelRemove} />
        </ButtonRow>
      </> : <View style={styles.modelAction}>
        <SmsButton secondary danger label="지우기" accessibilityLabel={`${model.label} 지우기`} disabled={busy} onPress={onAskRemove} />
      </View>}
    </> : <>
      {/* ⚠️ 「이어받는다」고 단정하지 않는다. OS 가 이어받기 정보를 주지 못하면 처음부터 받는다. */}
      {partial > 0 ? <Text style={s.meta}>{sizeLabel(partial)} 받아 뒀어요. 가능하면 이어받고, 안 되면 처음부터 받습니다.</Text> : null}
      {tight ? <Text style={[s.meta, { color: colors.red }]}>남은 공간이 모자라요. {sizeLabel(model.bytes + 300 * 1024 ** 2)} 이상을 비운 뒤 받아 주세요.</Text> : null}
      {/*
        🔴 **버튼만 흐려 두지 않는다.** 눌리지 않는 버튼 옆에 이유가 없으면 사용자는 앱이
        고장 난 줄 알고 계속 누른다. 자세한 사유는 이 카드 머리의 한 줄이 말하고, 여기서는
        **지금 이 버튼이 왜 잠겼는지**만 짧게 되짚는다.
      */}
      {blocked ? <Text style={[s.meta, { color: colors.red }]}>이 기기에는 받아쓰기가 쓰는 NPU 가 없어 내려받아도 쓸 수 없어요. 위 설명을 보세요.</Text> : null}
      <SmsButton
        label={`${model.label} 내려받기`}
        accessibilityLabel={`${model.label} 내려받기`}
        disabled={busy || blocked}
        onPress={onDownload}
      />
    </>}
  </View>;
}

/**
 * 진행 중인 받아쓰기 한 줄.
 *
 * ⚠️ 여닫는 자리(줄 누르기)와 버튼은 **형제**로 둔다 — 겹쳐 두면 react-native-web 에서
 * 「지우기」가 이동까지 함께 일으킨다(→ `app/devices.tsx`).
 */
function JobRow({ job, first, confirming, onOpen, onAsk, onCancel, onDrop }: {
  job: AsrLocalState;
  first: boolean;
  confirming: boolean;
  onOpen: () => void;
  onAsk: () => void;
  onCancel: () => void;
  onDrop: () => void;
}) {
  // 🔴 진행률은 **끝난 청크의 오프셋**이다. 시간으로 어림한 값이 아니다(→ `lib/asr-local-types.ts`).
  const progress = asrLocalProgress(job);
  const percent = Math.round(progress.ratio * 100);
  const done = asrDurationLabel(progress.doneMs);
  return <View style={[styles.job, first && styles.jobFirst]}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.sourceName} 이어서 받아쓰기, ${percent}퍼센트`}
      onPress={onOpen}
      style={styles.jobMain}
    >
      <Text style={[s.body, styles.jobName]} numberOfLines={1}>{job.sourceName}</Text>
      <Text style={s.meta}>{done} / {asrDurationLabel(progress.totalMs)} · {percent}% · {job.modelId}</Text>
      <Text style={s.meta}>마지막 진행 {sessionDayLabel(new Date(job.updatedAt).toISOString()) || '알 수 없음'}</Text>
    </Pressable>
    <ProgressBar percent={progress.ratio * 100} label={`${job.sourceName} 진행률`} />
    {confirming ? <View style={styles.jobConfirm}>
      {/* 🔴 무엇을 잃는지 **분 단위로** 적는다. 「지울까요?」만으로는 12분치가 걸린 줄 모른다. */}
      <Text style={s.meta}>이미 받아쓴 {done} 도 함께 사라져요. 되돌릴 수 없어요.</Text>
      <ButtonRow>
        <SmsButton fill label="지우기 확인" accessibilityLabel={`${job.sourceName} 지우기 확인`} onPress={onDrop} />
        <SmsButton fill secondary label="취소" onPress={onCancel} />
      </ButtonRow>
    </View> : <View style={styles.jobAction}>
      <SmsButton secondary danger label="지우기" accessibilityLabel={`${job.sourceName} 지우기`} onPress={onAsk} />
    </View>}
  </View>;
}

/**
 * 이 양자화가 **이 플랫폼에서** 어떤 경로로 도는가.
 *
 * 🔴 `asr-models.ts` 의 `note` 를 그대로 쓰지 않는 이유가 여기 있다 — 그 문장은 안드로이드
 * 기준이다. iOS 에서 「NPU 가 q5 를 못 돌린다」를 보여 주면, 있지도 않은 제약 때문에
 * 300MB 작은 선택지를 스스로 지우게 된다.
 */
function backendNote(model: AsrModel): string {
  if (Platform.OS === 'ios') return '아이폰은 Metal 로 돌아서 두 양자화 모두 GPU 를 씁니다.';
  return model.npuCapable
    ? '스냅드래곤 NPU(Hexagon)가 돌릴 수 있는 양자화입니다.'
    : '⚠️ 안드로이드 NPU(Hexagon)는 q5 를 돌리지 못해 CPU 로 떨어집니다.';
}

/**
 * AP 문자열을 한 줄로.
 *
 * ⚠️ **해석하지 않고 그대로 잇는다.** 이 값이 판정의 근거이므로, 화면이 예쁘게 다듬으면
 * 「왜 막혔지」를 물어 온 사람에게 답할 근거가 사라진다. 같은 값이 두 칸에 들어 있는 기기가
 * 흔해서 중복만 걷는다.
 */
function socText(soc: SocInfo | null): string {
  if (!soc) return '';
  const parts = [soc.manufacturer, soc.model, soc.hardware, soc.board]
    .map((value) => (value ?? '').trim())
    .filter((value) => value && value.toLowerCase() !== 'unknown');
  return [...new Set(parts)].join(' · ');
}

/**
 * 바이트를 사람이 읽는 크기로.
 *
 * 🔴 **1024 단위다.** `ASR_MODELS` 의 이름표가 그 기준이라(`q8_0 (834MB)` = 874,188,075B ÷
 * 1024² = 833.7), 1000 으로 나누면 바로 위 줄에 「q8_0 (834MB)」, 아래 줄에 「874MB 받는
 * 중」이 나란히 서서 **사용자가 두 숫자 중 어느 쪽이 맞는지 알 수 없게 된다.** 저장 공간
 * 여유분(`300 * 1024 ** 2`)도 엔진이 같은 단위로 센다(→ `lib/asr-models.ts`).
 */
function sizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '알 수 없음';
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${Math.round(bytes / 1024 ** 2)}MB`;
}

const styles = StyleSheet.create({
  rows: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  /** 이름 칸은 고정 폭이다 — 값이 세로로 맞아야 두 판정을 나란히 놓고 비교할 수 있다. */
  rowLabel: { ...fonts.body, fontSize: text.md, color: colors.mid, width: 104 },
  /** 값은 모노다. 읽는 글이 아니라 **대조하는 값**이라 고정폭이 낫다(→ `app/devices.tsx`). */
  rowValue: { ...fonts.mono, fontSize: text.base, lineHeight: 18, color: colors.ink, flex: 1 },

  model: { borderTopWidth: 1, borderColor: colors.borderCard, paddingTop: spacing.md, gap: spacing.sm },
  /**
   * 🔴 **고른 모델은 바탕색으로도 갈린다.** 동그라미 하나로만 가르면 그것을 못 본 사람이
   * 다른 모델을 재 놓고 「왜 안 되지」를 묻는다.
   * ⚠️ 색만으로 뜻을 전하지 않는다 — ◉/○ 와 접근성 상태가 같은 말을 한다.
   */
  modelOn: { backgroundColor: colors.sageRow, marginHorizontal: -spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radii.chip },
  // `minHeight` 은 손가락이 닿을 자리다. 48 미만이면 옆 모델을 같이 눌러 엉뚱한 쪽이 골라진다.
  modelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  modelName: { flexShrink: 1, color: colors.ink },
  /** 버튼은 오른쪽 끝에 붙여 폭만큼만 차지한다 — 줄마다 화면 폭짜리 막대가 서면 목록이 아니다. */
  modelAction: { flexDirection: 'row', justifyContent: 'flex-end' },

  jobs: {},
  job: { borderBottomWidth: 1, borderColor: colors.borderCard, paddingBottom: spacing.md, gap: spacing.sm },
  /** 첫 줄 위의 선. 나머지 줄의 위쪽은 앞 줄의 아래 선이 긋는다. */
  jobFirst: { borderTopWidth: 1, borderColor: colors.borderCard, paddingTop: spacing.md },
  jobMain: { gap: spacing.xs, paddingVertical: spacing.xs, minHeight: 48, justifyContent: 'center' },
  jobName: { color: colors.ink },
  jobAction: { flexDirection: 'row', justifyContent: 'flex-end' },
  jobConfirm: { gap: spacing.sm },

  /** 「권장」 — 설정·기기 목록의 상태 배지와 같은 규격이다(→ `app/settings.tsx`). */
  badge: {
    ...fonts.bodySemi, fontSize: text.md, color: colors.ink, backgroundColor: colors.inkFill,
    borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, overflow: 'hidden',
  },
});
