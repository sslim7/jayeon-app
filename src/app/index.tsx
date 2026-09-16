import { Redirect } from 'expo-router';
import { ENV } from '@/config/env';

/** 인증을 마치면 별도 홈 없이 바로 문자 보내기를 연다. */
export default function IndexScreen() {
  return <Redirect href={ENV.webShell ? '/shell' : '/sms/new'} />;
}
