/**
 * 문자 첨부 이미지를 **웹과 네이티브가 같은 규칙으로** 받아들이는가(→ `src/lib/attachment-file.ts`).
 *
 * 🔴 **가장 중요한 한 줄은 「양쪽이 같은 곳을 본다」다.** 한쪽만 느슨하면 웹에서 막힌 파일이
 * 앱에서는 통과해 서버가 거절하고, 사용자는 왜 자기 폰에서만 다른지 알 수 없다. 그래서 값과
 * 문구를 확인하는 것으로 그치지 않고, **두 컴포넌트가 그 값을 따로 적지 않았는지**까지 본다.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const realms = { Error, Set, Map, JSON, Date, Number, Math, RegExp, String, Object, Array, Promise };

// 판정 규칙은 **실제 구현을 그대로 쓴다.** 여기에 규칙을 베껴 두면 구현이 변해도 검사는 통과한다.
const mod = { exports: {} };
vm.runInNewContext(`(function(exports,require){${compile('src/lib/attachment-file.ts')}\n})`, { ...realms })(mod.exports, name => {
  throw new Error(`unmocked ${name}`);
});
const {
  ATTACHMENT_ACCEPT, ATTACHMENT_HINT, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT,
  ATTACHMENT_PICKER_MESSAGE, ATTACHMENT_QUOTA_MESSAGE, ATTACHMENT_READ_MESSAGE, ATTACHMENT_TOTAL_MAX_BYTES,
  ATTACHMENT_TYPE_MESSAGE, acceptTypes, attachmentReason, base64Size, imageContentType, isAllowedImage,
  oversizeMessage, pickNativeAttachment, quotaExceeded,
} = mod.exports;

/** 정확히 `size` 바이트를 담은 base64. 선택기가 크기를 알려 주지 않는 경우를 재기 위함이다. */
const bytes = size => Buffer.alloc(size, 7).toString('base64');

/** 네이티브 선택기 흉내. 무엇을 열었고 무엇을 읽었는지 기록한다. */
function deps({ result, read, openFails = false }) {
  const calls = { open: [], read: [] };
  return {
    calls,
    open: async types => { calls.open.push(types); if (openFails) throw new Error('ActivityNotFoundException'); return result; },
    readBase64: async uri => { calls.read.push(uri); return read; },
  };
}
const ok = (asset, read) => deps({ result: { canceled: false, assets: [asset] }, read });
const options = { accept: ATTACHMENT_ACCEPT, maxBytes: ATTACHMENT_MAX_BYTES };

// ── 한도 ────────────────────────────────────────────────────────

test('한도는 파일당 300 KB · 합계 600 KB · 3장이고 안내 문구가 같은 숫자를 말한다', () => {
  assert.equal(ATTACHMENT_MAX_BYTES, 300 * 1024);
  assert.equal(ATTACHMENT_TOTAL_MAX_BYTES, 600 * 1024);
  assert.equal(ATTACHMENT_MAX_COUNT, 3);
  // 화면 안내가 상한과 다른 숫자를 말하면 사용자는 둘 중 무엇을 믿어야 할지 알 수 없다.
  assert.match(ATTACHMENT_HINT, /파일당 300 KB · 합계 600 KB까지/);
  assert.match(ATTACHMENT_QUOTA_MESSAGE, /최대 3개, 합계 600 KB/);
  assert.equal(oversizeMessage(ATTACHMENT_MAX_BYTES), '파일은 300 KB까지 추가할 수 있어요.');
});

test('합계와 장수는 붙일 수 있는 것만 통과시킨다', () => {
  assert.equal(quotaExceeded([], 300 * 1024), false);
  assert.equal(quotaExceeded([{ size: 300 * 1024 }], 300 * 1024), false);
  // 300+300+1 은 합계를 넘는다. 장수는 아직 남아 있어도 막아야 한다.
  assert.equal(quotaExceeded([{ size: 300 * 1024 }, { size: 300 * 1024 }], 1), true);
  assert.equal(quotaExceeded([{ size: 1 }, { size: 1 }, { size: 1 }], 1), true);
});

// ── 거절 ────────────────────────────────────────────────────────

