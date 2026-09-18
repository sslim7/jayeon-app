import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useScreenHeader } from '@/components/app-navigation';
import { ButtonRow, Loading, Notice, SmsButton, SmsPage, s } from '@/components/sms-ui';
import { colors, fonts, radii, spacing, text } from '@/constants/theme';
import {
  ACCESS_TOKEN_TTL_MS,
  revokedText,
  sessionApi,
  sessionClockLabel,
  sessionDayLabel,
  sessionErrorText,
  type UserSession,
} from '@/lib/session-api';
import { useUserStore } from '@/store/user-store';

/**
 * 로그인 기기 관리 — **잃어버린 순간에 여는 화면.**
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 **이 화면은 당황한 사람이 쓴다.** 상담 통화 녹음과 고객 정보가 든 폰을 택시에 두고   │
 * │ 내린 그 순간, 예전에는 **비밀번호 변경(= 모든 기기 로그아웃)** 말고 할 수 있는 일이     │
 * │ 없었다. 여기가 「그 기기만 끊기」다.                                              │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * 그래서 이 화면의 모든 판단은 하나로 모인다 — **모르는 것을 아는 척하지 않는다.**
 * 기기 이름은 추정이고(같은 기종 두 대는 글자가 같다), 마지막 접속은 날짜까지만 맞고,
 * 끊은 뒤의 시각은 정확한 시각이 아니라 상한이다. 그 성격은 전부
 * `lib/session-api.ts` 의 필드 주석에 적혀 있고, 여기서는 **그대로 읽히게 적는 일**만 한다.
 * 한 칸이라도 단정으로 올려 적으면 사용자는 **끊기지 않은 기기를 끊겼다고 믿고 닫는다.**
 *
 * 상호작용은 이 저장소에 이미 있는 것을 그대로 쓴다 — 한 줄 목록 + 누른 자리에서 펼치기
 * (→ `app/calls/index.tsx` 의 간단뷰, `components/campaign-history-sheet.tsx`), 확인은
 * 화면 안의 두 단계(→ `components/call-reanalyze.tsx`).
 * 🔴 **`confirm()`·`alert()` 를 쓰지 않는다.** 이 앱은 WebView 안에서도 돌고, 그 안에서
 * 브라우저 모달이 뜨면 화면이 그대로 멈춘다.
 */
