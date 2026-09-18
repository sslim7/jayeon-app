import type { CallFile } from '@/types/calls';

/** 웹·네이티브 파일 선택 칸이 같은 props 를 받도록 한 곳에 둔다(→ `call-file-field.web.tsx`). */
export type CallFileFieldProps = {
  label: string;
  /** 고른 파일. 없으면 형식 안내만 보인다. */
  value: CallFile | null;
  disabled?: boolean;
  onPick: (file: CallFile) => void;
  /** 고를 수 없는 이유. **코드가 아니라 사람이 읽을 한 줄**로 온다. */
  onError: (message: string) => void;
};