test('크기 초과는 읽기 전에 거절한다 — 300 KB 넘는 사진을 통째로 메모리에 올리지 않는다', async () => {
  const d = ok({ uri: 'file:///big.jpg', name: 'big.jpg', size: 300 * 1024 + 1, mimeType: 'image/jpeg' }, bytes(10));
  await assert.rejects(() => pickNativeAttachment(d, options), /FILE_TOO_LARGE/);
  assert.deepEqual(d.calls.read, []);
});

test('선택기가 크기를 주지 않아도 읽은 뒤 실제 길이로 거절한다', async () => {
  const d = ok({ uri: 'file:///big.jpg', name: 'big.jpg', mimeType: 'image/jpeg' }, bytes(300 * 1024 + 1));
  await assert.rejects(() => pickNativeAttachment(d, options), /FILE_TOO_LARGE/);
  assert.deepEqual(d.calls.read, ['file:///big.jpg']);
});

test('딱 한도인 파일은 통과한다', async () => {
  const d = ok({ uri: 'file:///ok.png', name: '명함.png', size: 300 * 1024, mimeType: 'image/png' }, bytes(300 * 1024));
  const file = await pickNativeAttachment(d, options);
  assert.deepEqual({ ...file, dataBase64: file.dataBase64.length }, {
    fileName: '명함.png', mimeType: 'image/png', size: 300 * 1024, dataBase64: bytes(300 * 1024).length,
  });
});

test('JPG·PNG 가 아니면 거절하고, 형식은 확장자를 정본으로 본다', async () => {
  const gif = ok({ uri: 'file:///a.gif', name: 'a.gif', size: 10, mimeType: 'image/gif' }, bytes(10));
  await assert.rejects(() => pickNativeAttachment(gif, options), /UNSUPPORTED_TYPE/);
  assert.deepEqual(gif.calls.read, []);

  // 🔴 안드로이드 문서 제공자는 같은 JPG 에 `image/jpg` 를 주거나 아무것도 주지 않는다.
  //    그대로 넘기면 호출부의 `image/jpeg` 검사에 걸려 멀쩡한 사진이 거절된다.
  assert.equal(imageContentType('사진.JPG', 'image/jpg'), 'image/jpeg');
  assert.equal(imageContentType('사진.jpeg', null), 'image/jpeg');
  assert.equal(imageContentType('사진.png', undefined), 'image/png');
  // 확장자를 모를 때만 선택기 값을 본다.
  assert.equal(imageContentType('scan', 'image/png;charset=binary'), 'image/png');
  assert.throws(() => imageContentType('scan', 'application/pdf'), /UNSUPPORTED_TYPE/);

  assert.equal(isAllowedImage('image/jpeg'), true);
  assert.equal(isAllowedImage('image/png'), true);
  assert.equal(isAllowedImage('image/jpg'), false);
});

// ── 취소 ────────────────────────────────────────────────────────

test('취소는 오류가 아니다 — 아무것도 읽지 않고 조용히 끝난다', async () => {
  const d = deps({ result: { canceled: true, assets: null } });
  assert.equal(await pickNativeAttachment(d, options), null);
  assert.deepEqual(d.calls.read, []);
});

test('취소가 아닌데 고른 것이 없어도 조용히 끝난다', async () => {
  const d = deps({ result: { canceled: false, assets: [] } });
  assert.equal(await pickNativeAttachment(d, options), null);
  assert.deepEqual(d.calls.read, []);
});

// ── 문구 ────────────────────────────────────────────────────────

test('선택기가 열리지 않는 것과 파일을 읽지 못한 것은 다른 말을 한다', async () => {
  const d = deps({ result: null, openFails: true });
  await assert.rejects(() => pickNativeAttachment(d, options), /PICKER_UNAVAILABLE/);
  // 파일을 고른 적도 없는 사용자에게 「다시 선택해 주세요」라고 하면 같은 곳을 다시 누른다.
  assert.equal(attachmentReason(new Error('PICKER_UNAVAILABLE'), ATTACHMENT_MAX_BYTES), ATTACHMENT_PICKER_MESSAGE);
  assert.notEqual(ATTACHMENT_PICKER_MESSAGE, ATTACHMENT_READ_MESSAGE);
});

