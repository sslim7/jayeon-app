/**
 * 앱 자신에 대한 값.
 *
 * `app.json` 의 `expo.version` 을 그대로 읽는다 — 버전을 코드에 손으로 적어 두면 배포할
 * 때마다 한쪽이 뒤처지고, 그 어긋남은 **고장 신고를 받을 때** 드러난다: 사용자가 말한 버전과
 * 실제로 돌던 버전이 다르면 재현할 대상을 찾지 못한다.
 */
import Constants from 'expo-constants';

export const APP_VERSION = Constants.expoConfig?.version ?? '';
