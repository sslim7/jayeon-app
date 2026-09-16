const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1' };
const rotated = { accessToken: 'access-2', refreshToken: 'refresh-2' };
const me = { userId: 'user-1', email: 'user@example.com', userName: '사용자', mustChangePassword: false };
const response = (status, body) => ({ status, ok: status < 400, text: async () => body == null ? '' : JSON.stringify(body) });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

// 실제 TS 모듈을 실행하고 플랫폼 저장소/네트워크만 대체한다. 별도 테스트 런타임 의존성은 없다.
function harness(fetch, options = {}) {
  const modules = new Map();
  const disk = new Map();
  const messages = [];
  const context = vm.createContext({
    console, AbortController, Error, setTimeout: options.setTimeout ?? setTimeout, clearTimeout,
    fetch, localStorage: {
      getItem: (key) => disk.get(key) ?? null,
      setItem: (key, value) => disk.set(key, value),
      removeItem: (key) => disk.delete(key),
    },
  });
  const mocks = {
    'react-native': { Platform: { OS: options.native ? 'android' : 'web' } },
    'expo-secure-store': options.storage ?? {},
    '@/config/env': { ENV: { apiUrl: 'https://api.example.test' } },
    '@/lib/native-bridge': { postTokensToNative: (value) => messages.push(value) },
    zustand: { create: (creator) => {
      let state;
      const store = () => state;
      store.setState = (next) => { state = { ...state, ...next }; };
      store.getState = () => state;
      state = creator(store.setState, store.getState);
      return store;
    } },
  };
  function load(name) {
    if (mocks[name]) return mocks[name];
    if (modules.has(name)) return modules.get(name).exports;
    const file = path.resolve(__dirname, '../src', name.replace(/^@\//, '') + '.ts');
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} };
    modules.set(name, mod);
    vm.runInContext(`(function(require, module, exports) {${js}\n})`, context)(load, mod, mod.exports);
    return mod.exports;
  }
  return { load, disk, messages };
}

test('현재 비밀번호 불일치는 refresh 없이 변경 화면과 세션을 보존한다', async () => {
  const calls = [];
  const h = harness(async (url) => { calls.push(url); return response(401, { code: 'INVALID_CREDENTIALS' }); });
  const auth = h.load('@/lib/auth-tokens');
  await auth.saveTokens(tokens);
  const store = h.load('@/store/user-store').useUserStore;
  store.setState({ stage: 'password-change' });
  await assert.rejects(store.getState().changePassword('wrong', 'new-password'),
    (error) => error.name === 'ApiError' && error.status === 401 && error.code === 'INVALID_CREDENTIALS');
  assert.equal(calls.length, 1);
  assert.equal(auth.getRefreshToken(), tokens.refreshToken);
  assert.equal(store.getState().stage, 'password-change');
});

test('동시 401은 refresh 한 번을 공유하고 각 원요청을 재시도한다', async () => {
  let refreshes = 0;
  const wait = deferred();
  const h = harness(async (url, init) => {
    if (url.endsWith('/auth/refresh')) { refreshes++; await wait.promise; return response(200, rotated); }
    return init.headers.Authorization === 'Bearer access-2' ? response(200, me) : response(401, { code: 'UNAUTHORIZED' });
  });
  await h.load('@/lib/auth-tokens').saveTokens(tokens);
  const api = h.load('@/lib/api').api;
  const first = api.get('/users/me');
  const second = api.get('/users/me');
  await new Promise(setImmediate);
  wait.resolve();
  await Promise.all([first, second]);
  assert.equal(refreshes, 1);
});

