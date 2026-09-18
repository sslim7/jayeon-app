import { Stack } from 'expo-router';
/**
 * 통화분석의 화면 스택 — **목록과 보고서는 형제가 아니라 위아래다.**
 *
 * 🔴 **목록을 스택 아래에 살려 두는 것이 이 레이아웃의 존재 이유다.** 보고서를 `push` 로
 * 얹으면 목록 화면은 언마운트되지 않고 그대로 남는다 — 무한 스크롤로 쌓아 둔 페이지,
 * 검색어, 펼쳐 둔 줄이 전부 그 컴포넌트의 상태라, 목록을 `replace` 로 갈아 끼우거나
 * 시트 대신 같은 라우트에서 그리면 보고서를 닫는 순간 **30건을 다시 내려받고 맨 위로
 * 튕긴다.** 「보던 자리」는 서버가 아니라 이 스택이 지킨다.
 *
 * 헤더를 끄는 것은 앱 전체 규칙이다(→ `app/_layout.tsx`). 화면 제목과 뒤로 가는 길은
 * 각 화면이 `SmsPage` 로 직접 그린다 — 네이티브 헤더는 웹에서 모습이 갈린다.
 */
export default function CallsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      {/*
        ⚠️ **폴더 라우트의 이름은 파일 경로 그대로다** — `[id]` 가 아니라 `[id]/index` 다.
        원문 화면이 형제로 생기면서 `[id].tsx` 가 `[id]/` 폴더가 됐다. 이름을 옛것으로 두면
        expo-router 가 없는 화면의 옵션을 들고 있게 되고, 그 어긋남은 화면이 뜨는 데는
        지장이 없어 **한참 뒤에야 발견된다.**
      */}
      <Stack.Screen name="[id]/index" />
      <Stack.Screen name="[id]/transcript" />
    </Stack>
  );
}
