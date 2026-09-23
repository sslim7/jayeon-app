/**
 * 첨부 이미지를 **얼마나, 어떤 순서로 줄일 것인가**(→ `src/lib/image-shrink-plan.ts`).
 *
 * 줄이는 손(캔버스·`expo-image-manipulator`)은 실기기에서만 돌지만, **판단은 여기서 고정한다.**
 * 목표 바이트를 잘못 세면 눈에 보이는 증상은 「한도를 넘었다」 한 줄뿐이고, 어느 셋 중 어느
 * 값에서 틀렸는지 화면으로는 알 수 없다.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const realms = { Error, Set, Map, JSON, Date, Number, Math, RegExp, String, Object, Array, Promise };

// 규칙은 **실제 구현을 그대로 쓴다.** 여기에 베껴 두면 구현이 변해도 검사는 통과한다.
const mod = { exports: {} };
vm.runInNewContext(`(function(exports,require){${compile('src/lib/image-shrink-plan.ts')}\n})`, { ...realms })(mod.exports, name => {
  // 🔴 이 모듈은 플랫폼 코드를 import 하면 안 된다. 하나라도 들어오면 여기서 터진다.
  throw new Error(`unmocked ${name}`);
});
const { needsShrink, scaledSize, shrinkAttempts, shrinkPlan, shrinkTargetBytes, shrunkFileName } = mod.exports;

const KB = 1024;
/** 운영에서 쓰는 값(→ `lib/attachment-file.ts`). 여기서는 목표 계산의 재료로만 쓴다. */
const LIMITS = { perFile: 700 * KB, totalLimit: 1400 * KB };

// ── 목표 바이트 ─────────────────────────────────────────────────

test('목표는 파일당 한도 · 남은 합계 · 단말 예산 중 가장 작은 값이다', () => {
  // 아무것도 안 붙었을 때는 파일당 한도가 가장 작다.
  assert.equal(shrinkTargetBytes({ ...LIMITS, usedBytes: 0 }), 700 * KB);
  // 이미 900 KB 를 썼으면 남은 몫(500 KB)이 파일당 한도보다 작다 — 그쪽을 따라야
  // 붙이고 나서 합계에서 거절당하지 않는다.
  assert.equal(shrinkTargetBytes({ ...LIMITS, usedBytes: 900 * KB }), 500 * KB);
  // 단말이 실제로 실어 보낼 수 있는 크기를 알면 그것이 가장 작을 수 있다.
  assert.equal(shrinkTargetBytes({ ...LIMITS, usedBytes: 0, deviceBudget: 300 * KB }), 300 * KB);
  // 셋 중 최솟값 — 단말 예산이 넉넉하면 아무것도 바뀌지 않는다.
  assert.equal(shrinkTargetBytes({ ...LIMITS, usedBytes: 900 * KB, deviceBudget: 600 * KB }), 500 * KB);
});

test('단말 예산은 모르면 넘기지 않는다 — 지어낸 숫자로 사진을 뭉개지 않는다', () => {
  const known = shrinkTargetBytes({ ...LIMITS, usedBytes: 0, deviceBudget: 200 * KB });
  for (const unknown of [undefined, null, 0, -1, NaN]) {
    assert.equal(shrinkTargetBytes({ ...LIMITS, usedBytes: 0, deviceBudget: unknown }), 700 * KB,
      `deviceBudget=${unknown} 이 「모른다」로 다뤄지지 않았다`);
  }
  assert.equal(known, 200 * KB);
});

test('남은 몫이 없으면 0 이 아니라 「더 붙일 수 없다」다', () => {
  // ⚠️ 0 을 돌려주면 「0바이트까지 줄여 보라」는 뜻이 되어, 성공할 수 없는 인코딩을
  //    아홉 번 돌린 뒤에야 실패한다. 사용자에게 할 말도 다르다.
  assert.equal(shrinkTargetBytes({ ...LIMITS, usedBytes: 1400 * KB }), null);
  assert.equal(shrinkTargetBytes({ ...LIMITS, usedBytes: 1400 * KB + 1 }), null);
  // 1바이트라도 남아 있으면 줄여 볼 여지는 있다 — null 과 구분된다.
  assert.equal(shrinkTargetBytes({ ...LIMITS, usedBytes: 1400 * KB - 1 }), 1);
});

// ── 이미 작은 것은 건드리지 않는다 ───────────────────────────────

