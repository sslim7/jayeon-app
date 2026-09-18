import { useCallback, useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useScreenHeader } from '@/components/app-navigation';
import { CallReport } from '@/components/call-report';
import { Loading, Notice, SmsPage } from '@/components/sms-ui';
import { CALL_POLL_MS, callApi } from '@/lib/call-api';
import { isActive } from '@/lib/call-progress';
import type { CallRecord } from '@/types/calls';

/**
 * 통화 한 건의 **보고서 화면.**
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **시트가 아니라 라우트다.** 목록 위에 덮이는 시트는 「지금 보던 목록을 잠깐 가린 것」   │
 * │ 으로 읽혀서, 만 자짜리 원문까지 담긴 긴 문서를 그 안에서 읽게 되지 않는다. 화면을 갈면   │
 * │ 뒤로 가기(버튼·안드로이드 하드웨어·브라우저)가 전부 「목록으로」 하나로 모인다.          │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 **통화 원문은 형제 화면이다**(→ `app/calls/[id]/transcript.tsx`). 보고서 안에 접어
 * 두던 시절에는 원문만 보러 온 사람이 보고서를 지나쳐 내려와야 했다.
 *
 * 🔴 **목록은 이 화면 아래에 살아 있다**(→ `app/calls/_layout.tsx`). 그래서 여기서 목록을
 * 되살릴 방법을 고민하지 않아도 되고, 반대로 **목록이 들고 있는 값을 여기서 고쳐 주지도
 * 못한다** — 다시 분석을 맡겼다면 그 사실은 목록이 포커스를 되찾을 때 스스로 확인한다
 * (→ `app/calls/index.tsx` 의 `visited`).
 */
