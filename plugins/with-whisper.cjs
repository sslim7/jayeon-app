/**
 * whisper.rn 을 안드로이드 빌드에 붙이는 Expo config plugin.
 *
 * whisper.rn 은 자체 config plugin 을 내보내지 않는다(패키지에 `app.plugin.js` 가 없다).
 * 오토링킹은 네이티브 라이브러리를 앱에 넣어 주지만, **런타임에 NPU 를 열 수 있게 하는 것은
 * 매니페스트 선언**이라 그것만 여기서 채운다.
 *
 * 🔴 **`libcdsprpc.so` 선언이 없으면 Hexagon NPU 가 조용히 CPU 로 폴백한다.**
 * 안드로이드 O 이후 앱은 매니페스트에 적지 않은 시스템 네이티브 라이브러리를 `dlopen` 할 수
 * 없다. 그런데 ggml-hexagon 은 열지 못해도 **예외를 던지지 않고 CPU 백엔드로 내려간다** —
 * 즉 빌드도 실행도 성공하고, 속도만 몇 배 느려진다. 이번 작업의 목적이 「NPU 가 실제로
 * 잡히는지」를 재는 것이므로, 이 한 줄이 빠지면 측정 결과 전체가 거짓이 된다.
 * (whisper.rn README 의 "Hexagon NPU (Experimental)" 절이 요구하는 선언이다.)
 *
 * ⚠️ `required="false"` 여야 한다. `true` 면 FastRPC 가 없는 기기(퀄컴이 아닌 SoC, 에뮬레이터)에서
 * **설치 자체가 거부된다.** 우리는 폴백을 원하지 설치 거부를 원하지 않는다.
 *
 * 나머지 한 가지는 프로가드다. JNI 가 이름으로 찾는 `com.rnwhisper.*` 클래스는 정적 참조가
 * 없어 릴리스 축소에서 통째로 지워질 수 있고, 그러면 **디버그 빌드에서만 되는** 버그가 된다.
 */
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const FASTRPC = 'libcdsprpc.so';

module.exports = (config) => {
  config = withAndroidManifest(config, (c) => {
    const application = c.modResults.manifest.application?.[0];
    if (!application) throw new Error('whisper.rn: AndroidManifest 에 <application> 이 없습니다');
    const declared = application['uses-native-library'] ?? [];
    // 두 번 붙이면 aapt2 가 중복 선언으로 빌드를 세운다. prebuild 는 여러 번 돌 수 있다.
    if (!declared.some((item) => item?.$?.['android:name'] === FASTRPC)) {
      declared.push({ $: { 'android:name': FASTRPC, 'android:required': 'false' } });
    }
    application['uses-native-library'] = declared;
    return c;
  });
  return withDangerousMod(config, ['android', async (c) => {
    const file = path.join(c.modRequest.platformProjectRoot, 'app/proguard-rules.pro');
    const rules = fs.readFileSync(file, 'utf8');
    if (!rules.includes('# whisper.rn')) {
      fs.appendFileSync(file, '\n# whisper.rn — JNI 가 이름으로 찾는 클래스라 축소에서 살아남아야 한다\n-keep class com.rnwhisper.** { *; }\n');
    }
    return c;
  }]);
};
