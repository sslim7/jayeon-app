import { useId, type ChangeEvent, type CSSProperties, type MouseEvent } from 'react';

import { colors, fonts, inputFontSize, radii, spacing, text, type FontToken } from '@/constants/theme';
import { fromDateTimeInput, toDateTimeInput } from '@/lib/call-date';
import type { CallDateFieldProps } from './call-date-field-types';

/**
 * 통화일시 입력 — **웹(웹뷰 포함).**
 *
 * `<input type="datetime-local">` 은 브라우저가 **기기 기본 달력·시간 선택기**를 띄운다.
 * 폰 웹뷰에서도 그대로 동작하고 새 의존성도 필요 없다 — 이 한 칸을 위해 날짜 선택기
 * 라이브러리를 들이지 않는다.
 *
 * 값은 바깥(화면)에서 `YYYY-MM-DD HH:mm` 으로 다루고, 이 입력이 쓰는 `YYYY-MM-DDTHH:mm` 은
 * **여기서만** 오간다(→ `@/lib/call-date`). 형식 변환이 화면으로 새어 나가면 저장 직전
 * 검사와 어긋난다.
 *
 * 모양은 `form-fields.tsx` 의 `TextField` 와 맞춘다 — 같은 시트 안에서 한 칸만 다르게
 * 보이면 그건 의도가 아니라 사고로 읽힌다. 🔴 글자 크기는 `inputFontSize()` 를 통과시킨다
 * (16px 미만이면 iOS Safari 가 포커스에서 페이지를 확대하고 돌아오지 않는다).
 */
export function CallDateField({ label, value, onChange }: CallDateFieldProps) {
  const id = useId();
  function pick(event: MouseEvent<HTMLInputElement>) {
    // 값 어디를 눌러도 선택기가 열리게 한다. 지원하지 않는 브라우저(그리고 사용자 동작 없이
    // 불린 경우)는 던지므로 삼킨다 — 못 열려도 타이핑은 그대로 된다.
    try { (event.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); }
    catch { /* 선택기를 못 열면 직접 입력한다. */ }
  }
  return (
    <div style={styles.field}>
      <label htmlFor={id} style={styles.label}>{label}</label>
      <input
        id={id}
        aria-label={label}
        type="datetime-local"
        step={60}
        value={toDateTimeInput(value)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(fromDateTimeInput(event.target.value))}
        onClick={pick}
        style={styles.input}
      />
    </div>
  );
}

/** 폰트 토큰의 굵기는 웹에서 그대로 CSS 값이다(→ `constants/theme.ts`). */
const weight = (token: FontToken) => token.fontWeight as CSSProperties['fontWeight'];

const styles: Record<'field' | 'label' | 'input', CSSProperties> = {
  field: { display: 'flex', flexDirection: 'column', marginTop: spacing.lg },
  label: {
    fontFamily: fonts.bodySemi.fontFamily,
    fontWeight: weight(fonts.bodySemi),
    fontSize: text.sm,
    letterSpacing: 1,
    color: colors.muted,
  },
  input: {
    boxSizing: 'border-box',
    width: '100%',
    marginTop: spacing.xs,
    height: 48,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.button,
    backgroundColor: colors.card,
    padding: '0 14px',
    fontFamily: fonts.body.fontFamily,
    fontWeight: weight(fonts.body),
    fontSize: inputFontSize(text.lg),
    color: colors.ink,
  },
};