export default function DevicesScreen() {
  /**
   * 제목과 뒤로 가기는 앱 헤더에 선다(→ `components/app-navigation.tsx`). 설정과 같은 통로다.
   *
   * 돌아갈 기록이 없으면(주소로 바로 열기·새로고침) 설정으로 보낸다 — 이 화면은 설정 안의
   * 한 줄에서만 열리므로, 기록이 없을 때 첫 화면으로 보내면 **들어온 자리를 잃는다.**
   * ⚠️ `useMemo` 는 멋이 아니다. 매 렌더 새 객체를 넘기면 헤더가 매번 다시 올라간다.
   */
  useScreenHeader(useMemo(() => ({
    title: '로그인 기기 관리',
    onBack: () => (router.canGoBack() ? router.back() : router.replace('/settings')),
  }), []));

  const signOut = useUserStore((state) => state.signOut);
  const [rows, setRows] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** 펼쳐 둔 줄. 한 번에 하나만 편다 — 여러 줄이 펼쳐지면 목록으로 훑는 이유가 사라진다. */
  const [openRow, setOpenRow] = useState<string | null>(null);
  /** 확인을 기다리는 줄. 🔴 **누르기 전에 받는다** — 끊기는 되돌릴 수 없다. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** 지금 서버에 끊기를 맡긴 줄. 이 값이 있는 동안 모든 줄의 버튼을 잠근다. */
  const [working, setWorking] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /**
   * 지금 시각. **렌더마다 다시 읽는다.**
   *
   * 타이머를 두지 않는 이유는 이 화면에 1초마다 바뀌는 값이 없기 때문이다 — 날짜 표기는
   * 하루에 한 번 바뀌고, 끊긴 기기의 한계 시각은 「늦어도」라서 초를 다투지 않는다.
   * 다시 그릴 때마다 이 값이 새로 읽히므로 **그 순간의 화면은 언제나 참**이고, 열어 둔 채
   * 시간이 흐른 화면만 조금 낡는다(그 낡음은 목록을 다시 불러오면 사라진다).
   */
  const now = new Date();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const items = await sessionApi.list();
      if (!alive.current) return;
      setRows(items);
    } catch (e) {
      if (!alive.current) return;
      /*
       * 🔴 **실패했을 때 목록을 비우지 않는다.** 빈 목록은 「로그인된 기기가 없다」로 읽히는데,
       * 그건 지금 이 화면이 떠 있는 것만으로도 거짓이다. 받아 둔 줄이 있으면 그대로 두고
       * 위에 실패를 적는다 — 그래야 사용자가 무엇이 낡았는지 안다.
       */
      setError(sessionErrorText(e, '기기 목록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.'));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);
  // 다음 틱으로 미룬다. 효과 안에서 곧바로 상태를 바꾸면 렌더 중 갱신으로 잡힌다(react-compiler 규칙).
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  /**
   * 기기 하나를 끊는다. 확인을 받은 **뒤에만** 불린다.
   *
   * 🔴 **로그아웃 여부는 응답의 `current` 로 가른다.** 줄에 찍힌 `current` 가 아니다 —
   * 목록은 낡을 수 있고(다른 기기에서 비밀번호를 바꿨다든지), 그 사이에 이 기기의 세션이
   * 바뀌었다면 화면이 아는 것보다 **서버가 방금 본 것**이 맞다. 여기서 틀리면 지금 이
   * 기기를 끊어 놓고 로그아웃하지 않아, 남은 액세스 토큰으로 **15분을 더 돌아다닌다.**
   */
  const revoke = useCallback(async (session: UserSession) => {
    if (working) return;
    setWorking(session.sessionId);
    setActionError('');
    try {
      const result = await sessionApi.revoke(session.sessionId);
      if (result.current) {
        /*
         * 지금 이 기기다. **저장된 토큰을 버리고 로그인 화면으로 간다** — 기존 로그아웃
         * 길을 그대로 쓴다(→ `store/user-store.ts` 의 `signOut`). 단계가 `anonymous` 로
         * 내려가면 루트 레이아웃이 스택을 로그인 화면으로 갈아 끼우므로(→ `app/_layout.tsx`)
         * 여기서 라우터를 따로 건드리지 않는다.
         */
        await signOut();
        return;
      }
      if (!alive.current) return;
      /*
       * 받은 값을 그 줄에 **얹는다.** 목록을 다시 받지 않는 이유는 펼쳐 둔 줄과 스크롤을
       * 지키기 위해서다. 🔴 시각은 서버가 준 것을 그대로 쓴다 — 여기서 「지금 + 15분」으로
       * 다시 계산하면 서버가 수명을 바꾸는 날 화면만 조용히 틀린 시각을 말한다.
       */
      setRows((prev) => prev.map((row) => row.sessionId === session.sessionId
        ? { ...row, revokedAt: result.revokedAt || row.revokedAt, accessibleUntilAtMost: result.accessibleUntilAtMost }
        : row));
      setConfirming(null);
    } catch (e) {
      if (!alive.current) return;
      setActionError(sessionErrorText(e, '이 기기를 끊지 못했어요. 연결을 확인하고 다시 시도해 주세요.'));
    } finally {
      if (alive.current) setWorking(null);
    }
  }, [signOut, working]);

  /**
   * 🔴 **「지금 이 기기」가 목록에 없을 수 있다.** 세션 장치가 생기기 전에 로그인해 둔 기기의
   * 액세스 토큰에는 세션 id 가 없어서, 서버가 어느 줄도 「이 기기」로 가릴 수 없다
   * (§`jayeon-was/internal/auth/session_handler.go` 의 `toSessionDTO`). 그 상태를 말하지 않고
   * 두면 사용자는 **자기 기기를 낯선 기기로 알고 끊는다.**
   */
  const hasCurrent = rows.some((row) => row.current);
  const live = rows.filter((row) => !row.revokedAt);

  return (
    <SmsPage title="로그인 기기 관리" hideTitle>
      {/*
        이 화면이 무엇을 할 수 있고 무엇을 할 수 없는지 한 덩이로 먼저 말한다. 🔴 **전부 끊는
        길(비밀번호 변경)을 함께 적는다** — 목록에서 낯선 기기를 못 찾았거나 비밀번호까지
        샜다고 느낀 사람에게는 그쪽이 답인데, 이 화면만 보면 그 길이 있는 줄 모른다.
      */}
      <Notice message="낯선 기기가 보이면 그 기기만 끊을 수 있어요. 비밀번호를 바꾸면 모든 기기가 한꺼번에 끊겨요." />

      {loading && !rows.length ? <Loading /> : null}
      {error ? <>
        <Notice error message={error} />
        <SmsButton secondary label="다시 불러오기" disabled={loading} onPress={() => void load()} />
      </> : null}

      {!loading && !error && !rows.length ? <>
        {/*
          🔴 **「기기가 없다」고 단정하지 않는다.** 이 화면이 떠 있다는 것 자체가 로그인된
          기기가 하나는 있다는 뜻이라, 빈 목록은 「없다」가 아니라 **「이 계정의 기기를 아직
          세션으로 세어 두지 않았다」**는 뜻이다(옛 방식으로 로그인해 둔 경우). 사용자가 할 수
          있는 일을 함께 적는다 — 다시 로그인하면 그때부터 줄이 생긴다.
        */}
        <Notice message="아직 목록에 올라온 기기가 없어요. 예전에 로그인해 둔 기기는 여기 나오지 않아요 — 한 번 로그아웃했다가 다시 로그인하면 그때부터 이 목록에 남아요." />
      </> : null}

      {rows.length ? <>
        {/*
          🔴 **마지막 접속의 정확도를 먼저 말한다.** 서버가 쓰기를 줄이려고 하루 한 번만
          기록해서 시:분은 뒤처져 있다(→ `lib/session-api.ts`). 이 한 줄이 없으면 사용자는
          「오늘」을 「방금」으로 읽고, 그 차이로 어느 줄이 잃어버린 기기인지를 잘못 고른다.
        */}
        <Text style={s.meta}>기기 {rows.length}대 · 마지막 접속은 날짜까지만 정확해요.</Text>
        {!hasCurrent ? <Notice message="지금 보고 있는 이 기기는 아직 목록에 없어요. 세션 기록이 생기기 전에 로그인해 둬서 그래요." /> : null}
        {/*
          한 줄짜리 목록은 **한 묶음으로 싼다.** 페이지 바탕(`s.page`)이 자식 사이를 16 벌리는데,
          줄이 그 직계 자식이면 그 16 이 구분선과 글자 사이에만 얹혀 위아래가 어긋난다
          (→ `app/calls/index.tsx` 의 `briefList` 주석).
        */}
        <View style={styles.list}>
          {rows.map((row, index) => <DeviceRow
            key={row.sessionId}
            session={row}
            first={index === 0}
            now={now}
            open={openRow === row.sessionId}
            onToggle={() => setOpenRow(openRow === row.sessionId ? null : row.sessionId)}
            confirming={confirming === row.sessionId}
            onAsk={() => { setConfirming(row.sessionId); setActionError(''); }}
            onCancel={() => setConfirming(null)}
            onRevoke={() => void revoke(row)}
            working={working === row.sessionId}
            locked={working !== null}
            error={actionError && confirming === row.sessionId ? actionError : ''}
          />)}
        </View>
        {/*
          ⚠️ **한 대뿐일 때 허전하지 않게.** 목록이 한 줄이면 화면이 「덜 불러온 것」처럼 보인다.
          그 한 줄이 곧 답(「낯선 기기는 없다」)이라는 것을 말해 주는 자리다.
        */}
        {live.length === 1 && hasCurrent ? <Notice message="지금은 이 기기에서만 로그인되어 있어요. 낯선 기기는 없어요." /> : null}
        <SmsButton secondary label="목록 새로 고치기" disabled={loading} onPress={() => void load()} />
      </> : null}
    </SmsPage>
  );
}

