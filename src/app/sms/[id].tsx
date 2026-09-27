import { router, useLocalSearchParams } from 'expo-router';
import { CampaignDetails } from '@/components/campaign-details';
import { SmsButton, SmsPage } from '@/components/sms-ui';
import { readSmsOnlyIds, readSmsOrigin, smsExit, SMS_ONLY_PARAM, SMS_ORIGIN_PARAM } from '@/lib/sms-origin';
export default function CampaignScreen() {
  const params = useLocalSearchParams<{ id: string; from?: string; only?: string }>();
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
   * **누구에게만 보낼 것인가.** 예약 문자 보내기에서 체크한 사람을 이 주소에 실어 온다.
   *
   * 🔴 **주소를 그대로 믿지 않는다.** 이 화면은 실제로 문자가 나가는 자리라, 주소 한 줄이
   * 엉뚱한 사람을 발송 대상으로 만들면 안 된다. `readSmsOnlyIds` 가 모양(쉼표로 이은 id)을
   * 보고 아니면 **없는 것으로** 떨어뜨린다 — 출처를 읽을 때와 같은 태도다.
   * ⚠️ 「없는 것」은 전원이므로, 좁혀진 인원수는 `CampaignDetails` 가 화면에 적는다.
   * ⚠️ `useLocalSearchParams` 로만 받는다. `window`·`URLSearchParams` 같은 웹 전용 API 를
   * 쓰면 이 번들이 그대로 들어가는 **안드로이드 앱에서 터진다.**
   */
  const onlyRecipientIds = readSmsOnlyIds(params[SMS_ONLY_PARAM]);
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
        🔴 반대로 **「이 사람들만」은 들고 가지 않는다.** 그 id 는 이 캠페인 안의 줄 번호라
        다른 캠페인에서는 아무도 가리키지 못한다. 넘기면 저쪽 화면이 「0명」으로 굳는다.
      */}
      <CampaignDetails
        id={id}
        onlyRecipientIds={onlyRecipientIds}
        onOpenCampaign={(other) => router.replace({ pathname: '/sms/[id]', params: { id: other, [SMS_ORIGIN_PARAM]: origin } })}
      />
    </SmsPage>
  );
}
