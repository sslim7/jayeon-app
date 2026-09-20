import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useScreenHeader } from '@/components/app-navigation';
import { CallTranscript } from '@/components/call-transcript';
import { Loading, Notice, SmsPage } from '@/components/sms-ui';
import { callApi } from '@/lib/call-api';
import type { CallRecord } from '@/types/calls';

/**
 * 통화 한 건의 **원문 화면.**
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **보고서 안의 접힌 구획이 아니라 형제 화면이다.**                               │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * 원문 한 건이 264조각·만 자 안팎이다. 보고서 맨 아래에 접어 두었을 때 생긴 문제가 둘이었다:
 * ①**원문만 보러 온 사람이 보고서를 지나쳐 내려와야 했고**(그 사람에게 분석은 오늘 읽을
 * 것이 아니다), ②펴는 순간 문서가 열 배로 길어져 보고서의 끝이 어디인지 사라졌다.
 * 화면을 가르면 둘 다 없어지고, 주소가 생겨 **원문만 따로 열어 둘 수** 있게 된다.
 *
 * 🔴 **여닫기도 글자 수 표시도 없다.** 그것들은 「펼까 말까」를 묻던 장치인데, 이 화면에
 * 들어온 것이 이미 그 답이다 — 들어오면 바로 대화가 보여야 한다.
 */
export default function CallTranscriptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  /**
   * 🔴 **원문은 상세 응답에만 있다**(§`internal/calls/model.go` 의 `listRecord` 가 목록에서
   * 뺀다). 목록이 들고 있던 값을 라우트 매개변수로 실어 보내 봐야 이 화면에 필요한 것이
   * 하나도 들어 있지 않다. 그래서 여기서 직접 받는다.
   */
  const [record, setRecord] = useState<CallRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void callApi.get(id)
      .then((found) => { if (live && found) setRecord(found); })
      .catch(() => { if (live) setError('통화 원문을 불러오지 못했습니다. 목록으로 돌아간 뒤 다시 열어 주세요.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id]);
  /**
   * 🔴 **폴링하지 않는다.** 원문은 받아쓰기가 끝난 뒤로는 바뀌지 않는다 — 다시 물어봐야
   * 같은 값이 오고, 상세 조회는 서명 URL 발급과 작업 문서 읽기를 함께 하는 비싼 호출이다.
   * 아직 받아쓰는 중인 통화는 애초에 여기로 오는 버튼이 서지 않는다(→ `app/calls/index.tsx`).
   */
  const title = record ? `${record.contact.name} 통화 원문` : '통화 원문';
  /**
   * 제목과 뒤로 가기는 앱 헤더가 그린다(→ `components/app-navigation.tsx`).
   * 🔴 **돌아갈 기록이 있으면 반드시 `back()` 이다.** `replace('/calls')` 로 통일하면 목록이
   * 새로 마운트되면서 무한 스크롤로 쌓아 둔 페이지·검색어·펼쳐 둔 줄이 전부 사라진다.
   * ⚠️ `useMemo` 는 멋이 아니다 — 매 렌더 새 객체를 넘기면 헤더가 매번 다시 올라간다.
   */
  useScreenHeader(useMemo(() => ({
    title,
    onBack: () => (router.canGoBack() ? router.back() : router.replace('/calls')),
  }), [title]));
  return (
    // `hideTitle` — 제목은 위 헤더가 이미 말한다. 본문에 또 세우면 같은 말이 두 줄로 선다.
    <SmsPage title={title} hideTitle>
      {error ? <Notice error message={error} /> : null}
      {loading ? <Loading /> : null}
      {/*
        ⚠️ 원문이 없는 통화로 **주소를 직접 열 수 있다**(북마크·새로고침·옛 링크). 목록의
        버튼은 서지 않지만 이 화면은 그 길을 막지 못하므로, 빈 화면 대신 없다고 말한다 —
        그 말을 하는 자리는 `CallTranscript` 안이다.
      */}
      {record ? <CallTranscript transcript={record.transcript} /> : null}
    </SmsPage>
  );
}
