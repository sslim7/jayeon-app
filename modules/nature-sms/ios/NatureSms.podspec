Pod::Spec.new do |s|
  s.name = 'NatureSms'
  s.version = '0.1.0'
  s.summary = 'Presents the iOS system message composer for one campaign recipient'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Nature'
  s.homepage = 'https://nature.redhead.kr'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # MessageUI 만 필요하다. 문자 발송에 Info.plist 권한 키는 없다 — 시스템 화면이 사용자 확인을 대신한다.
  s.frameworks = 'MessageUI'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
