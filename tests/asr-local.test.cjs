const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const realms = { Error, Set, Map, JSON, Date, Number, Math, RegExp, String, Promise, Array, Object };
const load = (file, mocks = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports,require){${compile(file)}\n})`, { ...realms })(module.exports, name => {
    if (!(name in mocks)) throw new Error(`unmocked ${name}`);
    return mocks[name];
  });
  return module.exports;
};

// 🔴 순수 계산은 **실제 구현을 그대로** 쓴다. 가짜로 바꾸면 청크 경계를 검사하는 의미가 없다.
const types = load('src/lib/asr-local-types.ts');
const { ASR_CHUNK_MS, ASR_STATE_VERSION, asrChunks, asrChunkCount, asrChunkAt, asrChunkSegments, asrLocalRatio, asrLocalText, resumableState, isAsrLocalState, freshAsrLocalState } = types;

const TOTAL = 600_000; // 10분 = 120초짜리 5청크
const CALL_ID = 'call-1';
const WAV = 'file:///doc/asr-bench/input-16k.wav';
const DIRECTORY = 'file:///doc/asr-local/';
const STATE_URI = `${DIRECTORY}call-1.json`;

const input = (extra = {}) => ({
  callId: CALL_ID, wavUri: WAV, sourceName: '통화.m4a', sourceBytes: 1000, modelId: 'q8_0', totalMs: TOTAL, ...extra,
});

/**
 * 엔진 하나를 세운다.
 *
 * ⚠️ whisper 는 여기서 돌릴 수 없으므로 **전사·세션만** 가짜로 바꾼다. 상태 저장은 실제
 * 구현(`expo-file-system` 만 가짜)을 그대로 태운다 — 「이어하기」의 절반은 그 코드다.
 */
function setup(seed = {}) {
  const files = new Map();
  /** 만들어진 폴더. 🔴 **없는 폴더를 읽으면 진짜 파일시스템처럼 던져야 한다** — 목록 API 가
   * 그 예외를 「한 번도 받아쓴 적이 없다」로 읽는지가 검사할 거리다. */
  const dirs = new Set();
  const windows = [];      // 전사기가 실제로 받은 창들
  const sessions = { opened: 0, closed: 0 };
  let backgroundCb = null;
  let foreground = true;
  let clock = 1_000;

  const mocks = {
    'expo-file-system/legacy': {
      documentDirectory: 'file:///doc/',
      makeDirectoryAsync: async uri => { dirs.add(uri); },
      writeAsStringAsync: async (uri, text) => { files.set(uri, text); },
      readAsStringAsync: async uri => { if (!files.has(uri)) throw new Error('ENOENT'); return files.get(uri); },
      deleteAsync: async uri => { files.delete(uri); },
      readDirectoryAsync: async uri => {
        if (!dirs.has(uri)) throw new Error('ENOENT');
        return [...files.keys()].filter(key => key.startsWith(uri)).map(key => key.slice(uri.length));
      },
    },
    // 기본 deps 가 만들어질 때만 닿는다. 테스트는 전부 주입한 쪽을 쓴다.
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    './asr-run': {
      openAsrSession: async () => { throw new Error('실제 whisper 를 열면 안 된다'); },
      closeAsrSession: async () => {},
      transcribeAsr: () => { throw new Error('실제 whisper 를 돌리면 안 된다'); },
    },
    './call-native': { excludeFromBackup: async () => {} },
    './asr-local-types': types,
  };

  const engine = load('src/lib/asr-local.ts', mocks);

  const deps = {
    now: () => (clock += 10),
    openSession: async () => { sessions.opened += 1; return { id: sessions.opened }; },
    closeSession: async () => { sessions.closed += 1; },
    isForeground: () => foreground,
    watchBackground: cb => { backgroundCb = cb; return () => { backgroundCb = null; }; },
    transcribeChunk: (session, wavUri, threads, window, onPercent) => {
      const index = windows.length;
      windows.push({ ...window, wavUri, threads });
      const plan = seed.chunk?.(index, window) ?? {};
      let stopped = false;
      return {
        stop: () => { stopped = true; },
        promise: new Promise((resolve, reject) => {
          // whisper 는 진행률을 나중에 준다. 그 사이에 stop() 이 들어올 수 있어야 한다.
          setTimeout(() => {
            onPercent(50);
            setTimeout(() => {
              if (plan.fail) { reject(new Error(plan.fail)); return; }
              // 🔴 **창 안에서의 시각**을 준다(0부터). 실제 `transcribeAsr` 의 계약이 그렇고,
              // 오프셋을 더하는 것은 엔진의 몫이다 — 여기서 미리 더해 주면 검사가 무의미해진다.
              const segments = plan.segments ?? [{ startMs: 0, endMs: 5_000, text: `말${index}` }];
              resolve({ text: plan.text ?? `조각${index}`, segments, aborted: stopped || !!plan.aborted, elapsedMs: 1 });
            }, 0);
          }, 0);
        }),
      };
    },
  };

  const state = () => (files.has(STATE_URI) ? JSON.parse(files.get(STATE_URI)) : null);
  const seedState = value => { dirs.add(DIRECTORY); files.set(STATE_URI, JSON.stringify(value)); };
  /** 상태 폴더에 파일 하나를 그대로 놓는다(깨진 것·우리 것이 아닌 것까지). */
  const seedFile = (name, text) => { dirs.add(DIRECTORY); files.set(`${DIRECTORY}${name}`, text); };
  const makeDir = () => dirs.add(DIRECTORY);
  return {
    engine, deps, windows, sessions, state, seedState, seedFile, makeDir,
    goBackground: () => { foreground = false; backgroundCb?.(); },
    setForeground: value => { foreground = value; },
  };
}

function run(harness, options = {}, overrides = {}) {
  const ref = {};
  ref.handle = harness.engine.runLocalAsr(input(overrides.input), {
    threads: 4,
    deps: harness.deps,
    onProgress: p => { options.onProgress?.(p, ref.handle); },
    ...options.engine,
  });
  return ref;
}

test('청크는 120초씩이고 마지막 하나만 짧다', () => {
  assert.equal(ASR_CHUNK_MS, 120_000);
  // 28분 정각이면 딱 14개다.
  assert.equal(asrChunkCount(1_680_000), 14);
  // 28분 26초는 14개 + 26초짜리 꼬리 하나.
  const long = asrChunks(1_706_000);
  assert.equal(long.length, 15);
  assert.equal(long[14].offsetMs, 1_680_000);
  assert.equal(long[14].durationMs, 26_000);
  // 🔴 마지막 창이 파일 끝을 넘지 않는다. 넘겨 부르면 whisper 가 없는 구간을 읽는다.
  assert.equal(long[14].offsetMs + long[14].durationMs, 1_706_000);
  // 앞의 것들은 전부 120초.
  assert.deepEqual([...new Set(long.slice(0, 14).map(c => c.durationMs))], [120_000]);
  // 길이가 한 청크보다 짧아도 한 개다.
  assert.equal(asrChunks(20_000).length, 1);
  assert.equal(asrChunks(20_000)[0].durationMs, 20_000);
  // 길이를 모르면 아무것도 돌리지 않는다.
  // ⚠️ vm 밖 realm 과 배열을 직접 비교하지 않는다(다른 Array 생성자다). 길이·값만 본다.
  assert.equal(asrChunks(0).length, 0);
  assert.equal(asrChunks(Number.NaN).length, 0);
});

test('이어할 때 청크 번호는 파일 처음부터 센 값 그대로다', () => {
  const rest = asrChunks(600_000, 240_000);
  assert.equal(rest.map(c => c.index).join(','), '2,3,4');
  assert.equal(rest.map(c => c.offsetMs).join(','), '240000,360000,480000');
  // 끝까지 간 지점에는 돌릴 청크가 없다.
  assert.equal(asrChunkAt(600_000, 600_000), null);
  assert.equal(asrChunkAt(600_000, -1), null);
});

test('처음부터 끝까지 돌면 조각을 이어 붙이고 상태를 지운다', async () => {
  const harness = setup();
  const result = await run(harness).handle.promise;
  assert.equal(result.done, true);
  assert.equal(result.reason, 'done');
  assert.equal(result.chunksRun, 5);
  assert.equal(result.text, '조각0 조각1 조각2 조각3 조각4');
  // 🔴 끝났으면 이어하기 상태는 남지 않는다. 남으면 다음에 「이어서 할까요」를 묻게 된다.
  assert.equal(result.state, null);
  assert.equal(harness.state(), null);
  // 창은 겹치지도 비지도 않는다.
  assert.deepEqual(harness.windows.map(w => w.offsetMs), [0, 120_000, 240_000, 360_000, 480_000]);
  assert.deepEqual([...new Set(harness.windows.map(w => w.durationMs))], [120_000]);
  // ⚠️ 모델 적재가 17.8초다. 한 번 열어 다섯 청크를 돌리고 끝에 한 번 닫는다.
  assert.deepEqual(harness.sessions, { opened: 1, closed: 1 });
});

test('저장된 오프셋이 있으면 거기서 이어간다', async () => {
  const harness = setup();
  harness.seedState({
    version: 1, callId: CALL_ID, wavUri: WAV, sourceName: '통화.m4a', sourceBytes: 1000,
    modelId: 'q8_0', totalMs: TOTAL, nextOffsetMs: 240_000, pieces: ['먼저0', '먼저1'], startedAt: 1, updatedAt: 2,
  });
  const result = await run(harness).handle.promise;
  // 🔴 앞의 2청크를 다시 돌리지 않는다. 다시 돌리면 4분을 헛되이 태운다.
  assert.deepEqual(harness.windows.map(w => w.offsetMs), [240_000, 360_000, 480_000]);
  assert.equal(result.chunksRun, 3);
  // 저장돼 있던 조각이 앞에 그대로 남는다.
  assert.equal(result.text, '먼저0 먼저1 조각0 조각1 조각2');
  assert.equal(result.done, true);
});

test('다른 파일·다른 모델의 상태로는 이어가지 않는다', async () => {
  const saved = {
    version: 1, callId: CALL_ID, wavUri: 'file:///doc/다른.wav', sourceName: 'x', sourceBytes: 1,
    modelId: 'q8_0', totalMs: TOTAL, nextOffsetMs: 240_000, pieces: ['가', '나'], startedAt: 1, updatedAt: 2,
  };
  // 🔴 경로가 다르면 그 오프셋은 의미가 없다. 그대로 이어가면 앞부분이 빠진 전사문이 나온다.
  assert.equal(resumableState(saved, input()), null);
  assert.equal(resumableState({ ...saved, wavUri: WAV, modelId: 'q5_0' }, input()), null);
  assert.equal(resumableState({ ...saved, wavUri: WAV, totalMs: 999 }, input()), null);
  // 끝난 청크 수와 조각 수가 어긋난 파일도 믿지 않는다.
  assert.equal(resumableState({ ...saved, wavUri: WAV, pieces: ['가'] }, input()), null);
  assert.equal(resumableState({ ...saved, wavUri: WAV }, input()).nextOffsetMs, 240_000);

  const harness = setup();
  harness.seedState(saved);
  const result = await run(harness).handle.promise;
  assert.deepEqual(harness.windows.map(w => w.offsetMs), [0, 120_000, 240_000, 360_000, 480_000]);
  assert.equal(result.text, '조각0 조각1 조각2 조각3 조각4');
});

test('🔴 돌다 만 청크의 텍스트는 결과에도 상태에도 들어가지 않는다', async () => {
  // 세 번째 청크가 절반쯤 가다 멈췄다(백그라운드로 밀렸을 때 whisper 가 돌려주는 모양).
  const harness = setup({ chunk: index => (index === 2 ? { aborted: true, text: '버려질절반' } : {}) });
  const result = await run(harness).handle.promise;
  assert.equal(result.done, false);
  assert.equal(result.text, '조각0 조각1');
  assert.equal(result.text.includes('버려질절반'), false);
  // 디스크에도 없다. 이어할 때 이 절반이 되살아나면 같은 구간이 결과에 두 번 남는다.
  const saved = harness.state();
  assert.deepEqual(saved.pieces, ['조각0', '조각1']);
  assert.equal(saved.nextOffsetMs, 240_000);
  assert.equal(JSON.stringify(saved).includes('버려질절반'), false);
  // 🔴 잃은 것은 딱 그 2분치다. 이어하면 240,000ms 부터 다시 한다.
  assert.equal(result.state.nextOffsetMs, 240_000);
});

test('취소하면 거기까지가 저장돼 있고 세션은 닫힌다', async () => {
  const harness = setup();
  const ref = run(harness, {
    // 세 번째 청크가 도는 중에 사용자가 멈춘다.
    onProgress: (p, handle) => { if (p.chunkIndex === 2 && p.chunkPercent === 50) handle.cancel(); },
  });
  const result = await ref.handle.promise;
  assert.equal(result.reason, 'canceled');
  assert.equal(result.done, false);
  assert.equal(result.chunksRun, 2);
  assert.equal(result.text, '조각0 조각1');
  // 🔴 멈춘 지점까지는 남아 있어야 한다. 없으면 4분을 다시 기다린다.
  const saved = harness.state();
  assert.equal(saved.nextOffsetMs, 240_000);
  assert.deepEqual(saved.pieces, ['조각0', '조각1']);
  // ⚠️ 834MB 를 쥔 채 두면 앱이 죽는다. 멈출 때도 반드시 닫는다.
  assert.deepEqual(harness.sessions, { opened: 1, closed: 1 });
});

test('취소한 뒤 다시 부르면 저장된 지점부터 이어간다', async () => {
  const harness = setup();
  const first = run(harness, {
    onProgress: (p, handle) => { if (p.chunkIndex === 2 && p.chunkPercent === 50) handle.cancel(); },
  });
  await first.handle.promise;
  harness.windows.length = 0;
  const result = await run(harness).handle.promise;
  assert.deepEqual(harness.windows.map(w => w.offsetMs), [240_000, 360_000, 480_000]);
  assert.equal(result.done, true);
  assert.equal(result.text, '조각0 조각1 조각0 조각1 조각2');
  assert.equal(harness.state(), null);
});

test('백그라운드로 밀리면 멈추고, 돌아오면 이어간다', async () => {
  const harness = setup();
  const result = await run(harness, {
    onProgress: p => { if (p.chunkIndex === 1 && p.chunkPercent === 50) harness.goBackground(); },
  }).handle.promise;
  // ⚠️ iOS 는 백그라운드 앱에 CPU 를 주지 않는다. 돌던 청크는 그대로 버린다.
  assert.equal(result.reason, 'background');
  assert.equal(result.text, '조각0');
  assert.deepEqual(harness.sessions, { opened: 1, closed: 1 });
  assert.equal(harness.state().nextOffsetMs, 120_000);

  harness.setForeground(true);
  harness.windows.length = 0;
  const resumed = await run(harness).handle.promise;
  assert.deepEqual(harness.windows.map(w => w.offsetMs), [120_000, 240_000, 360_000, 480_000]);
  assert.equal(resumed.done, true);
});

test('백그라운드 상태에서는 청크를 시작조차 하지 않는다', async () => {
  const harness = setup();
  harness.setForeground(false);
  const result = await run(harness).handle.promise;
  assert.deepEqual(harness.windows, []);
  assert.equal(result.reason, 'background');
  // 세션도 열지 않는다 — 17.8초를 들여 834MB 를 올려 놓고 아무것도 못 한다.
  assert.deepEqual(harness.sessions, { opened: 0, closed: 0 });
});

test('진행률은 끝난 오프셋 / 전체 길이이고 0~1 을 벗어나지 않는다', async () => {
  const harness = setup();
  const seen = [];
  await run(harness, { onProgress: p => seen.push(p) }).handle.promise;
  for (const p of seen) {
    assert.ok(p.ratio >= 0 && p.ratio <= 1, `범위 밖 진행률: ${p.ratio}`);
    // 🔴 지어낸 값이 아니다 — 저장된 오프셋을 전체 길이로 나눈 것뿐이다.
    assert.equal(p.ratio, p.doneMs / p.totalMs);
    assert.equal(p.totalMs, TOTAL);
    assert.equal(p.chunkCount, 5);
    assert.ok(p.chunkPercent === null || (p.chunkPercent >= 0 && p.chunkPercent <= 100));
  }
  // 첫 보고는 0, 마지막은 1. 되돌아가는 구간은 없다.
  assert.equal(seen[0].ratio, 0);
  assert.equal(seen[seen.length - 1].ratio, 1);
  const ratios = seen.map(p => p.ratio);
  assert.deepEqual(ratios, [...ratios].sort((a, b) => a - b));
  // 청크가 끝날 때마다 20%씩 — 그 사이를 시간으로 메우지 않는다.
  assert.deepEqual([...new Set(ratios)], [0, 0.2, 0.4, 0.6, 0.8, 1]);
  // whisper 가 준 청크 진행률은 따로 실려 온다(우리가 센 값이 아니다).
  assert.ok(seen.some(p => p.chunkPercent === 50));
  assert.equal(asrLocalRatio({ nextOffsetMs: 5, totalMs: 0 }), 0);
  assert.equal(asrLocalRatio({ nextOffsetMs: 999, totalMs: 100 }), 1);
});

test('전사가 실패하면 상태를 남긴 채 거절한다', async () => {
  // 🔴 일시적인 실패에서 상태까지 지우면 이미 끝낸 4분치가 함께 사라진다.
  const harness = setup({ chunk: index => (index === 2 ? { fail: 'OOM' } : {}) });
  const error = await run(harness).handle.promise.catch(e => e);
  assert.equal(error.message, 'OOM');
  assert.equal(harness.state().nextOffsetMs, 240_000);
  assert.deepEqual(harness.sessions, { opened: 1, closed: 1 });
  // 포기는 부른 쪽이 정한다.
  await harness.engine.clearAsrLocalState(CALL_ID);
  assert.equal(harness.state(), null);
});

test('끝자락이 짧은 통화도 마지막 창을 넘겨 부르지 않는다', async () => {
  const harness = setup();
  // 28분 26초. 14개 + 26초짜리 하나.
  const result = await run(harness, {}, { input: { totalMs: 1_706_000 } }).handle.promise;
  assert.equal(harness.windows.length, 15);
  assert.equal(harness.windows[14].durationMs, 26_000);
  assert.equal(result.done, true);
  assert.equal(result.chunksRun, 15);
});

test('깨진 상태 파일은 믿지 않고 처음부터 시작한다', async () => {
  const harness = setup();
  harness.seedState({ version: 1, callId: CALL_ID, nextOffsetMs: 'NaN' });
  assert.equal(isAsrLocalState({ version: 1, callId: CALL_ID, nextOffsetMs: 'NaN' }), false);
  const result = await run(harness).handle.promise;
  assert.deepEqual(harness.windows.map(w => w.offsetMs)[0], 0);
  assert.equal(result.done, true);
});

test('조각을 이어 붙일 때 빈 조각은 버리고 빈칸 하나로 잇는다', () => {
  assert.equal(asrLocalText([' 가나 ', '', '   ', '다라']), '가나 다라');
  assert.equal(asrLocalText([]), '');
});

// ──────────────────────────────────────────────────────────────
// 진행 중인 받아쓰기 목록 (`listAsrLocalStates`)
//
// 🔴 **설정 화면이 폴더를 직접 훑던 코드를 여기로 옮겼다.** 화면이 경로 상수를 복제해 두면
// 엔진이 폴더를 옮기는 날 목록이 **오류 없이 조용히 비어** 「하던 일이 사라졌다」로 보인다.
// 그 판단(무엇을 건너뛰고 어떻게 정렬하나)이 이제 엔진에 있으므로 여기서 검사한다.
// ──────────────────────────────────────────────────────────────

/** 목록 검사용 상태 하나. 값이 `isAsrLocalState` 를 통과해야 한다. */
const savedState = (callId, updatedAt, extra = {}) => ({
  version: 1, callId, wavUri: `file:///doc/asr-bench/${callId}.wav`,
  sourceName: `${callId}.m4a`, sourceBytes: 1000, modelId: 'q8_0',
  totalMs: TOTAL, nextOffsetMs: 0, pieces: [], startedAt: 1, updatedAt, ...extra,
});

