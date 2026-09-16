import { Notice } from '@/components/sms-ui';
import type { FilePickerProps } from './file-picker-types';
export function FilePicker(_props: FilePickerProps) {
  return <Notice message="파일은 웹 화면 또는 Android 앱의 웹 화면에서 추가해 주세요." />;
}
