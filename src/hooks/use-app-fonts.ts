import {
  Archivo_400Regular,
  Archivo_700Bold,
  Archivo_800ExtraBold,
} from '@expo-google-fonts/archivo';
import {
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
  IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono';
import {
  IBMPlexSansKR_400Regular,
  IBMPlexSansKR_500Medium,
  IBMPlexSansKR_600SemiBold,
  IBMPlexSansKR_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-kr';
import { useFonts } from 'expo-font';

/**
 * 네이티브(iOS/Android) 폰트 로딩.
 *
 * TTF 원본을 그대로 쓴다 — 네이티브는 폰트가 앱 번들에 들어가 있어 **전송량이 0** 이고,
 * 한글 글리프가 전부 담겨 있어 어떤 글자도 깨지지 않는다.
 *
 * 🔴 **웹은 이 파일을 쓰지 않는다**(`use-app-fonts.web.ts`). 여기 있는 TTF import 가 웹
 * 번들에 섞이면 그 순간 수 MB 가 배포본에 들어간다. 그러니 **웹 코드에서 이 모듈을 직접
 * 경로로 import 하지 마라** — 반드시 `@/hooks/use-app-fonts` 로 들어와야 번들러가 갈라 준다.
 *
 * 키 이름은 `constants/theme.ts` 의 네이티브 패밀리 이름과 1:1 로 맞아야 한다.
 *
 * @returns 화면을 그려도 되는지 여부. **로딩 실패도 `true` 다** — 폰트 하나 때문에 앱이
 *   영원히 스플래시에 갇히는 것보다 시스템 폰트로라도 뜨는 편이 훨씬 낫다.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    Archivo_400Regular,
    Archivo_700Bold,
    Archivo_800ExtraBold,
    IBMPlexSansKR_400Regular,
    IBMPlexSansKR_500Medium,
    IBMPlexSansKR_600SemiBold,
    IBMPlexSansKR_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
    IBMPlexMono_700Bold,
  });

  return loaded || !!error;
}
