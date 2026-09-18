const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('src/lib/call-audio.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(`(function(exports){${source}\n})`, { Date, Number })(mod.exports);
const { callAudio, AUDIO_RETENTION_DAYS } = mod.exports;
/** 다른 vm 컨텍스트가 만든 객체라 프로토타입이 달라 deepEqual 이 통하지 않는다. 값만 비교한다. */
const check = (state, url, reason) => { assert.equal(state.url, url); assert.equal(state.reason, reason); };

const now = Date.parse('2026-09-18T00:00:00Z');
const record = (extra) => ({ call_id: 'c', contact: { name: '김영국', phone: '+821012345678' }, call: { file_name: 'a.m4a', duration: null, recorded_at: '2026-09-17T00:00:00Z' }, created_at: '2026-09-17T00:00:00Z', status: 'COMPLETED', progress: null, ...extra });

test('녹음 주소가 없으면 이유를 돌려준다', () => {
  check(callAudio(record(), now), null, '녹음이 아직 준비되지 않았습니다.');
  check(callAudio(record({ audio_url: null }), now), null, '녹음이 아직 준비되지 않았습니다.');
});

test('보관 기간이 지난 녹음은 주소가 있어도 들을 수 없다', () => {
  const old = record({ audio_url: 'https://example.com/a.m4a', call: { file_name: 'a.m4a', duration: null, recorded_at: '2025-09-01T00:00:00Z' } });
  check(callAudio(old, now), null, `보관 기간(${AUDIO_RETENTION_DAYS}일)이 지나 녹음이 삭제되었습니다.`);
  // 경계 하루 전은 아직 들을 수 있다.
  const edge = record({ audio_url: 'https://example.com/a.m4a', call: { file_name: 'a.m4a', duration: null, recorded_at: new Date(now - (AUDIO_RETENTION_DAYS - 1) * 86400000).toISOString() } });
  check(callAudio(edge, now), 'https://example.com/a.m4a', undefined);
});

test('주소가 있고 기간 안이면 그대로 돌려준다', () => {
  check(callAudio(record({ audio_url: 'https://example.com/a.m4a' }), now), 'https://example.com/a.m4a', undefined);
});