test('refresh 네트워크 장애는 토큰과 현재 로그인 상태를 지우지 않는다', async () => {
  const calls = [];
  const h = harness(async (url) => {
    calls.push(url);
    if (url.endsWith('/auth/refresh')) throw new TypeError('offline');
    return response(401, { code: 'UNAUTHORIZED' });
  });
  const auth = h.load('@/lib/auth-tokens');
  await auth.saveTokens(tokens);
  const api = h.load('@/lib/api');
  let expired = false;
  api.onSessionExpired(() => { expired = true; });
  await assert.rejects(api.api.get('/users/me'), (error) => error instanceof TypeError && error.message === 'offline');
  assert.deepEqual(calls.map((url) => new URL(url).pathname), ['/users/me', '/auth/refresh']);
  assert.equal(auth.getRefreshToken(), tokens.refreshToken);
  assert.equal(expired, false);
});

test('refresh도 타임아웃 후 종료되고 토큰을 보존한다', async () => {
  const h = harness(async (url, init) => {
    if (!url.endsWith('/auth/refresh')) return response(401, { code: 'UNAUTHORIZED' });
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  }, { setTimeout: (fn) => setTimeout(fn, 10) });
  const auth = h.load('@/lib/auth-tokens');
  await auth.saveTokens(tokens);
  const api = h.load('@/lib/api');
  await assert.rejects(api.api.get('/users/me'), api.ApiTimeoutError);
  assert.equal(auth.getRefreshToken(), tokens.refreshToken);
});

test('로그아웃 후 도착한 refresh는 세션을 되살리지 않는다', async () => {
  const wait = deferred();
  const h = harness(async (url) => url.endsWith('/auth/refresh') ? wait.promise : response(401, { code: 'UNAUTHORIZED' }));
  const auth = h.load('@/lib/auth-tokens');
  await auth.saveTokens(tokens);
  const request = h.load('@/lib/api').api.get('/users/me');
  await new Promise(setImmediate);
  await auth.clearTokens();
  wait.resolve(response(200, rotated));
  await assert.rejects(request, (error) => error.name === 'ApiError' && error.status === 401);
  assert.equal(auth.getStoredTokens(), null);
});

test('늦은 프로필 조회와 로그인 응답은 로그아웃을 되돌리지 않는다', async () => {
  for (const pendingPath of ['/users/me', '/auth/login']) {
    const wait = deferred();
    const h = harness(async (url) => url.endsWith(pendingPath) ? wait.promise : response(200, { ...tokens, mustChangePassword: true }));
    const store = h.load('@/store/user-store').useUserStore;
    const signIn = store.getState().signIn(me.email, 'password');
    await new Promise(setImmediate);
    await store.getState().signOut();
    wait.resolve(response(200, pendingPath === '/users/me' ? me : { ...tokens, mustChangePassword: false }));
    await signIn;
    assert.equal(store.getState().stage, 'anonymous');
    assert.equal(h.load('@/lib/auth-tokens').getStoredTokens(), null);
  }
});

test('로그인 관문 플래그 누락/비boolean은 계약 오류이며 토큰을 저장하지 않는다', async () => {
  for (const flag of [undefined, null, 'false', 0]) {
    const h = harness(async () => response(200, { ...tokens, mustChangePassword: flag }));
    const store = h.load('@/store/user-store').useUserStore;
    await assert.rejects(store.getState().signIn(me.email, 'password'),
      (error) => error.name === 'ContractError' && /비밀번호 변경 여부/.test(error.message));
    assert.equal(store.getState().stage, 'anonymous');
    assert.equal(h.load('@/lib/auth-tokens').getStoredTokens(), null);
  }
});

test('부팅 프로필 플래그 누락은 관문을 열지 않고 저장 토큰은 보존한다', async () => {
  const h = harness(async () => response(200, { ...me, mustChangePassword: undefined }));
  await h.load('@/lib/auth-tokens').saveTokens(tokens);
  const store = h.load('@/store/user-store').useUserStore;
  await store.getState().bootstrap();
  assert.equal(store.getState().booted, true);
  assert.equal(store.getState().stage, 'anonymous');
  assert.equal(h.load('@/lib/auth-tokens').getRefreshToken(), tokens.refreshToken);
});

