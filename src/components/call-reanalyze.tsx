import { useState } from 'react';
import { Text, View } from 'react-native';
import { Loading, Notice, SmsButton, s } from '@/components/sms-ui';
import { callApi } from '@/lib/call-api';
import { isActive } from '@/lib/call-progress';
import type { CallRecord } from '@/types/calls';

/**
 * 「서버 AI로 다시 분석」 한 벌.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔧 **지금 이 컴포넌트를 부르는 화면이 없다.** 보고서 머리말에 서 있던 것을 사용자가     │
 * │ 걷어 달라고 해서 뺐고, 기능은 「나중에 어드민을 만들면 거기서 보자」로 미뤄져 있다.      │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * 🔴 **그래서 지우지 않고 파일로 옮겨 두었다.** 이 흐름에서 값이 나가는 자리는 코드 몇 줄이
 * 아니라 **그 몇 줄이 왜 그 모양인지**다(확인 한 단계, 보낸 뒤 버튼 치우기, 받은 답 얹기 —
 * 아래 주석들). 지웠다가 어드민에서 다시 쓰면 그 이유를 전부 새로 발견해야 하고, 그동안
 * 요금이 두 배로 나가는 길이 한 번 더 열린다.
 *
 * 붙일 때 필요한 것은 둘뿐이다: 상세를 이미 받은 `record` 와, 받은 답을 지금 값 **위에
 * 얹을** `onUpdated`.
 */

/**
 * **다시 분석할 수 있는 통화인가.**
 *
 * 조건은 「서버에 다시 분석할 원문이 있다」 하나뿐이다 — 상태는 보지 않는다. 폰에서
 * 받아쓰기·요약까지 끝내고 결과만 올린 옛 통화는 `COMPLETED` 로 남아 있지만, 그 요약을
 * 만든 것은 폰의 작은 모델이라 서버 모델로 다시 돌릴 값어치가 있다.
 *
 * 🔴 원문이 없으면 세우지 않는다. 서버가 409(`CALL_NO_TRANSCRIPT`)로 거절할 버튼이다.
 * 🔴 이미 도는 통화에도 세우지 않는다. 서버가 409(`CALL_NOT_ANALYZABLE`)로 거절하고,
 * 무엇보다 **지금 돌고 있는 분석을 사용자가 처음부터 다시 돌리게 된다.**
 * ⚠️ 상세를 아직 못 받은 동안(`loading`)에도 세우지 않는다. 그때는 원문이 있는지 모른다 —
 * 목록 응답에는 원문이 실리지 않기 때문이다.
 */
export function callRerunnable(record: CallRecord, loading: boolean): boolean {
  return !loading && !isActive(record.status) && !!record.transcript?.text.trim();
}

export function CallReanalyze({ record, loading, onUpdated }: { record: CallRecord; loading: boolean; onUpdated: (record: CallRecord) => void }) {
  /**
   * 단계. `idle` → `confirm` → `running`.
   *
   * 🔴 **한 번 누르면 바로 도는 버튼이 아니다.** 이 버튼은 되돌릴 수 없이 기존 분석을
   * 덮어쓰고 분석 요금을 한 번 더 쓴다. 그래서 확인을 한 단계 받는다.
   * 🔴 `confirm()` 같은 브라우저 대화상자는 쓰지 않는다 — 이 앱은 WebView 안에서 돌고,
   * 그 안에서 모달이 뜨면 화면이 그대로 멈춘다. 확인은 **화면 안의 줄**로 받는다.
   */
  const [again, setAgain] = useState<'idle' | 'confirm' | 'running'>('idle');
  const [againError, setAgainError] = useState('');
  /**
   * 서버에 다시 분석을 맡긴다.
   *
   * 🔴 받은 답을 **위로 올려 보낸다**(`onUpdated`). 답은 목록용 요약이라 원문·분석이 실려
   * 오지 않으므로, 부르는 쪽이 지금 값 **위에 얹어야 한다**(→ `app/calls/[id].tsx` 의 `merge`).
   * 통째로 갈아 끼우면 펼쳐 둔 원문이 그 자리에서 사라진다.
   */
  async function rerun() {
    if (again === 'running') return;
    setAgain('running');
    setAgainError('');
    try {
      onUpdated(await callApi.reanalyze(record.call_id));
      setAgain('idle');
    } catch {
      setAgainError('다시 분석을 시작하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
      setAgain('idle');
    }
  }
  if (!callRerunnable(record, loading)) return againError ? <Notice error message={againError} /> : null;
  return <>
    {/*
      **「분석 다시 시도」와 다른 일이다.**

      그쪽은 실패한 통화를 원래 있어야 할 자리로 되돌리는 복구다(→ `app/calls/index.tsx`).
      이쪽은 **이미 결과가 있는 통화를 더 나은 모델로 다시 돌리는** 일이라, 멀쩡한 분석을
      지우고 요금을 새로 쓴다. 말이 같으면 사용자는 둘을 같은 버튼으로 읽는다.
    */}
    <View style={s.row}>
      {again === 'idle' ? <SmsButton secondary label="서버 AI로 다시 분석" accessibilityLabel={`${record.contact.name} 통화를 서버 AI로 다시 분석`} onPress={() => setAgain('confirm')} /> : null}
      {again === 'confirm' ? <>
        <Text style={s.meta}>지금 있는 분석을 덮어씁니다. 되돌릴 수 없고 분석 비용이 한 번 더 듭니다.</Text>
        <SmsButton label="덮어쓰고 다시 분석" onPress={() => void rerun()} />
        <SmsButton secondary label="취소" onPress={() => setAgain('idle')} />
      </> : null}
      {/*
        🔴 보낸 뒤에는 **버튼 자체를 치운다.** 비활성 버튼으로 두면 연타한 두 번째 누름이
        첫 응답보다 먼저 닿을 수 있고, 그러면 서버가 방금 시작한 분석을 처음부터 다시 돌린다
        (= 요금이 두 배다). 응답이 오면 상태가 `ANALYZING` 이 되어 위 `callRerunnable` 이
        이 줄을 통째로 걷는다.
      */}
      {again === 'running' ? <><Loading /><Text accessibilityLiveRegion="polite" style={s.meta}>다시 분석을 맡기는 중입니다.</Text></> : null}
    </View>
    {againError ? <Notice error message={againError} /> : null}
  </>;
}
