import { router, useLocalSearchParams } from 'expo-router';
import { CampaignDetails } from '@/components/campaign-details';
import { SmsButton, SmsPage } from '@/components/sms-ui';
export default function CampaignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  /*
   * 닫기는 캠페인 상태를 바꾸지 않고 화면만 떠난다. 발송 중에도 보인다 — 러너(`smsDispatch`)는
   * 모듈 싱글턴이라 이 화면이 사라져도 발송 루프는 계속 돌고, 다시 열면 진행 상태가 이어 보인다.
   * 상세는 발송 이력 시트에서도 쓰이므로(→ campaign-history-sheet.tsx) 버튼은 이 라우트에만 둔다.
   */
  return (
    <SmsPage
      title="발송 상세"
      actions={<SmsButton label="닫기" secondary onPress={() => router.replace('/sms/new')} />}
    >
      <CampaignDetails id={id} />
    </SmsPage>
  );
}