test('코드는 사람이 읽을 한 줄이 되고 모르는 것은 읽기 실패로 눌린다', () => {
  assert.equal(attachmentReason(new Error('FILE_TOO_LARGE'), ATTACHMENT_MAX_BYTES), '파일은 300 KB까지 추가할 수 있어요.');
  assert.equal(attachmentReason(new Error('UNSUPPORTED_TYPE'), ATTACHMENT_MAX_BYTES), ATTACHMENT_TYPE_MESSAGE);
  assert.equal(attachmentReason(new Error('SQLITE_FULL: /data/user/0/kr.co.jayeon/cache/a.jpg'), ATTACHMENT_MAX_BYTES), ATTACHMENT_READ_MESSAGE);
  assert.equal(attachmentReason('그냥 문자열', ATTACHMENT_MAX_BYTES), ATTACHMENT_READ_MESSAGE);
});

// ── 선택기에 거는 필터 ───────────────────────────────────────────

test('문서 선택기에는 MIME 만 넘긴다 — 확장자 항목은 웹 input 전용이다', async () => {
  const d = ok({ uri: 'file:///a.png', name: 'a.png', size: 10, mimeType: 'image/png' }, bytes(10));
  await pickNativeAttachment(d, options);
  // VM 안에서 만들어진 배열이라 그대로 비교하면 prototype 이 달라 걸린다. 값만 꺼내 본다.
  assert.deepEqual(d.calls.open.map(types => [...types]), [['image/jpeg', 'image/png']]);
  assert.deepEqual([...acceptTypes('.jpg,.png')], ['image/*']);
});

test('base64 길이는 실제 바이트 수로 환산된다', () => {
  for (const size of [0, 1, 2, 3, 4, 999, 300 * 1024]) assert.equal(base64Size(bytes(size)), size);
});

// ── 🔴 웹과 네이티브가 같은 곳을 보는가 ─────────────────────────

const source = file => fs.readFileSync(file, 'utf8');
/** 주석은 설명이라 숫자도 옛 문구도 나와도 된다. **코드만** 본다. */
const code = file => source(file)
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const NATIVE = 'src/components/file-picker.tsx';
const WEB = 'src/components/file-picker.web.tsx';
const CALLER = 'src/components/message-attachments.tsx';

test('웹 짝·네이티브 짝·호출부가 모두 공용 규칙을 가져다 쓴다', () => {
  for (const file of [NATIVE, WEB, CALLER]) {
    assert.match(source(file), /from '@\/lib\/attachment-file'/, `${file} 이 공용 규칙을 보지 않는다`);
  }
  assert.match(source(NATIVE), /pickNativeAttachment/);
  assert.match(source(WEB), /oversizeMessage/);
});

test('어느 쪽도 한도와 문구를 따로 적지 않는다', () => {
  for (const file of [NATIVE, WEB, CALLER]) {
    const text = code(file);
    assert.doesNotMatch(text, /KB까지/, `${file} 이 한도 문구를 따로 적었다`);
    // 🔴 화면으로 나가는 말은 전부 공용 규칙에서 와야 한다 — 리터럴을 그대로 넘기면 안 된다.
    // (`setError('')` 는 지우는 것이라 예외다 — 사람에게 보이는 말이 아니다.)
    assert.doesNotMatch(text, /onError\(\s*['"`][^'"`]/, `${file} 이 오류 문구를 따로 적었다`);
    assert.doesNotMatch(text, /setError\(\s*['"`][^'"`]/, `${file} 이 오류 문구를 따로 적었다`);
    assert.doesNotMatch(text, /300 \* 1024|600 \* 1024/, `${file} 이 한도 숫자를 따로 적었다`);
    assert.doesNotMatch(text, /image\/jpeg', 'image\/png/, `${file} 이 허용 형식 목록을 따로 적었다`);
  }
});

test('「웹 화면에서 추가해 주세요」는 더 이상 어디에도 없다', () => {
  // 앱에서 템플릿을 고치던 사용자는 그 「웹 화면」이 어디인지 알 방법이 없었다.
  // (네이티브 짝의 주석은 그 사정을 설명하므로 남아 있다 — 화면에 나가는 코드만 본다.)
  for (const file of [NATIVE, WEB, CALLER]) assert.doesNotMatch(code(file), /웹 화면/);
});