test('상태 폴더가 아예 없으면 빈 목록이다(오류가 아니다)', async () => {
  const harness = setup();
  // 🔴 던지면 안 된다 — 한 번도 받아쓴 적 없는 사람이 설정을 열면 화면이 오류로 선다.
  // ⚠️ vm 밖 realm 과 배열을 직접 비교하지 않는다(다른 Array 생성자다). 길이만 본다.
  assert.equal((await harness.engine.listAsrLocalStates()).length, 0);
});

test('폴더는 있는데 비었으면 빈 목록이다', async () => {
  const harness = setup();
  harness.makeDir();
  assert.equal((await harness.engine.listAsrLocalStates()).length, 0);
});

test('최근에 움직인 것이 앞에 온다', async () => {
  const harness = setup();
  harness.seedFile('call-a.json', JSON.stringify(savedState('call-a', 100)));
  harness.seedFile('call-b.json', JSON.stringify(savedState('call-b', 300)));
  harness.seedFile('call-c.json', JSON.stringify(savedState('call-c', 200)));
  const list = await harness.engine.listAsrLocalStates();
  assert.equal(list.map(s => s.callId).join(','), 'call-b,call-c,call-a');
});

test('깨진 파일과 우리 것이 아닌 파일은 목록을 비우지 않고 건너뛴다', async () => {
  const harness = setup();
  harness.seedFile('call-a.json', JSON.stringify(savedState('call-a', 100)));
  // JSON 이 아니다.
  harness.seedFile('broken.json', '{어쩌구');
  // JSON 이지만 우리가 쓴 모양이 아니다(오프셋이 숫자가 아니다).
  harness.seedFile('bad.json', JSON.stringify({ version: 1, callId: 'bad', nextOffsetMs: 'NaN' }));
  // 확장자가 다르다 — 받아쓰기 상태가 아니다.
  harness.seedFile('call-a.wav', '음성');
  const list = await harness.engine.listAsrLocalStates();
  // 🔴 성한 것 하나는 반드시 남는다. 깨진 파일 하나에 목록 전체를 잃으면 안 된다.
  assert.equal(list.length, 1);
  assert.equal(list[0].callId, 'call-a');
});