test('비밀번호 변경 성공은 토큰을 폐기하고 로그인 성공 안내를 남긴다', async () => {
  const h = harness(async () => response(204));
  const auth = h.load('@/lib/auth-tokens');
  await auth.saveTokens(tokens);
  const store = h.load('@/store/user-store').useUserStore;
  store.setState({ stage: 'password-change' });
  await store.getState().changePassword('old-password', 'new-password');
  assert.equal(store.getState().stage, 'anonymous');
  assert.match(store.getState().authNotice, /변경됐어요/);
  assert.equal(auth.getStoredTokens(), null);
  assert.equal(h.messages.at(-1), null);
});

test('네이티브 저장이 느려도 로그아웃 삭제는 저장 이후에 실행된다', async () => {
  const wait = deferred();
  const calls = [];
  const h = harness(async () => {}, { native: true, storage: {
    setItemAsync: async () => { calls.push('save'); await wait.promise; },
    deleteItemAsync: async () => { calls.push('delete'); },
  } });
  const auth = h.load('@/lib/auth-tokens');
  const save = auth.saveTokens(tokens);
  await new Promise(setImmediate);
  const clear = auth.clearTokens();
  assert.equal(auth.getStoredTokens(), null);
  assert.deepEqual(calls, ['save']);
  wait.resolve();
  await Promise.all([save, clear]);
  assert.deepEqual(calls, ['save', 'delete']);
});

test('부팅 저장소 읽기가 늦어도 로그아웃한 토큰을 복원하지 않는다', async () => {
  const wait = deferred();
  const h = harness(async () => {}, { native: true, storage: {
    getItemAsync: () => wait.promise, deleteItemAsync: async () => {},
  } });
  const auth = h.load('@/lib/auth-tokens');
  const load = auth.loadTokens();
  await auth.clearTokens();
  wait.resolve(JSON.stringify(tokens));
  await load;
  assert.equal(auth.getStoredTokens(), null);
});

test('refresh 저장 대기 중 계정이 바뀌면 옛 POST를 새 계정으로 재전송하지 않는다', async () => {
  const wait = deferred();
  let writes = 0;
  let posts = 0;
  const h = harness(async (url) => {
    if (url.endsWith('/auth/refresh')) return response(200, rotated);
    posts++;
    return response(401, { code: 'UNAUTHORIZED' });
  }, { native: true, storage: {
    setItemAsync: async () => { if (++writes === 2) await wait.promise; },
    deleteItemAsync: async () => {},
  } });
  const auth = h.load('@/lib/auth-tokens');
  await auth.saveTokens(tokens);
  const request = h.load('@/lib/api').api.post('/protected-action', { value: 1 });
  await new Promise(setImmediate);
  const clearing = auth.clearTokens();
  const saving = auth.saveTokens({ accessToken: 'another-user', refreshToken: 'another-refresh' });
  wait.resolve();
  await Promise.all([clearing, saving]);
  await assert.rejects(request, (error) => error.name === 'ApiError' && error.status === 401);
  assert.equal(posts, 1);
  assert.equal(auth.getAccessToken(), 'another-user');
});

test('먼저 끝난 refresh 뒤 도착한 이전 401은 새 토큰으로만 재시도한다', async () => {
  const late = deferred();
  let refreshes = 0;
  let calls = 0;
  const h = harness(async (url, init) => {
    if (url.endsWith('/auth/refresh')) { refreshes++; return response(200, rotated); }
    if (init.headers.Authorization === 'Bearer access-2') return response(200, me);
    if (++calls === 2) return late.promise;
    return response(401, { code: 'UNAUTHORIZED' });
  });
  await h.load('@/lib/auth-tokens').saveTokens(tokens);
  const api = h.load('@/lib/api').api;
  const first = api.get('/users/me');
  const second = api.get('/users/me');
  await first;
  late.resolve(response(401, { code: 'UNAUTHORIZED' }));
  await second;
  assert.equal(refreshes, 1);
});
