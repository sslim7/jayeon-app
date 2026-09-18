import { useState, type ChangeEvent, type CSSProperties } from 'react';

import { colors, fonts, radii, spacing, text, type FontToken } from '@/constants/theme';
import { AUDIO_ACCEPT, AUDIO_HINT, audioContentType, checkAudioSize } from '@/lib/call-file';
import { failureCode, failureReason } from '@/lib/call-errors';
import type { CallFileFieldProps } from './call-file-field-types';

/**
 * 녹음 파일 선택 — **웹(브라우저와 네이티브 껍데기의 웹뷰).**
 *
 * 웹뷰 안에서도 안드로이드가 기본 파일 선택기를 띄우므로(→ `components/web-shell.tsx` 의
 * `allowFileAccess`) 브리지로 파일을 나를 이유가 없다.
 *
 * 🔴 **고른 `File` 을 그대로 들고 있는다.** 바이트를 읽지도 base64 로 바꾸지도 않는다 —
 * 28MB 통화를 문자열로 만드는 순간 폰 웹뷰의 메모리가 무너진다. 업로드는 이 손잡이를
 * XHR 바디로 그대로 넘긴다(→ `lib/call-put.web.ts`).
 *
 * # 왜 `<label>` 로 감싸 숨기나
 *
 * 브라우저 기본 `<input type="file">` 은 「파일 선택 | 선택된 파일 없음」이라는 작은 회색
 * 컨트롤로 그려진다. 같은 시트의 다른 버튼과 크기도 모양도 맞지 않고, 무엇보다 파일을 고른
 * 뒤에도 그 문구가 **아래 줄과 다른 말을 한다.** 그래서 입력은 시각적으로만 숨기고
 * (`display:none` 이 아니다 — 그러면 키보드 초점이 닿지 않는다) `<label>` 자체를
 * `SmsButton` 과 같은 크기·둥글기·색의 버튼으로 그린다. 라벨을 누르면 브라우저가 입력을
 * 대신 눌러 주므로 `ref.click()` 같은 배선이 필요 없고, 키보드 사용자는 숨은 입력에 초점을
 * 맞춰 같은 동작을 얻는다(초점이 갔을 때 테두리를 살려 보이게 한다).
 */
export function CallFileField({ label, value, disabled, onPick, onError }: CallFileFieldProps) {
  const [focused, setFocused] = useState(false);
  function pick(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      checkAudioSize(file.size);
      const contentType = audioContentType(file.name, file.type);
      onPick({ name: file.name, size: file.size, content_type: contentType, modified_at: file.lastModified || null, source: { kind: 'web', file } });
    } catch (error) {
      // 받지 못할 파일은 자리를 비워 둔다. 같은 파일을 다시 골라도 change 가 오게 하려는 뜻도 있다.
      input.value = '';
      // 코드를 사람 말로 바꿔 넘긴다. 화면은 이 한 줄을 그대로 보여 준다.
      onError(failureReason(failureCode(error)));
    }
  }
  return (
    <div style={styles.field}>
      <label style={{ ...styles.button, ...(disabled ? styles.disabled : null), ...(focused ? styles.focused : null) }}>
        <span style={styles.buttonText}>{label}</span>
        <input
          aria-label={label}
          type="file"
          accept={AUDIO_ACCEPT}
          disabled={disabled}
          onChange={pick}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.input}
        />
      </label>
      {/* 고른 파일은 이름과 크기로 확인시킨다. 브라우저 기본 문구는 보이지 않는다. */}
      {value ? <span style={styles.chosen}>{value.name} · {(value.size / 1e6).toFixed(1)} MB</span> : null}
      <span style={styles.hint}>{AUDIO_HINT}</span>
    </div>
  );
}

/** 폰트 토큰의 굵기는 웹에서 그대로 CSS 값이다(→ `constants/theme.ts`). */
const weight = (token: FontToken) => token.fontWeight as CSSProperties['fontWeight'];

const styles: Record<'field' | 'button' | 'buttonText' | 'input' | 'chosen' | 'hint' | 'disabled' | 'focused', CSSProperties> = {
  field: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  // `SmsButton` 의 secondary 와 같은 크기·둥글기·색이어야 한다(→ `components/sms-ui.tsx`).
  button: {
    position: 'relative',
    boxSizing: 'border-box',
    minHeight: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: radii.button,
    border: `1px solid ${colors.borderPill}`,
    backgroundColor: colors.card,
    cursor: 'pointer',
  },
  buttonText: { fontFamily: fonts.bodySemi.fontFamily, fontWeight: weight(fonts.bodySemi), fontSize: text.lg, color: colors.ink },
  /*
   * 🔴 `display:none` 도 `visibility:hidden` 도 아니다 — 둘 다 키보드 초점이 닿지 않아
   * 파일 선택을 키보드만으로 열 수 없게 된다. 버튼 전체를 덮되 투명하게 둔다.
   */
  input: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' },
  chosen: { fontFamily: fonts.body.fontFamily, fontSize: text.md, color: colors.ink },
  hint: { fontFamily: fonts.body.fontFamily, fontSize: text.sm, color: colors.muted },
  disabled: { opacity: 0.5, cursor: 'default' },
  // 초점은 보여야 한다. 마우스 사용자에게만 맞춘 화면은 키보드 사용자를 길 잃게 만든다.
  focused: { outline: `2px solid ${colors.green}`, outlineOffset: 2 },
};
