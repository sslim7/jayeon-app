const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const compiled = ts.transpileModule(fs.readFileSync('src/lib/recipient-columns.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
// 열 식별자는 정렬 모듈과 한 벌이다. 화면 없이 돌리려고 그 두 값만 그대로 흉내 낸다.
const CUSTOM_SORT_PREFIX = 'custom:';
const require_ = () => ({ CUSTOM_SORT_PREFIX, customSortKey: (field) => `${CUSTOM_SORT_PREFIX}${field}` });
// ⚠️ `runInThisContext` 다. 새 컨텍스트에서 만든 배열·객체는 프로토타입이 달라
// `deepStrictEqual` 이 「모양은 같은데 같지 않다」로 떨어진다.
vm.runInThisContext(`(function(exports, require){${compiled}\n})`)(mod.exports, require_);
const {
  defaultRecipientColumnOrder,
  resolveRecipientColumns,
  isRecipientColumnLayout,
  moveRecipientColumn,
  resizeRecipientColumn,
  clampRecipientColumnWidth,
  isMovableRecipientColumn,
  MIN_RECIPIENT_COLUMN_WIDTH,
  MAX_RECIPIENT_COLUMN_WIDTH,
  DEFAULT_CUSTOM_COLUMN_WIDTH,
  recipientColumnStoreKey,
} = mod.exports;
const layout = (order, widths = {}) => ({ version: 1, order, widths });

test('기본 순서는 전화번호 → 사용자 정의 → 그룹 → 발송건수다', () => {
  assert.deepEqual(defaultRecipientColumnOrder([]), ['phone', 'group', 'sent']);
  assert.deepEqual(defaultRecipientColumnOrder(['직급', '메모']), ['phone', 'custom:직급', 'custom:메모', 'group', 'sent']);
  // 저장된 배치가 없으면 기본 순서 그대로 나온다.
  assert.deepEqual(resolveRecipientColumns(['직급'], null).order, ['phone', 'custom:직급', 'group', 'sent']);
});

test('이름과 관리 열은 이동 대상이 아니고 사용자 정의 열은 대상이다', () => {
  assert.equal(isMovableRecipientColumn('name'), false);
  assert.equal(isMovableRecipientColumn('actions'), false);
  assert.equal(isMovableRecipientColumn('phone'), true);
  assert.equal(isMovableRecipientColumn('custom:직급'), true);
});

test('저장된 순서에 없는 새 열은 버리지 않고 기본 자리 근처에 끼운다', () => {
  // 사용자가 그룹을 맨 앞으로 옮겨 둔 뒤 사용자 정의 열 둘이 새로 생긴 상황.
  const saved = layout(['group', 'phone', 'sent']);
  const { order } = resolveRecipientColumns(['직급', '메모'], saved);
  assert.deepEqual(order, ['group', 'phone', 'custom:직급', 'custom:메모', 'sent']);
  // 사용자가 잡아 둔 상대 순서(group 이 phone 앞)는 그대로다.
  assert.ok(order.indexOf('group') < order.indexOf('phone'));
});

test('저장된 순서가 앞쪽 열을 모두 잃어도 새 열은 맨 앞에 들어간다', () => {
  const { order } = resolveRecipientColumns(['직급'], layout(['sent']));
  assert.deepEqual(order, ['phone', 'custom:직급', 'group', 'sent']);
});

test('사라진 사용자 정의 열은 저장된 순서에서 빠진다', () => {
  const saved = layout(['custom:없어진열', 'sent', 'phone', 'group'], { 'custom:없어진열': 300, sent: 180 });
  const { order, widths } = resolveRecipientColumns([], saved);
  assert.deepEqual(order, ['sent', 'phone', 'group']);
  assert.equal('custom:없어진열' in widths, false);
  assert.equal(widths.sent, 180);
});

test('중복 식별자는 한 번만 남는다', () => {
  assert.deepEqual(resolveRecipientColumns([], layout(['sent', 'sent', 'phone'])).order, ['sent', 'phone', 'group']);
});

test('너비는 저장값이든 입력값이든 MIN/MAX 로 잘린다', () => {
  const { widths } = resolveRecipientColumns(['직급'], layout(['phone', 'group', 'sent', 'custom:직급'], { phone: 5, group: 9999, sent: 210 }));
  assert.equal(widths.phone, MIN_RECIPIENT_COLUMN_WIDTH);
  assert.equal(widths.group, MAX_RECIPIENT_COLUMN_WIDTH);
  assert.equal(widths.sent, 210);
  // 저장값이 없는 열은 기본값으로 시작한다.
  assert.equal(widths['custom:직급'], DEFAULT_CUSTOM_COLUMN_WIDTH);
  assert.equal(clampRecipientColumnWidth(-100), MIN_RECIPIENT_COLUMN_WIDTH);
  assert.equal(clampRecipientColumnWidth(1e9), MAX_RECIPIENT_COLUMN_WIDTH);
  assert.equal(resizeRecipientColumn({ phone: 140 }, 'phone', 1).phone, MIN_RECIPIENT_COLUMN_WIDTH);
  assert.equal(resizeRecipientColumn({ phone: 140 }, 'phone', 1000).phone, MAX_RECIPIENT_COLUMN_WIDTH);
  // NaN 은 아예 반영하지 않는다 — width: NaN 은 열을 통째로 접어 버린다.
  assert.deepEqual(resizeRecipientColumn({ phone: 140 }, 'phone', NaN), { phone: 140 });
});

test('깨진 저장값은 모두 거부되고 기본 배치로 돈다', () => {
  for (const broken of [
    null,
    undefined,
    'string',
    42,
    [],
    { version: 2, order: ['phone'], widths: {} },
    { order: ['phone'], widths: {} },
    { version: 1, order: 'phone', widths: {} },
    { version: 1, order: ['phone', 3], widths: {} },
    { version: 1, order: ['phone', ''], widths: {} },
    { version: 1, order: ['phone'] },
    { version: 1, order: ['phone'], widths: [] },
    { version: 1, order: ['phone'], widths: { phone: NaN } },
    { version: 1, order: ['phone'], widths: { phone: -10 } },
    { version: 1, order: ['phone'], widths: { phone: Infinity } },
    { version: 1, order: ['phone'], widths: { phone: '140' } },
  ]) {
    assert.equal(isRecipientColumnLayout(broken), false, `거부해야 한다: ${JSON.stringify(broken)}`);
  }
  assert.equal(isRecipientColumnLayout(layout(['phone'], { phone: 140 })), true);
  // 화면은 거부된 값을 null 로 바꿔 넘긴다 → 기본 배치.
  assert.deepEqual(resolveRecipientColumns([], null).order, ['phone', 'group', 'sent']);
});

test('열 이동은 앞·뒤·범위 밖을 모두 견딘다', () => {
  const order = ['phone', 'group', 'sent'];
  assert.deepEqual(moveRecipientColumn(order, 'sent', 0), ['sent', 'phone', 'group']);
  assert.deepEqual(moveRecipientColumn(order, 'phone', 2), ['group', 'sent', 'phone']);
  assert.deepEqual(moveRecipientColumn(order, 'group', 0), ['group', 'phone', 'sent']);
  // 키보드 ←/→ 가 양 끝에서 더 눌려도 목록이 망가지지 않는다.
  assert.deepEqual(moveRecipientColumn(order, 'phone', -5), ['phone', 'group', 'sent']);
  assert.deepEqual(moveRecipientColumn(order, 'sent', 99), ['phone', 'group', 'sent']);
  // 없는 열은 그대로 돌려준다(열이 사라진 뒤 도착한 조작).
  assert.equal(moveRecipientColumn(order, 'custom:없음', 0), order);
  // 원본은 건드리지 않는다.
  assert.deepEqual(order, ['phone', 'group', 'sent']);
});

test('저장 칸은 계정마다 다르고 같은 계정은 늘 같은 칸이다', () => {
  // 🔴 한 브라우저를 여러 계정으로 번갈아 쓸 때 앞 계정 배치가 따라오면 안 된다.
  assert.notEqual(recipientColumnStoreKey('user-a'), recipientColumnStoreKey('user-b'));
  assert.equal(recipientColumnStoreKey('user-a'), recipientColumnStoreKey('user-a'));
  // 구분자(`_`)가 들어간 id 도 다른 id 와 섞이지 않는다.
  assert.notEqual(recipientColumnStoreKey('a_b'), recipientColumnStoreKey('ab'));
  // 키에 쓰기 곤란한 문자가 그대로 들어가지 않는다(id 는 이메일·UUID 무엇이든 올 수 있다).
  assert.match(recipientColumnStoreKey('a@b.co'), /^jayeon\.recipients\.columns\.[0-9a-f_]+$/);
});