test('파일 이름에 쓸 수 없는 글자가 있으면 읽지 않는다', async () => {
  const harness = setup();
  harness.seedFile('call-a.json', JSON.stringify(savedState('call-a', 100)));
  // 🔴 `..%2f` 류가 섞인 이름을 그대로 통화 ID 로 되돌리면 앱 저장소 밖을 읽으러 간다.
  harness.seedFile('../secret.json', JSON.stringify(savedState('x', 900)));
  const list = await harness.engine.listAsrLocalStates();
  assert.equal(list.length, 1);
  assert.equal(list[0].callId, 'call-a');
});

test('엔진이 쓴 상태가 그대로 목록에 잡힌다', async () => {
  const harness = setup();
  // 🔴 경로를 두 곳에서 따로 짜면 이 검사가 어긋난다 — 쓴 쪽과 읽는 쪽이 같은 폴더를 본다.
  await harness.engine.saveAsrLocalState(savedState('call-1', 42));
  const list = await harness.engine.listAsrLocalStates();
  assert.equal(list.length, 1);
  assert.equal(list[0].callId, 'call-1');
  assert.equal(list[0].updatedAt, 42);
});

/**
 * 구간 목록을 이 실행 환경의 값으로 옮긴다.
 *
 * ⚠️ 엔진은 vm 안에서 돌아 객체의 프로토타입이 다르다 — 그대로 `deepEqual` 하면 「모양은
 * 같은데 같지 않다」로 떨어진다. 모양만 보면 되므로 필드를 옮겨 담는다.
 */
