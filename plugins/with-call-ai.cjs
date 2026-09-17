// Expo 57-compatible CJS plugin. llama.rn 0.12.3's bundled plugin has an ESM/default
// import incompatibility; apply its required C++20 setting using the public API.
const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
module.exports = config => {
  config = withXcodeProject(config, c => {
    for (const item of Object.values(c.modResults.pbxXCBuildConfigurationSection())) {
      if (item && typeof item === 'object' && item.buildSettings) {
        item.buildSettings.CLANG_CXX_LANGUAGE_STANDARD = '"gnu++20"';
        item.buildSettings.CLANG_CXX_LIBRARY = '"libc++"';
      }
    }
    return c;
  });
  config = withDangerousMod(config, ['ios', async c => {
    const file = path.join(c.modRequest.platformProjectRoot, 'Podfile');
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('# Nature call AI C++20')) return c;
    const start = text.indexOf('post_install do |installer|');
    if (start < 0) throw new Error('Nature call AI requires the Expo Podfile post_install hook');
    const at = text.indexOf('\n', start);
    const insert = `\n    # Nature call AI C++20\n    installer.pods_project.targets.each do |target|\n      target.build_configurations.each do |settings|\n        settings.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'gnu++20'\n        settings.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'\n      end\n    end\n`;
    fs.writeFileSync(file, text.slice(0, at) + insert + text.slice(at));
    return c;
  }]);
  return withDangerousMod(config, ['android', async c => {
    const file = path.join(c.modRequest.platformProjectRoot, 'app/proguard-rules.pro');
    const rules = fs.readFileSync(file, 'utf8');
    if (!rules.includes('# Nature call AI')) fs.appendFileSync(file, '\n# Nature call AI\n-keep class com.rnwhisper.** { *; }\n-keep class com.rnllama.** { *; }\n');
    return c;
  }]);
};