export default function CallReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  /**
   * 화면에 그릴 한 건. **목록에서 넘겨받지 않고 여기서 직접 받는다.**
   *
   * 🔴 원문·분석·재생 주소·비용은 **상세 응답에만** 있다(§`internal/calls/model.go` 의
   * `listRecord` — 30건마다 수 MB 를 내려보내지 않으려고 목록에서 뺀다). 목록이 들고 있던
   * 값을 라우트 매개변수로 실어 보내 봐야 보고서에 필요한 것이 하나도 들어 있지 않다.
   */
  const [record, setRecord] = useState<CallRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** 도는 통화의 「3분 12초 경과」를 위한 시계. 아래 효과가 **진행 중일 때만** 돌린다. */
  const [now, setNow] = useState(() => Date.now());
  /**
   * 받은 한 건을 **지금 값 위에 얹는다.**
   *
   * 🔴 통째로 갈아 끼우면 안 된다. 이 화면에 답을 주는 길이 상세 조회 하나뿐이 아니다 —
   * `reanalyze` 가 돌려주는 것은 **목록용 요약**이라(§`internal/calls/audio.go` 의
   * `summaryRecord`) 원문·분석이 실려 오지 않는다. 그대로 대입하면 그 답이 닿는 순간 펼쳐 둔
   * 원문과 방금까지 읽던 보고서가 화면에서 사라진다.
   *
   * ⚠️ 지금 이 화면에서 `reanalyze` 를 부르는 자리는 없다(→ `components/call-reanalyze.tsx`).
   * 그래도 얹기를 남겨 두는 이유는, 폴링이 가져오는 상세 응답은 모든 칸을 실어 와 **얹으나
   * 갈아 끼우나 결과가 같기** 때문이다 — 안전한 쪽이 공짜인데 굳이 위험한 쪽으로 바꾸지 않는다.
   */
  const merge = useCallback((item: CallRecord) => setRecord((prev) => prev ? { ...prev, ...item } : item), []);
  useEffect(() => {
    let live = true;
    void callApi.get(id)
      .then((found) => { if (live && found) setRecord(found); })
      .catch(() => { if (live) setError('통화 내용을 불러오지 못했습니다. 목록으로 돌아간 뒤 다시 열어 주세요.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id]);
  /**
   * 진행 중인 통화만 다시 묻는다.
   *
   * 🔴 **끝난 통화에는 타이머를 걸지 않는다.** 보고서를 열어 둔 채 자리를 비우는 것은 흔한
   * 일이라, 조건 없이 돌리면 아무 일도 일어나지 않는 통화 하나가 밤새 서버를 두드린다.
   * 🔴 같은 통화를 두 곳에서 묻지 않는다 — 이 화면이 떠 있는 동안 목록은 포커스를 잃어
   * 폴링을 멈춘다(→ `app/calls/index.tsx`).
   */
  const active = !!record && isActive(record.status);
  useEffect(() => {
    if (!active) return;
    let live = true;
    let polling = false;
    const timer = setInterval(() => {
      // 앞 요청이 아직 안 왔으면 거른다. 느린 회선에서 요청이 겹쳐 쌓이는 것을 막는다.
      if (polling) return;
      polling = true;
      void callApi.get(id)
        .then((found) => { if (live && found) merge(found); })
        .catch(() => {})
        .finally(() => { polling = false; });
    }, CALL_POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [active, id, merge]);
  // 경과 시간만 1초마다 다시 그린다. 폴링 타이머와 분리해 요청이 늘지 않게 한다.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  /**
   * 문서 제목은 **「이름 + 상담 분석」**이다. 아직 받아 오는 중이면 이름을 모르므로 그 자리를
   * 비운다 — 「불러오는 중」 같은 말을 제목에 넣으면 그것이 **웹 탭 제목과 뒤로 가기 기록에
   * 그대로 남는다**(`SmsPage` 가 이 값을 `Stack.Screen` 의 title 로도 쓴다).
   */
  const title = record ? `${record.contact.name} 상담 분석` : '상담 분석';
  /**
   * 🔴 **제목과 뒤로 가기는 본문이 아니라 앱 헤더에 선다**(→ `components/app-navigation.tsx`).
   *
   * 앱 헤더는 화면 트리 **밖**에 있어서, 아무것도 하지 않으면 이 화면 위에도 「☰ + 문자
   * 보내기」가 그대로 남는다 — 경로(`/calls/<id>`)가 메뉴 항목과 맞지 않아 **메뉴의 첫
   * 항목 이름이 그냥 찍히기 때문**이다. 그 머리를 이고 있으면 사용자는 여기가 어느 화면인지,
   * 나가는 길이 어딘지 알 수 없다.
   *
   * 🔴 **돌아갈 기록이 있으면 반드시 `back()` 이다.** `replace('/calls')` 로 통일하면
   * 목록 화면이 새로 마운트되면서 무한 스크롤로 쌓아 둔 페이지·검색어·펼쳐 둔 줄이
   * 전부 사라진다 — 30건쯤 내려간 뒤 보고서를 열었다 닫으면 맨 위로 튕기는 그 증상이다.
   * 기록이 없는 경우(링크로 바로 열기·새로고침)에만 목록을 새로 연다.
   *
   * ⚠️ `useMemo` 는 멋이 아니다 — 매 렌더 새 객체를 넘기면 헤더가 매번 다시 올라간다.
   */
  useScreenHeader(useMemo(() => ({
    title,
    onBack: () => (router.canGoBack() ? router.back() : router.replace('/calls')),
  }), [title]));
  return (
    /*
     * `hideTitle` — 제목은 위 헤더가 이미 말한다. 본문에 한 번 더 세우면 같은 말이 두 줄로
     * 서고, 그만큼 요약이 접힌 화면 아래로 밀린다.
     */
    <SmsPage title={title} hideTitle>
      {error ? <Notice error message={error} /> : null}
      {/* 아직 아무것도 못 받았을 때만 이 자리에서 기다린다. 받은 뒤의 로딩은 보고서가 안에서 말한다. */}
      {!record ? loading ? <Loading /> : null : <CallReport record={record} loading={loading} now={now} onTranscript={() => router.push({ pathname: '/calls/[id]/transcript', params: { id } })} />}
    </SmsPage>
  );
}