/**
 * 기기 한 줄.
 *
 * 한 줄에 세우는 것은 **이름 · 「이 기기」 · 마지막 접속 · 끊기**뿐이다. 접속 기록과
 * User-Agent 원문은 누른 자리에서 편다 — 모든 줄을 펴 두면 기기 두세 대로 화면이 차서
 * 「어느 줄이 그 폰인가」를 훑을 수 없다.
 *
 * ⚠️ **여닫는 `Pressable` 안에 버튼을 넣지 않는다.** react-native-web 에서는 이벤트가 위로
 * 올라가 「끊기」를 누른 것이 줄 여닫기까지 함께 일으킨다 — 확인 문구가 뜨는 동시에 줄이
 * 펼쳐지거나 접혀서, 누른 사람은 자기가 무엇을 눌렀는지 알 수 없게 된다. 그래서 여닫는
 * 자리와 버튼은 **형제**로 둔다.
 */
function DeviceRow({ session, first, now, open, onToggle, confirming, onAsk, onCancel, onRevoke, working, locked, error }: {
  session: UserSession;
  first: boolean;
  now: Date;
  open: boolean;
  onToggle: () => void;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRevoke: () => void;
  working: boolean;
  locked: boolean;
  error: string;
}) {
  const revoked = !!session.revokedAt;
  const seen = sessionDayLabel(session.lastSeenAt, now);
  /*
   * 🔴 **「이 기기」와 남의 기기는 하는 일이 다르다.** 남의 기기를 끊는 것은 그 기기를
   * 내보내는 일이고, 이 기기를 끊는 것은 **내가 나가는 일**이다. 같은 말(「끊기」)로 적으면
   * 잃어버린 폰을 끊으려던 사람이 자기 화면을 닫는다. 이름도 확인 문구도 갈라 둔다.
   */
  const actionLabel = session.current ? '로그아웃' : '끊기';
  return (
    <View style={[styles.row, first && styles.rowFirst, session.current && styles.rowCurrent]}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          // aria-* 로도 적는다. react-native-web 은 RN 의 `expanded` 상태를 옮기지 않는다(§sms-ui `Choice`).
          aria-expanded={open}
          accessibilityLabel={`${session.deviceLabel}${session.current ? ' 이 기기' : ''} 마지막 접속 ${seen || '알 수 없음'} ${open ? '접기' : '펼치기'}`}
          onPress={onToggle}
          style={styles.headMain}
        >
          <View style={styles.headText}>
            <View style={styles.line}>
              {/* 이름만 줄어든다 — 「이 기기」 배지가 줄면 이 줄의 가장 중요한 표시가 사라진다. */}
              <Text style={[s.body, styles.name]} numberOfLines={1}>{session.deviceLabel}</Text>
              {/*
                🔴 **「이 기기」는 이름이 아니라 배지다.** 같은 기종 두 대는 `deviceLabel` 이
                글자 그대로 같아서, 이 표시와 마지막 접속 말고는 두 줄을 가릴 방법이 없다.
              */}
              {session.current ? <Text style={styles.badge}>이 기기</Text> : null}
            </View>
            {/* 🔴 「방금 전」·「5분 전」으로 적지 않는다 — 서버 기록이 날짜 단위라 거짓이 된다. */}
            <Text style={s.meta}>마지막 접속 {seen || '알 수 없음'}</Text>
          </View>
          {/*
            ⚠️ 화살표는 **두 줄 전체의 오른쪽 가운데**다. 둘째 줄에만 붙이면 날짜 옆에 떠서
            「날짜를 펼치는 표시」처럼 보이고, 줄 전체가 눌린다는 사실이 가려진다.
          */}
          <Chevron up={open} />
        </Pressable>
      </View>
      {/*
        끊긴 줄에는 버튼을 세우지 않는다. 대신 **언제까지 쓸 수 있는지**를 적는다 — 「끊었는데
        진짜 끊긴 건가」가 이 화면이 답해야 하는 두 질문 중 하나다.
        🔴 「늦어도」를 뺄 수 없다. 실제로는 더 일찍 끊길 수 있는 **상한**이라, 그 시각에 정확히
        끊긴다고 읽히면 사용자는 그때까지 아무것도 하지 않는다.
      */}
      {revoked ? <Text style={[s.meta, styles.revoked]}>{revokedText(session, now)}</Text> : null}
      {/*
        🔴 확인을 받는 동안에는 이 버튼을 **치운다**(비활성으로 두지 않는다). 같은 이름의
        버튼이 위아래로 둘이면 사용자는 어느 쪽이 진짜인지 고르느라 한 번 더 멈추고,
        회색으로 죽은 버튼은 「고장」으로도 읽힌다(→ `components/call-reanalyze.tsx` 의 같은 판단).
      */}
      {!revoked && !confirming ? <View style={styles.action}>
        <SmsButton
          secondary
          danger
          label={actionLabel}
          accessibilityLabel={`${session.deviceLabel} ${actionLabel}`}
          disabled={locked}
          onPress={onAsk}
        />
      </View> : null}
      {confirming && !revoked ? <View style={styles.confirm}>
        {/*
          🔴 **확인 문구에 「언제까지 쓸 수 있는지」가 들어간다.** 잃어버린 사람이 알고 싶은
          것이 그것이다. 아직 끊기 전이라 서버 값이 없으므로 **지금 끊었을 때의 상한**을
          계산해 적고(→ `lib/session-api.ts` 의 `ACCESS_TOKEN_TTL_MS`), 끊고 나면 서버가 준
          시각으로 바뀐다. 「지금 끊으면」이라는 조건을 앞에 두는 것이 그 차이다.

          「이 기기」 쪽에는 그 시각을 적지 않는다 — 누르는 즉시 토큰을 버려 **바로** 끝나기
          때문이다. 남의 기기의 상한을 여기 적으면 「내 화면도 15분은 남는다」로 읽힌다.
        */}
        <Text style={s.meta}>
          {session.current
            ? '이 기기에서 로그아웃해요. 보던 화면이 닫히고 다시 로그인해야 열려요.'
            : `지금 끊으면 이 기기는 다시 로그인해야 열려요. 되돌릴 수 없고, 이미 열려 있던 화면은 늦어도 ${sessionClockLabel(new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(), now)}까지 남아 있을 수 있어요.`}
        </Text>
        {error ? <Notice error message={error} /> : null}
        {/*
          보내는 동안에는 두 버튼을 잠근다(`locked`). 🔴 **끊기는 멱등이라** 두 번 닿아도
          서버는 처음 끊은 시각을 그대로 주지만, 잠그지 않으면 사용자는 응답이 오기 전에
          「취소」를 눌러 **끊긴 기기를 안 끊었다고 믿는다.**
        */}
        <ButtonRow>
          <SmsButton fill label={working ? '끊는 중' : `${actionLabel} 확인`} accessibilityLabel={`${session.deviceLabel} ${actionLabel} 확인`} disabled={locked} onPress={onRevoke} />
          <SmsButton fill secondary label="취소" disabled={locked} onPress={onCancel} />
        </ButtonRow>
      </View> : null}
      {open ? <View style={styles.detail}>
        <Text style={styles.detailTitle}>접속 기록</Text>
        {/*
          ⚠️ **15분마다 찍힌 목록이 아니다.** 서버가 하루 한 번만 기록해서 열 건이면 사실상
          「최근 열흘 중 쓴 날」이다. 그 성격을 적어 두지 않으면 사용자는 기록이 드문 것을
          「이 기기는 거의 안 쓰였다」로 읽는다.
        */}
        <Text style={s.meta}>쓴 날만 하루에 한 번 남아요. 같은 날 여러 번 쓴 것은 한 줄이에요.</Text>
        {session.recentAccesses.length ? session.recentAccesses.map((access, index) => {
          const day = sessionDayLabel(access.at, now);
          // 그때의 기기 표시가 지금과 다르면 함께 적는다(앱을 새로 깔거나 브라우저를 바꾼 흔적이다).
          const changed = access.deviceLabel && access.deviceLabel !== session.deviceLabel ? ` · ${access.deviceLabel}` : '';
          return <Text key={`${access.at}-${index}`} style={s.meta}>· {day || '알 수 없음'}{changed}</Text>;
        }) : <Text style={s.meta}>· 남은 기록이 없어요.</Text>}
        <Text style={styles.detailTitle}>로그인한 날</Text>
        <Text style={s.meta}>{sessionDayLabel(session.createdAt, now) || '알 수 없음'}</Text>
        {/*
          🔴 **원문을 보여 준다.** 위의 기기 이름은 User-Agent 로 **추정한** 값이라 같은 기종
          두 대가 한 글자도 다르지 않다 — 그때 둘을 가를 수 있는 것이 이 원문뿐이다(앱 버전,
          OS 버전, 브라우저 종류가 여기 남는다). 추정이 아예 빗나가 「알 수 없는 기기」로 온
          줄에서는 더더욱 이것 말고 볼 것이 없다.
          ⚠️ **맨 아래에 둔다.** 길이가 수백 자라 위에 두면 끊기 버튼이 화면 밖으로 밀린다.
        */}
        <Text style={styles.detailTitle}>이 이름의 근거</Text>
        <Text selectable style={styles.agent}>{session.userAgent || '기기가 보낸 정보가 없어요.'}</Text>
      </View> : null}
    </View>
  );
}

