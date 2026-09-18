import { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import * as Picker from 'expo-document-picker';

import { SmsButton, s } from '@/components/sms-ui';
import { spacing } from '@/constants/theme';
import { AUDIO_HINT, audioContentType, checkAudioSize } from '@/lib/call-file';
import { failureCode, failureReason } from '@/lib/call-errors';
import type { CallFileFieldProps } from './call-file-field-types';

/**
 * 녹음 파일 선택 — **네이티브.**
 *
 * 실제 화면은 껍데기의 웹뷰 안에서 뜨고 거기서는 감춘 `<input type="file">` 을 덮은 같은
 * 모양의 버튼이 선다(→ `call-file-field.web.tsx`). 이 파일은 네이티브로 직접 연 화면이
 * 쓰는 길이고, **버튼 모양은 양쪽이 같아야 한다** — 같은 시트가 기기에 따라 다르게 보이면
 * 고장 신고를 받을 때 기종부터 물어야 한다.
 *
 * `copyToCacheDirectory` 로 캐시에 사본을 만든다. 원본 URI 는 콘텐츠 제공자가 언제든 회수할
 * 수 있어서, 업로드가 몇 분 걸리는 동안 사라지면 그 실패의 원인을 추적할 단서가 없다.
 * 캐시 사본은 iOS 백업 대상이 아니므로 따로 제외 표시를 하지 않는다.
 */
export function CallFileField({ label, value, disabled, onPick, onError }: CallFileFieldProps) {
  const [busy, setBusy] = useState(false);
  async function pick() {
    setBusy(true);
    try {
      const selected = await Picker.getDocumentAsync({ type: ['audio/*', 'application/ogg', 'video/3gpp'], copyToCacheDirectory: true, multiple: false });
      if (selected.canceled) return;
      const asset = selected.assets[0];
      checkAudioSize(asset.size ?? 0);
      const contentType = audioContentType(asset.name, asset.mimeType);
      // 파일 시각은 **원본 기준**이다 — expo-document-picker 가 안드로이드는 DocumentsContract 의
      // COLUMN_LAST_MODIFIED, iOS 는 원본 URL 의 contentModificationDate 를 읽는다(캐시 사본이 아니다).
      const modified = typeof asset.lastModified === 'number' && Number.isFinite(asset.lastModified) && asset.lastModified > 0 ? asset.lastModified : null;
      onPick({ name: asset.name, size: asset.size!, content_type: contentType, modified_at: modified, source: { kind: 'native', uri: asset.uri } });
    } catch (error) {
      onError(failureReason(failureCode(error)));
    } finally {
      setBusy(false);
    }
  }
  return <View style={styles.field}>
    <SmsButton label={label} secondary disabled={disabled || busy} onPress={() => void pick()} />
    {/* 고른 파일은 이름과 크기로 확인시킨다. 다시 고르려면 위 버튼을 그대로 누른다. */}
    {value ? <Text style={s.body}>{value.name} · {(value.size / 1e6).toFixed(1)} MB</Text> : null}
    <Text style={s.meta}>{AUDIO_HINT}</Text>
  </View>;
}

const styles = StyleSheet.create({ field: { gap: spacing.xs } });
