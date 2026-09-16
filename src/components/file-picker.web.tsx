import type { ChangeEvent } from 'react';
import { colors } from '@/constants/theme';
import type { FilePickerProps } from './file-picker-types';
export function FilePicker({ label, accept, maxBytes, disabled, onPick, onError }: FilePickerProps) {
  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > maxBytes) {
      onError(`파일은 ${Math.floor(maxBytes / 1024)} KB까지 추가할 수 있어요.`);
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
      onError('파일을 읽지 못했어요. 다시 선택해 주세요.');
    }
  }
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8, color: colors.ink, fontSize: 16 }}>
      {label}
      <input aria-label={label} type="file" accept={accept} disabled={disabled} onChange={(event) => void pick(event)} />
    </label>
  );
}
