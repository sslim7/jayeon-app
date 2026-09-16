import { useLocalSearchParams } from 'expo-router';
import { CampaignDetails } from '@/components/campaign-details';
import { SmsPage } from '@/components/sms-ui';
export default function CampaignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SmsPage title="발송 상세"><CampaignDetails id={id} /></SmsPage>;
}
