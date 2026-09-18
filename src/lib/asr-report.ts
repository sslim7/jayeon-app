/**
 * 측정 결과를 폰 밖으로 꺼내는 길.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이게 없으면 「폰에서 돌아갔다」만 알고 품질은 모른 채로 끝난다.** 맥북 f16 결과와  │
 * │ CER 을 비교해야 이번 측정이 값을 갖는다(→ `docs/on-device-asr.md` 7절).           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 **원문 파일에는 전사문만 넣는다.** 측정값을 같은 파일에 섞으면 CER 계산이 그 글자들까지
 * 세어 결과가 조용히 틀어진다. 측정값은 따로 복사한다.
 *
 * 내보내기가 공유 시트인 이유: 앱 전용 저장소에 쓴 파일은 릴리스 빌드에서 `adb pull` 로
 * 꺼낼 수 없다(`run-as` 가 막힌다). 공유 시트를 거치면 사용자가 드라이브·메일·다운로드 등
 * 손이 닿는 곳으로 직접 보낼 수 있다.
 */
import * as FS from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';

export type AsrReport = {
  modelLabel: string;
  gpu: boolean;
  reasonNoGPU: string;
  threads: number;
  benchConfig: string | null;
  benchEncodeMs: number | null;
  benchDecodeMs: number | null;
  audioSeconds: number;
  convertMs: number;
  transcribeMs: number;
  loadMs: number;
  characters: number;
  aborted: boolean;
};

/** 화면에 띄우는 것과 **같은 문장**을 복사한다. 다르면 스크린샷과 붙여넣기가 어긋난다. */
export function reportLines(report: AsrReport): string[] {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
  const total = report.convertMs + report.transcribeMs;
  return [
    `모델: ${report.modelLabel}`,
    `NPU/GPU: ${report.gpu ? '사용함' : `사용 못 함${report.reasonNoGPU ? ` (${report.reasonNoGPU})` : ''}`}`,
    `스레드: ${report.threads}`,
    report.benchConfig
      ? `벤치(30초 청크): ${report.benchConfig} · 인코더 ${report.benchEncodeMs?.toFixed(2)}ms · 디코더 ${report.benchDecodeMs?.toFixed(2)}ms`
      : '벤치: 실행 안 함',
    `오디오 길이: ${report.audioSeconds.toFixed(0)}초`,
    `모델 적재: ${seconds(report.loadMs)}`,
    `변환: ${seconds(report.convertMs)}`,
    `받아쓰기: ${seconds(report.transcribeMs)}`,
    `합계(변환+받아쓰기): ${seconds(total)}`,
    `실시간 대비: ${(report.audioSeconds * 1000 / Math.max(total, 1)).toFixed(2)}배`,
    `글자 수: ${report.characters}`,
    report.aborted ? '⚠️ 중간에 멈춘 결과입니다 — 전체 시간이 아닙니다' : '',
  ].filter(Boolean);
}

export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}

/**
 * 전사문을 `.txt` 로 내보낸다.
 *
 * ⚠️ 파일 이름에 모델과 시각을 넣는다. q5_0 과 q8_0 을 연달아 재면 두 파일이 생기는데,
 * 이름이 같으면 어느 쪽이 어느 쪽인지 알 수 없게 된다 — 비교가 목적인 측정에서 치명적이다.
 */
export async function exportTranscript(modelId: string, text: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('이 기기에서는 공유를 쓸 수 없습니다.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const uri = `${FS.cacheDirectory}transcript-${modelId}-${stamp}.txt`;
  await FS.writeAsStringAsync(uri, text);
  await Sharing.shareAsync(uri, { mimeType: 'text/plain', UTI: 'public.plain-text', dialogTitle: '받아쓰기 원문 내보내기' });
}
