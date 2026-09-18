/**
 * 고른 녹음 파일이 **올릴 수 있는 것인지** 판정하는 순수 규칙.
 *
 * 웹의 `<input type="file">` 과 네이티브의 문서 선택기가 같은 답을 써야 한다 — 한쪽만
 * 느슨하면 그쪽에서 고른 파일이 서버에서 400 으로 돌아오고, 사용자는 왜 자기 파일만 안
 * 되는지 알 수 없다. 그래서 규칙을 여기 하나에 둔다.
 */

/** 서버가 받는 상한(§`jayeon-was/internal/calls/audio.go` 의 `maxAudioBytes`). 100 MiB. */
export const AUDIO_MAX_BYTES = 100 * 1024 * 1024;

/**
 * 확장자 → 보낼 MIME.
 *
 * 🔴 **브라우저가 알려 주는 `File.type` 을 그대로 믿지 않는다.** 같은 m4a 를 두고 크롬은
 * `audio/x-m4a`, 사파리는 빈 문자열을 준다. 둘 다 서버 화이트리스트에 없어서 그대로 보내면
 * 400 이다. 확장자는 사용자가 보는 값이고 흔들리지 않으므로 그쪽을 정본으로 삼고, 확장자를
 * 모를 때만 브라우저 값을 본다.
 */
const BY_EXTENSION: Record<string, string> = {
  m4a: 'audio/m4a', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg',
  wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  webm: 'audio/webm', amr: 'audio/amr', '3gp': 'audio/3gpp', '3gpp': 'audio/3gpp',
};

/** 서버가 허용하는 MIME 전부. 확장자를 모를 때 브라우저 값을 여기에 비춰 본다. */
const ALLOWED = new Set(['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/amr', 'audio/3gpp']);

/** 파일 선택기에 거는 필터. 확장자를 함께 적어야 일부 안드로이드 웹뷰에서 목록이 비지 않는다. */
export const AUDIO_ACCEPT = '.m4a,.mp4,.aac,.mp3,.wav,.ogg,.oga,.opus,.webm,.amr,.3gp,audio/*';
/** 화면에 적는 안내. 위 표와 **같은 목록**이어야 한다. */
export const AUDIO_HINT = 'm4a, mp3, wav, aac, 3gp, ogg, webm, amr';

/** 올릴 때 쓸 MIME. 판정할 수 없으면 `UNSUPPORTED_TYPE` 으로 거절한다. */
export function audioContentType(name: string, given?: string | null): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1]?.toLowerCase();
  const byExtension = extension ? BY_EXTENSION[extension] : undefined;
  if (byExtension) return byExtension;
  const declared = (given ?? '').trim().toLowerCase().split(';')[0];
  if (ALLOWED.has(declared)) return declared;
  throw new Error('UNSUPPORTED_TYPE');
}

/** 크기 규칙. 0바이트와 상한 초과를 **고르는 자리에서** 거른다 — 28MB 를 올린 뒤 400 을 받느니 낫다. */
export function checkAudioSize(size: number): void {
  if (!Number.isFinite(size) || size <= 0) throw new Error('EMPTY_FILE');
  if (size > AUDIO_MAX_BYTES) throw new Error('FILE_TOO_LARGE');
}