const plain = list => Array.from(list, item => ({ startMs: item.startMs, endMs: item.endMs, text: item.text }));
/** 같은 이유로 `map` 도 쓰지 않는다 — 엔진이 만든 배열에 `map` 을 걸면 결과도 저쪽 배열이다. */
const field = (list, key) => Array.from(list, item => item[key]);

/* ── 구간(시각 + 텍스트) ───────────────────────────────────────────────
   🔴 여기가 이 기능에서 **조용히 틀릴 수 있는 유일한 자리**다: 전사기는 창 안에서의
   시각을 주므로 청크 14개가 전부 「0초부터」를 말한다. 오프셋을 더하지 않아도 전사문은
   저장되고 화면에 뜨고 분석도 통과한다 — 아무도 못 알아챈다. 그래서 숫자로 못 박는다.
   ─────────────────────────────────────────────────────────────────── */

test('청크 2 의 0초는 파일의 120초다 — 오프셋을 더한다', () => {
  const chunk = { index: 1, offsetMs: 120_000, durationMs: 120_000 };
  const moved = asrChunkSegments([
    { startMs: 0, endMs: 4_000, text: '네 여보세요' },
    { startMs: 11_000, endMs: 15_500, text: '안녕하세요' },
  ], chunk);
  assert.deepEqual(plain(moved), [
    { startMs: 120_000, endMs: 124_000, text: '네 여보세요' },
    { startMs: 131_000, endMs: 135_500, text: '안녕하세요' },
  ]);
});