test('목표 이하인 이미지는 다시 인코딩하지 않는다', () => {
  // 🔴 JPEG 재인코딩은 손실만 쌓고 크기를 줄여 준다는 보장도 없다. 잃기만 한다.
  assert.equal(needsShrink(200 * KB, 700 * KB), false);
  assert.equal(needsShrink(700 * KB, 700 * KB), false);
  assert.equal(needsShrink(700 * KB + 1, 700 * KB), true);
  assert.equal(needsShrink(5 * 1024 * KB, 700 * KB), true);
});

// ── 시도 순서 = 품질 정책 ───────────────────────────────────────

test('먼저 품질을 내리고, 그래도 안 되면 해상도를 내린다', () => {
  // VM 안에서 만들어진 배열은 prototype 이 달라 그대로 비교하면 걸린다. 값만 꺼내 온다.
  const attempts = Array.from(shrinkAttempts(700 * KB), a => [a.maxEdge, a.quality]);
  assert.deepEqual(attempts, [
    [1280, 0.85], [1280, 0.7], [1280, 0.55],
    [960, 0.85], [960, 0.7], [960, 0.55],
    [720, 0.85], [720, 0.7], [720, 0.55],
  ]);
  // 🔴 순서가 뒤집히면 품질 0.85 짜리 720px 사진이 먼저 채택된다 — 같은 바이트로
  //    품질 0.55 짜리 1280px 보다 눈에 띄게 흐릿하다.
  const edges = Array.from(shrinkAttempts(700 * KB), a => a.maxEdge);
  assert.deepEqual([...new Set(edges)], [1280, 960, 720]);
  for (let i = 1; i < edges.length; i += 1) assert.ok(edges[i] <= edges[i - 1], '해상도가 도로 올라갔다');
});

test('목표가 0 이하면 시도하지 않는다 — 어떤 인코딩도 만족시킬 수 없다', () => {
  assert.deepEqual([...shrinkAttempts(0)], []);
  assert.deepEqual([...shrinkAttempts(-1)], []);
  assert.deepEqual([...shrinkPlan('image/png', 0)], []);
});

// ── PNG 정책 ────────────────────────────────────────────────────

test('PNG 는 PNG 로 먼저 줄여 보고, 마지막에만 JPEG 으로 간다', () => {
  const plan = shrinkPlan('image/png', 700 * KB);
  const formats = Array.from(plan, a => a.mimeType);
  // 🔴 도장·로고·표처럼 선이 많은 그림을 바로 JPEG 으로 바꾸면 선 둘레가 번진다.
  //    해상도만 낮춰서 들어가면 형식을 바꿀 이유가 없다.
  assert.deepEqual(Array.from(plan, a => [a.mimeType, a.maxEdge]).slice(0, 3), [
    ['image/png', 1280], ['image/png', 960], ['image/png', 720],
  ]);
  // PNG 가 먼저고 JPEG 이 나중이다 — 섞이면 안 된다.
  assert.equal(formats.lastIndexOf('image/png'), 2);
  assert.equal(formats.indexOf('image/jpeg'), 3);
  assert.deepEqual([...new Set(formats)], ['image/png', 'image/jpeg']);
});

test('PNG 단계는 품질을 돌리지 않는다 — 무손실이라 같은 결과를 세 번 만든다', () => {
  // ⚠️ PNG 인코더는 `quality` 를 버린다(웹 `toBlob` 도, 네이티브 `saveAsync({compress})` 도).
  //    해상도별로 한 번씩만 돌지 않으면 1초짜리 인코딩을 여섯 번 헛돌린다.
  const png = Array.from(shrinkPlan('image/png', 700 * KB)).filter(a => a.mimeType === 'image/png');
  assert.equal(png.length, 3);
  assert.deepEqual([...new Set(png.map(a => a.maxEdge))], [1280, 960, 720]);
});

test('투명한 곳을 흰색으로 채우는 것은 JPEG 단계에서만 켜진다', () => {
  // 🔴 JPEG 에는 투명도가 없다. 밑칠을 안 하면 투명했던 곳이 **검게** 나오고, 도장을 붙인
  //    사용자는 문자를 보내고 나서야 그것을 본다. 반대로 PNG 단계에서 칠하면 멀쩡한
  //    투명 배경을 흰색으로 덮어 버린다.
  for (const attempt of shrinkPlan('image/png', 700 * KB)) {
    assert.equal(attempt.flatten, attempt.mimeType === 'image/jpeg', `${attempt.mimeType} 의 밑칠 여부가 틀렸다`);
  }
});