/**
 * 접힘/펼침을 가리키는 홑화살표. 통화 목록의 것과 **같은 그림·같은 규칙**이다
 * (→ `app/calls/index.tsx`) — 같은 상호작용에 다른 표시를 쓰면 같은 앱으로 읽히지 않는다.
 *
 * 🔴 이모지(⌄)를 쓰지 않는다. 기기마다 글리프가 달라 방향을 말해야 할 표시가 방향을 못 말한다.
 * 🔴 낭독기에서는 숨긴다 — 여닫힘은 위의 `expanded` 상태와 접근성 이름이 이미 말한다.
 */
function Chevron({ up }: { up: boolean }) {
  return <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.mid} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden={true}>
    <Path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
  </Svg>;
}

const styles = StyleSheet.create({
  /** 줄 사이 여백을 바깥에서 한 번만 만든다(→ 본문의 `briefList` 주석). */
  list: {},
  row: { borderBottomWidth: 1, borderColor: colors.borderCard },
  /** 첫 줄 위의 선. 나머지 줄의 위쪽은 앞 줄의 아래 선이 긋는다. */
  rowFirst: { borderTopWidth: 1, borderColor: colors.borderCard },
  /**
   * 🔴 **「이 기기」 줄은 바탕색으로도 갈린다.** 배지 하나로만 가르면 배지를 못 본 사람이
   * 자기 기기를 끊고, 그 줄의 버튼은 「끊기」가 아니라 「로그아웃」이라는 것도 놓친다.
   * ⚠️ 색만으로 뜻을 전하지는 않는다 — 배지와 버튼 이름이 같은 말을 글자로도 한다.
   */
  rowCurrent: { backgroundColor: colors.sageRow },
  head: { flexDirection: 'row', alignItems: 'center' },
  // `minHeight` 은 손가락이 닿을 자리다. 48 미만이면 옆 줄을 같이 눌러 엉뚱한 기기가 펼쳐진다.
  headMain: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.xs, gap: spacing.sm, minHeight: 48 },
  headText: { flex: 1, gap: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: { flexShrink: 1 },
  /** 「이 기기」 — 설정 화면의 상태 배지와 같은 규격이다(→ `app/settings.tsx`). */
  badge: { ...fonts.bodySemi, fontSize: text.md, color: colors.ink, backgroundColor: colors.inkFill, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, overflow: 'hidden' },
  /** 버튼은 오른쪽 끝에 붙여 폭만큼만 차지한다 — 줄마다 화면 폭짜리 막대가 서면 목록이 아니다. */
  action: { flexDirection: 'row', justifyContent: 'flex-end', paddingBottom: spacing.md },
  confirm: { paddingBottom: spacing.md, gap: spacing.sm },
  revoked: { paddingBottom: spacing.md, paddingHorizontal: spacing.xs },
  detail: { paddingBottom: spacing.lg, gap: spacing.xs, paddingHorizontal: spacing.xs },
  detailTitle: { ...fonts.bodySemi, fontSize: text.md, color: colors.ink, marginTop: spacing.sm },
  /**
   * 원문은 모노다 — 읽는 글이 아니라 **대조하는 값**이라서, 같은 기종 두 줄을 나란히 놓고
   * 다른 글자를 찾는 데 고정폭이 낫다. 눌러 복사할 수 있어야 문의할 때 그대로 옮겨 적는다.
   */
  agent: { ...fonts.mono, fontSize: text.base, lineHeight: 18, color: colors.mid },
});