test('첫 청크는 그대로다 — 더할 오프셋이 0 이다', () => {
  const moved = asrChunkSegments([{ startMs: 0, endMs: 5_000, text: '여보세요' }], { index: 0, offsetMs: 0, durationMs: 120_000 });
  assert.deepEqual(plain(moved), [{ startMs: 0, endMs: 5_000, text: '여보세요' }]);
});

test('마지막 짧은 청크도 오프셋을 받고, 청크 밖으로는 나가지 않는다', () => {
  // 28분 26초짜리의 꼬리: 1,680,000ms 에서 시작하는 26초.
  const tail = { index: 14, offsetMs: 1_680_000, durationMs: 26_000 };
  const moved = asrChunkSegments([
    { startMs: 1_000, endMs: 9_000, text: '네 감사합니다' },
    // ⚠️ whisper 의 내부 창은 30초라 26초짜리 청크의 끝이 이렇게 넘어설 수 있다.
    { startMs: 20_000, endMs: 30_000, text: '들어가세요' },
  ], tail);
  assert.deepEqual(plain(moved), [
    { startMs: 1_681_000, endMs: 1_689_000, text: '네 감사합니다' },
    // 🔴 끝은 청크 경계로 당기되 **말은 버리지 않는다.** 넘긴 채로 두면 다음 청크와 겹친다.
    { startMs: 1_700_000, endMs: 1_706_000, text: '들어가세요' },
  ]);
});