test('JPEG 원본에는 PNG 단계가 없다', () => {
  // 사진을 PNG 로 다시 인코딩하면 원본보다 커진다. 시도할 이유가 없다.
  const plan = shrinkPlan('image/jpeg', 700 * KB);
  assert.deepEqual([...new Set(Array.from(plan, a => a.mimeType))], ['image/jpeg']);
  assert.equal(plan.length, 9);
});

// ── 크기 계산과 이름 ────────────────────────────────────────────

test('긴 변을 목표에 맞추되 비율을 지키고, 원본보다 키우지 않는다', () => {
  // 가로 사진: 긴 변이 가로다.
  assert.deepEqual({ ...scaledSize(4000, 3000, 1280) }, { width: 1280, height: 960 });
  // 세로 사진: 긴 변이 세로다. 가로에 1280 을 박으면 세로가 4000px 로 남는다.
  assert.deepEqual({ ...scaledSize(3000, 4000, 1280) }, { width: 960, height: 1280 });
  // ⚠️ 이미 작은 이미지를 키우면 바이트만 늘고 보이는 것은 그대로다.
  assert.deepEqual({ ...scaledSize(800, 600, 1280) }, { width: 800, height: 600 });
  // 0픽셀 캔버스는 브라우저가 던진다.
  assert.deepEqual({ ...scaledSize(2000, 3, 720) }, { width: 720, height: 1 });
});

test('형식을 바꾸면 확장자도 바꾼다', () => {
  // 🔴 첨부 흐름은 확장자를 MIME 의 정본으로 본다(→ `imageContentType`). 이름을 그대로 두면
  //    서버도 미리보기도 다음 판정도 모두 PNG 라고 믿는다.
  assert.equal(shrunkFileName('도장.png', 'image/jpeg'), '도장.jpg');
  assert.equal(shrunkFileName('도장.png', 'image/png'), '도장.png');
  assert.equal(shrunkFileName('IMG_0042.JPEG', 'image/jpeg'), 'IMG_0042.jpg');
  assert.equal(shrunkFileName('확장자없음', 'image/jpeg'), '확장자없음.jpg');
  assert.equal(shrunkFileName('.png', 'image/jpeg'), 'image.jpg');
});

// ── 🔴 판단과 손이 갈라져 있는가 ────────────────────────────────

const source = file => fs.readFileSync(file, 'utf8');
/** 주석은 설명이라 `canvas` 도 `expo` 도 나와도 된다. **코드만** 본다(→ `attachment-file.test.cjs`). */
const code = file => source(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PLAN = 'src/lib/image-shrink-plan.ts';
const WEB = 'src/lib/image-shrink.web.ts';
const NATIVE = 'src/lib/image-shrink.ts';

test('계획 모듈에는 플랫폼 코드가 없다', () => {
  // 🔴 캔버스나 expo 가 한 줄이라도 들어오면 이 검사 전체가 실기기에서만 돌게 된다.
  //    (위 `runInNewContext` 의 unmocked require 가 이미 터지지만, 뜻을 글로도 남긴다.)
  assert.doesNotMatch(code(PLAN), /from 'expo|require\(|document\.|canvas|Image\(/i);
});

test('웹 짝과 네이티브 짝은 둘 다 계획을 가져다 쓴다', () => {
  for (const file of [WEB, NATIVE]) {
    assert.match(source(file), /from '\.\/image-shrink-plan'/, `${file} 이 계획을 보지 않는다`);
    assert.match(source(file), /shrinkPlan/, `${file} 이 계획 대신 자기 판단을 쓴다`);
    // 한쪽만 다른 순서로 돌면 웹에서 붙던 사진이 앱에서만 뭉개진다.
    assert.match(source(file), /scaledSize/);
    assert.match(source(file), /shrunkFileName/);
    assert.match(source(file), /SHRINK_FAILED/, `${file} 이 실패를 공용 코드로 던지지 않는다`);
  }
});

test('웹 짝은 JPEG 으로 바꾸기 전에 흰색을 깐다', () => {
  // ⚠️ 이 두 줄이 사라지면 투명 PNG 가 검은 배경으로 발송된다 — 테스트 없이는 아무도 모른다.
  assert.match(source(WEB), /fillStyle = '#FFFFFF'/);
  assert.match(source(WEB), /fillRect/);
  // 그리기 **전에** 칠해야 한다. 나중에 칠하면 사진을 덮는다.
  assert.ok(source(WEB).indexOf('fillRect') < source(WEB).indexOf('drawImage'), '밑칠이 그리기 뒤로 갔다');
});
