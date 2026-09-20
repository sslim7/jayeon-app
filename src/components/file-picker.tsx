import { useState } from 'react';
import * as Picker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';

import { SmsButton } from '@/components/sms-ui';
import { attachmentReason, pickNativeAttachment } from '@/lib/attachment-file';
import type { FilePickerProps } from './file-picker-types';

/**
 * 첨부 파일 선택 — **네이티브.**
 *
 * 전에는 「웹 화면에서 추가해 주세요」라는 안내만 서 있었다. 앱으로 템플릿을 고치던 사용자는
 * 그 「웹 화면」이 어디인지 알 방법이 없었고, 삭제는 되는데 추가만 안 되는 화면을 봤다.
 * 웹 짝(`file-picker.web.tsx`)이 `<input type="file">` 로 하는 일을 여기서는 문서 선택기로 한다.
 *
 * # 왜 `expo-image-picker` 가 아닌가
 *
 * 이미지를 고르는 일이니 그쪽이 자연스러워 보이지만, **`expo-document-picker` 가 이미
 * 의존성에 있고**(→ `components/call-file-field.tsx` 가 녹음 파일에 쓴다) 같은 일을 한다.
 * 게다가 사진 선택기는 안드로이드·iOS 모두 사진 보관함 접근 권한을 묻는 반면 문서 선택기는
 * 시스템이 대신 열어 주므로 **권한을 묻지 않는다** — 권한 거절이라는 실패 경로가 아예 없다.
 * 새 네이티브 모듈은 새 빌드를 뜻하기도 한다. 있는 것으로 되는 일에 하나를 더 들이지 않았다.
 *
 * 🔴 **검증은 웹과 같은 규칙을 쓴다**(→ `lib/attachment-file.ts`). 형식·크기 판정도, 거절할 때
 * 하는 말도 그 파일 하나에서 온다. 한쪽만 느슨하면 웹에서 막힌 파일이 앱에서는 통과해 서버가
 * 거절하고, 사용자는 왜 자기 폰에서만 되는(혹은 안 되는)지 알 수 없다.
 *
 * `copyToCacheDirectory` 로 캐시에 사본을 만든다 — 원본 URI 는 콘텐츠 제공자가 언제든 회수할
 * 수 있어서, 바이트를 읽기 전에 사라지면 그 실패의 원인을 추적할 단서가 없다.
 */
export function FilePicker({ label, accept, maxBytes, disabled, onPick, onError }: FilePickerProps) {
  const [busy, setBusy] = useState(false);
  async function pick() {
    setBusy(true);
    try {
      const file = await pickNativeAttachment({
        open: (types) => Picker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false }),
        readBase64: (uri) => FS.readAsStringAsync(uri, { encoding: 'base64' }),
      }, { accept, maxBytes });
      // 취소는 `null` 이다 — 아무 일도 일어나지 않아야 한다.
      if (file) onPick(file);
    } catch (error) {
      // 코드를 사람 말로 바꿔 넘긴다. 화면은 이 한 줄을 그대로 보여 준다.
      onError(attachmentReason(error, maxBytes));
    } finally {
      setBusy(false);
    }
  }
  return <SmsButton label={label} secondary disabled={disabled || busy} onPress={() => void pick()} />;
}
