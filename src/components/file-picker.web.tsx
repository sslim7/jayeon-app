import type { ChangeEvent } from 'react';
import { colors } from '@/constants/theme';
import { ATTACHMENT_READ_MESSAGE, oversizeMessage } from '@/lib/attachment-file';
import type { FilePickerProps } from './file-picker-types';
/*
  첨부 파일 선택 — **웹(브라우저와 네이티브 껍데기의 웹뷰).** 운영에서 쓰는 길이라 동작은
  그대로 두고, 한도와 문구만 `lib/attachment-file.ts` 에서 가져온다 — 네이티브 짝
  (`file-picker.tsx`)이 같은 것을 보게 하려는 뜻이다. 여기 숫자를 다시 적으면 그 순간 둘이 갈라진다.
*/
export function FilePicker({ label, accept, maxBytes, disabled, onPick, onError }: FilePickerProps) {
  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > maxBytes) {
      onError(oversizeMessage(maxBytes));
      return;
    }
    try {
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
        reader.readAsDataURL(file);
      });
      onPick({ fileName: file.name, mimeType: file.type, size: file.size, dataBase64: encoded });
    } catch {
      onError(ATTACHMENT_READ_MESSAGE);
    }
  }
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8, color: colors.ink, fontSize: 16 }}>
      {label}
      <input aria-label={label} type="file" accept={accept} disabled={disabled} onChange={(event) => void pick(event)} />
    </label>
  );
}