test('빈 구간과 깨진 숫자는 버린다 — 하나가 통화 전체의 시각을 NaN 으로 만든다', () => {
  const chunk = { index: 1, offsetMs: 120_000, durationMs: 120_000 };
  const moved = asrChunkSegments([
    { startMs: 0, endMs: 1_000, text: '   ' },
    { startMs: NaN, endMs: 2_000, text: '깨짐' },
    { startMs: 3_000, endMs: 4_000, text: '  성한 말  ' },
  ], chunk);
  assert.deepEqual(plain(moved), [{ startMs: 123_000, endMs: 124_000, text: '성한 말' }]);
});

test('끝까지 돌면 구간 시각이 청크마다 앞으로 나아간다', async () => {
  const harness = setup();
  const result = await run(harness).handle.promise;
  // 가짜 전사기는 청크마다 「0~5초」 하나씩 준다. 더해지지 않았다면 다섯 개가 전부 0 이다.
  assert.deepEqual(field(result.segments, 'startMs'), [0, 120_000, 240_000, 360_000, 480_000]);
  assert.deepEqual(field(result.segments, 'endMs'), [5_000, 125_000, 245_000, 365_000, 485_000]);
  assert.deepEqual(field(result.segments, 'text'), ['말0', '말1', '말2', '말3', '말4']);
});

test('구간에 화자를 지어내지 않는다', async () => {
  const harness = setup();
  const result = await run(harness).handle.promise;
  // 🔴 폰 whisper 에는 화자 정보가 아예 없다. 빈 문자열로라도 채우면 화면이 「한 사람이
  // 계속 말한 대화」로 좌우를 가른다 — 없는 사실을 화면이 지어내는 셈이다.
  for (const segment of result.segments) {
    assert.deepEqual(Object.keys(segment).sort(), ['endMs', 'startMs', 'text']);
  }
});

