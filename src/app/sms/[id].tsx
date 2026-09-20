import { router, useLocalSearchParams } from 'expo-router';
import { CampaignDetails } from '@/components/campaign-details';
import { SmsButton, SmsPage } from '@/components/sms-ui';
import { readSmsOrigin, smsExit, SMS_ORIGIN_PARAM } from '@/lib/sms-origin';
export default function CampaignScreen() {
  const params = useLocalSearchParams<{ id: string; from?: string }>();
  const id = params.id;
  /*
   * **어디서 왔는지 들고 다닌다.** 이 화면은 문자 보내기·예약 문자 보내기·발송 이력 세 곳에서
   * 열리는데, 돌아갈 곳을 스택 기록으로 추측하면 틀린다 — 문자 작성 화면은 여기로 올 때
   * `replace` 로 자기 자리를 내주므로, 뒤로 한 칸은 문자 보내기가 아니라 **그 밑에 깔려 있던
   * 아무 화면**이다. 실기기에서 「문자 보내기 → 발송 중단 → 닫기」가 「예약 문자 보내기」로
   * 나가면서 「2명의 예약을 취소했어요」를 보여 주던 길이 이것이다(→ `lib/sms-origin.ts`).
   */
  const origin = readSmsOrigin(params.from);
  /*
   * 닫기는 문자 상태를 바꾸지 않고 화면만 떠난다. 발송 중에도 보인다 — 러너(`smsDispatch`)는
   * 모듈 싱글턴이라 이 화면이 사라져도 발송 루프는 계속 돌고, 다시 열면 진행 상태가 이어 보인다.
   * 상세는 발송 이력 시트에서도 쓰이므로(→ campaign-history-sheet.tsx) 버튼은 이 라우트에만 둔다.
   *
   * 🔴 `back()` 이 아니라 **출처로 `replace`** 한다. 뒤로 한 칸은 위에 적은 이유로 믿을 수 없고,
   * `replace` 라야 이 상세가 기록에서 빠져 「닫았는데 뒤로 가면 또 나온다」가 생기지 않는다.
   */
  return (
    <SmsPage
      title="발송 상세"
      actions={<SmsButton label="닫기" secondary onPress={() => router.replace(smsExit(origin, 'detail').href)} />}
    >
      {/*
        다른 문자가 발송을 잡고 있을 때 그 화면으로 건너가는 길. 🔴 **라우트 화면에서만 준다** —
        발송 이력 시트 안에서는 모달 뒤로 이동해 아무 일도 없던 것처럼 보인다.
        `replace` 로 가는 이유는 같은 상세 화면이 겹겹이 쌓이지 않게 하기 위해서다.
        ⚠️ 건너갈 때 **출처를 같이 넘긴다** — 안 넘기면 거기서 닫았을 때 원래 흐름을 잃는다.
      */}
      <CampaignDetails
        id={id}
        onOpenCampaign={(other) => router.replace({ pathname: '/sms/[id]', params: { id: other, [SMS_ORIGIN_PARAM]: origin } })}
      />
    </SmsPage>
  );
}
