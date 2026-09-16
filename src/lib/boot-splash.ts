/**
 * 웹 부팅 스플래시를 걷어낸다. **네이티브에서는 할 일이 없다** —
 * `expo-splash-screen` 이 그리는 진짜 스플래시를 `_layout.tsx` 가 따로 내린다.
 *
 * 스텁을 두는 이유는 `native-bridge` 짝과 같다: 호출부가 플랫폼 분기를 두지 않아도 되게.
 */
export function hideBootSplash(): void {}
