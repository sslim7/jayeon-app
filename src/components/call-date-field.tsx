import { TextField } from '@/components/form-fields';
import type { CallDateFieldProps } from './call-date-field-types';

/**
 * 통화일시 입력 — **네이티브 폴백.**
 *
 * 이 화면은 실제로는 웹뷰(웹 빌드)로 뜨고, 날짜·시간 선택기는 거기서만 열린다
 * (→ `call-date-field.web.tsx`). 네이티브로 직접 열리는 경로가 남아 있을 수 있으므로
 * 여기서는 **적어도 타이핑은 되게** 지금까지의 입력칸을 그대로 둔다. 선택기를 네이티브에도
 * 붙이려면 새 의존성이 필요한데, 쓰이지 않는 경로를 위해 들일 이유가 없다.
 */
export function CallDateField({ label, value, onChange }: CallDateFieldProps) {
  return <TextField label={label} value={value} onChangeText={onChange} placeholder="2026-09-17 14:20" maxLength={16} />;
}
