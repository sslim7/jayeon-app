const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('src/lib/call-summary.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${source}\n})`, {})(mod.exports);
const { summaryLines } = mod.exports;
/** 다른 vm 컨텍스트가 만든 배열이라 프로토타입이 달라 deepEqual 이 통하지 않는다(§call-audio.test.cjs). */
const lines = (summary) => [...summaryLines(summary)];

/*
 * 🔴 **여기서 잡는 고장은 화면에서 보이지 않는다.**
 *
 * 요약을 문장마다 끊어 그리는 일은 대부분의 통화에서 잘 돌아가고, 틀리는 것은 「1.5개월」이나
 * 번호 매김이 들어간 **특정 요약 하나**에서만이다. 그 통화를 열어 보기 전에는 아무도 모른다.
 */

test('요약은 문장마다 끊기고 문장부호는 남는다', () => {
  const first = lines('더메이의 권자현 팀장이 고객 영연님에게 전화하여 결혼 소개 서비스 상담을 진행했다. 고객의 이상형과 선호하는 만남 방식을 확인했다. 고객은 일대일 만남을 선호한다.');
  assert.equal(first.length, 3);
  assert.equal(first[0], '더메이의 권자현 팀장이 고객 영연님에게 전화하여 결혼 소개 서비스 상담을 진행했다.');
  assert.equal(first[2], '고객은 일대일 만남을 선호한다.');
});

test('숫자에 끼인 점과 낱말 안의 점에서는 끊지 않는다', () => {
  // 🔴 「1.5개월」이 갈라지면 요약이 거짓을 말하게 된다 — 「1.」과 「5개월」은 다른 값이다.
  assert.deepEqual(lines('기간제 프로그램은 1.5개월 단위로 운영된다고 안내했다.'), ['기간제 프로그램은 1.5개월 단위로 운영된다고 안내했다.']);
  assert.deepEqual(lines('자세한 내용은 www.themay.co.kr 에서 확인하라고 안내했다.'), ['자세한 내용은 www.themay.co.kr 에서 확인하라고 안내했다.']);
});

test('번호 매김과 줄임말은 다음 문장의 머리로 붙는다', () => {
  // 「1.」만 남은 줄이 따로 서면 원래 문장이 어디에도 없다.
  assert.deepEqual(lines('1. 이상형을 확인했다.'), ['1. 이상형을 확인했다.']);
  assert.equal(lines('파티와 기간제 등. 여러 방식을 안내했다.').length, 1);
});

test('마침표 없이 끝나는 요약도 마지막 문장을 잃지 않는다', () => {
  assert.deepEqual(lines('고객이 생각해 본 뒤 연락하기로 함'), ['고객이 생각해 본 뒤 연락하기로 함']);
  const tail = lines('상담을 진행했다. 고객이 생각해 본 뒤 연락하기로 함');
  assert.equal(tail.length, 2);
  assert.equal(tail[1], '고객이 생각해 본 뒤 연락하기로 함');
});

test('빈 요약은 빈 목록이다 — 부르는 쪽이 구획 자체를 걷는다', () => {
  assert.deepEqual(lines(''), []);
  assert.deepEqual(lines('   \n '), []);
});
