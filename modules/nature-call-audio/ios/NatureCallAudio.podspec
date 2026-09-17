Pod::Spec.new do |s|
  s.name = 'NatureCallAudio'
  s.version = '0.1.0'
  s.summary = 'Private local recording decoding and streaming verification'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Nature'
  s.homepage = 'https://nature.redhead.kr'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'CryptoKit'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
