import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { colors } from '@/constants/theme';

/** Android 시스템의 작은 시작 아이콘 다음에 원본 사진을 화면 전체 영역에 표시한다. */
export function NativeBootSplash({ ready, onFinished }: { ready: boolean; onFinished: () => void }) {
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!ready || loadedAt === null) return;
    const timer = setTimeout(onFinished, Math.max(0, 600 - (Date.now() - loadedAt)));
    return () => clearTimeout(timer);
  }, [ready, loadedAt, onFinished]);
  return <View accessibilityLabel="Nature를 준비하는 중" style={[StyleSheet.absoluteFill, styles.cover]}>
    <Image source={require('../../assets/images/splash.png')} resizeMode="contain" style={styles.photo} onLoadEnd={() => {
      setLoadedAt(Date.now());
      void SplashScreen.hideAsync().catch(() => {});
    }} />
  </View>;
}
// require 이미지는 원본 픽셀 크기가 width/height로 먼저 들어가 absoluteFill의 상하좌우를 이긴다.
// 크기를 명시하지 않으면 사진이 원본 크기로 좌상단에 붙어 확대된 것처럼 보인다.
const styles = StyleSheet.create({
  cover: { backgroundColor: colors.bg, zIndex: 1000 },
  photo: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
});
