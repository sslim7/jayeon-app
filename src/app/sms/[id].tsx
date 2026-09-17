import { router, useLocalSearchParams } from 'expo-router';
import { CampaignDetails } from '@/components/campaign-details';
import { SmsButton, SmsPage } from '@/components/sms-ui';
export default function CampaignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  /*
   * 닫기는 문자 상태를 바꾸지 않고 화면만 떠난다. 발송 중에도 보인다 — 러너(`smsDispatch`)는
   * 모듈 싱글턴이라 이 화면이 사라져도 발송 루프는 계속 돌고, 다시 열면 진행 상태가 이어 보인다.
   * 상세는 발송 이력 시트에서도 쓰이므로(→ campaign-history-sheet.tsx) 버튼은 이 라우트에만 둔다.
   *
   * **들어온 화면으로 돌아간다.** 이 화면은 문자 보내기와 예약 문자 보내기 두 곳에서 열리는데,
   * 늘 문자 보내기로 보내면 예약함에서 들어온 사람은 하던 일을 잃고 다시 찾아 들어가야 한다.
   * 돌아갈 기록이 없을 때(새로고침·링크로 바로 열기)만 문자 보내기로 보낸다.
   */
  return (
    <SmsPage
      title="발송 상세"
      actions={<SmsButton label="닫기" secondary onPress={() => (router.canGoBack() ? router.back() : router.replace('/sms/new'))} />}
    >
      <CampaignDetails id={id} />
    </SmsPage>
  );
}