test('이어하기 때 앞 청크의 구간이 남아 있다', async () => {
  const harness = setup();
  harness.seedState({
    version: 1, callId: CALL_ID, wavUri: WAV, sourceName: '통화.m4a', sourceBytes: 1000,
    modelId: 'q8_0', totalMs: TOTAL, nextOffsetMs: 240_000, pieces: ['먼저0', '먼저1'],
    segments: [
      { startMs: 1_000, endMs: 4_000, text: '먼저0' },
      { startMs: 121_000, endMs: 124_000, text: '먼저1' },
    ],
    startedAt: 1, updatedAt: 2,
  });
  const result = await run(harness).handle.promise;
  // 🔴 앞의 두 구간이 그대로 앞에 있고, 이어 돌린 세 청크가 **240초부터** 붙는다.
  assert.deepEqual(field(result.segments, 'startMs'), [1_000, 121_000, 240_000, 360_000, 480_000]);
  assert.deepEqual(field(result.segments, 'text'), ['먼저0', '먼저1', '말0', '말1', '말2']);
});

test('멈춘 청크의 구간은 저장되지 않는다', async () => {
  // 🔴 텍스트와 같은 규칙이다. 남기면 같은 구간을 다시 돌렸을 때 두 번 들어간다.
  const harness = setup({ chunk: index => (index === 2 ? { aborted: true, segments: [{ startMs: 0, endMs: 3_000, text: '버려질말' }] } : {}) });
  const result = await run(harness).handle.promise;
  assert.equal(result.done, false);
  assert.deepEqual(field(result.segments, 'text'), ['말0', '말1']);
  const saved = harness.state();
  assert.deepEqual(field(saved.segments, 'text'), ['말0', '말1']);
});

/* ── 옛 상태와의 호환 ──────────────────────────────────────────────────
   ⚠️ 실기기에 **진행 중인 받아쓰기가 이미 저장돼 있다.** 구간을 더하면서 그 상태들이
   버려지면 사용자는 28분을 처음부터 다시 기다린다.
   ─────────────────────────────────────────────────────────────────── */

test('구간 필드가 없는 옛 상태도 그대로 읽힌다', () => {
  const old = {
    version: 1, callId: CALL_ID, wavUri: WAV, sourceName: '통화.m4a', sourceBytes: 1000,
    modelId: 'q8_0', totalMs: TOTAL, nextOffsetMs: 240_000, pieces: ['가', '나'], startedAt: 1, updatedAt: 2,
  };
  assert.equal(isAsrLocalState(old), true);
  assert.notEqual(resumableState(old, input()), null);
  // 새로 시작하는 쪽은 반드시 빈 배열로 연다 — 그래야 「옛 상태」와 구분된다.
  assert.equal(freshAsrLocalState(input(), 1).segments.length, 0);
  // 모양이 깨진 구간 목록은 거른다. 그대로 두면 시각이 NaN 인 전사문이 서버로 간다.
  assert.equal(isAsrLocalState({ ...old, segments: [{ startMs: 0, text: '끝이 없다' }] }), false);
  assert.equal(isAsrLocalState({ ...old, segments: 'segments' }), false);
});

test('옛 상태를 이어받으면 구간을 모으지 않는다 — 앞이 빠진 대화를 만들지 않는다', async () => {
  const harness = setup();
  harness.seedState({
    version: 1, callId: CALL_ID, wavUri: WAV, sourceName: '통화.m4a', sourceBytes: 1000,
    modelId: 'q8_0', totalMs: TOTAL, nextOffsetMs: 240_000, pieces: ['먼저0', '먼저1'], startedAt: 1, updatedAt: 2,
  });
  const result = await run(harness).handle.promise;
  // 글은 온전하다.
  assert.equal(result.text, '먼저0 먼저1 조각0 조각1 조각2');
  /*
    🔴 **구간은 비어 있다.** 앞 4분치 구간은 되찾을 길이 없으므로, 뒤의 6분치만 모아
    「구간이 있다」고 말하지 않는다 — 그 전사문은 통화가 4분째에 시작한 것처럼 보이고,
    화면도 서버도 그것이 반쪽이라는 것을 알 방법이 없다. 그때는 글만 보낸다.
  */
  assert.equal(result.segments.length, 0);
  assert.equal(harness.state(), null);
});

/* ── 실제로 일한 시간 ──────────────────────────────────────────────────
   🔴 화면의 「N분 M초 경과」는 이어하기로 들어오면 0 부터 다시 셌다. 20분을 이미 쓴 사람이
   그 숫자를 보면 「처음부터 다시 도는구나」로 읽는다. 기준점이 될 값을 엔진이 남긴다.
   ⚠️ 여기서는 **시계를 테스트가 쥔다**: `now()` 는 값을 그대로 돌려주고, 청크가 시작될 때
   그 청크에 걸릴 시간만큼 앞으로 민다. 그래야 「몇 번 물었나」가 아니라 「얼마나 걸렸나」를 잰다.
   ─────────────────────────────────────────────────────────────────── */

test('끝난 청크에 쓴 시간만 `workedMs` 에 쌓인다', async () => {
  let clock = 100_000;
  const spent = [5_000, 7_000, 9_000];
  // 세 번째 청크는 9초를 쓰고도 끝내지 못했다(백그라운드로 밀렸을 때의 모양).
  const harness = setup({ chunk: index => { clock += spent[index]; return index === 2 ? { aborted: true } : {}; } });
  harness.deps.now = () => clock;
  const result = await run(harness).handle.promise;
  assert.equal(result.done, false);

  const saved = harness.state();
  assert.deepEqual(saved.pieces, ['조각0', '조각1']);
  // 5초 + 7초. 🔴 돌다 만 청크의 9초는 들어 있지 않다 — 그 2분은 어차피 다시 돈다.
  assert.equal(saved.workedMs, 12_000);
});

test('이어하면 앞 실행이 쓴 시간에 이어서 쌓인다', async () => {
  let clock = 500_000;
  const harness = setup({ chunk: index => { clock += 3_000; return index === 1 ? { aborted: true } : {}; } });
  harness.seedState({
    version: 1, callId: CALL_ID, wavUri: WAV, sourceName: '통화.m4a', sourceBytes: 1000,
    modelId: 'q8_0', totalMs: TOTAL, nextOffsetMs: 240_000, pieces: ['먼저0', '먼저1'],
    workedMs: 1_200_000, startedAt: 1, updatedAt: 2,
  });
  harness.deps.now = () => clock;
  await run(harness).handle.promise;
  // 🔴 앞 실행의 20분을 그대로 이어받는다. 여기서 덮어쓰면 화면이 다시 0 분부터 센다.
  assert.equal(harness.state().workedMs, 1_203_000);
});

test('경과 시간 필드가 없는 옛 상태도 그대로 읽힌다 — 버전은 1 그대로다', () => {
  const old = {
    version: 1, callId: CALL_ID, wavUri: WAV, sourceName: '통화.m4a', sourceBytes: 1000,
    modelId: 'q8_0', totalMs: TOTAL, nextOffsetMs: 240_000, pieces: ['가', '나'], startedAt: 1, updatedAt: 2,
  };
  /*
    🔴 **버전을 올리지 않았다.** 올렸으면 실기기에서 진행 중인 받아쓰기가 전부 버려져 28분을
    처음부터 다시 돈다 — `segments` 를 더할 때와 같은 판단이다. 대신 새 필드는 없어도 되는
    값으로 두고, 없으면 「앞부분에 쓴 시간을 모른다」로 읽는다.
  */
  assert.equal(ASR_STATE_VERSION, 1);
  assert.equal(old.workedMs, undefined);
  assert.equal(isAsrLocalState(old), true);
  assert.notEqual(resumableState(old, input()), null);
  // 새로 시작하는 쪽은 0 으로 연다. 그때는 기준값이 0 이라 예전과 똑같이 보인다.
  assert.equal(freshAsrLocalState(input(), 1).workedMs, 0);
  // 모양이 깨진 값은 거른다. 음수나 NaN 이 들어오면 화면의 경과 시간이 뒤로 가거나 `NaN분` 이 된다.
  assert.equal(isAsrLocalState({ ...old, workedMs: -1 }), false);
  assert.equal(isAsrLocalState({ ...old, workedMs: Number.NaN }), false);
  assert.equal(isAsrLocalState({ ...old, workedMs: '10' }), false);
  assert.equal(isAsrLocalState({ ...old, workedMs: 10 }), true);
});

test('옛 상태를 이어받으면 이번 실행분부터 센다 — 모르는 시간을 지어내지 않는다', async () => {
  let clock = 700_000;
  const harness = setup({ chunk: index => { clock += 4_000; return index === 1 ? { aborted: true } : {}; } });
  harness.seedState({
    version: 1, callId: CALL_ID, wavUri: WAV, sourceName: '통화.m4a', sourceBytes: 1000,
    modelId: 'q8_0', totalMs: TOTAL, nextOffsetMs: 240_000, pieces: ['먼저0', '먼저1'], startedAt: 1, updatedAt: 2,
  });
  harness.deps.now = () => clock;
  await run(harness).handle.promise;
  // 앞의 4분치에 쓴 시간은 되찾을 길이 없다. 지어내는 대신 이번에 끝낸 한 청크만 센다.
  assert.equal(harness.state().workedMs, 4_000);
});
