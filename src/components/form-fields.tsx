/**
 * 인증 화면들이 함께 쓰는 입력 한 칸.
 *
 * # 왜 컴포넌트로 뽑았나
 *
 * 로그인에 두 칸, 비밀번호 변경에 세 칸 — 같은 모양이 다섯 번 나온다. 화면마다 따로 적으면
 * 라벨 색이나 테두리 굵기가 한쪽만 바뀌는 어긋남이 생기는데, **그런 어긋남은 아무것도
 * 깨뜨리지 않아서** 디자인이 오는 날까지 아무도 모른다.
 *
 * # 반드시 지켜야 하는 것
 *
 * 🔴 글자 크기는 **언제나 `inputFontSize()` 를 통과시킨다.** 이유는 그 함수 주석에 있다 —
 * iOS Safari 가 16px 미만 입력에 포커스가 가면 페이지를 강제로 확대하고, 포커스가 풀려도
 * 배율이 돌아오지 않는다. 이 앱은 웹이 주 무대라 그 자리에 실제로 서게 된다
 * (→ `constants/theme.ts` 의 `inputFontSize`).
 *
 * 눈 아이콘 대신 「보기 / 숨기기」 글자를 쓰는 이유는 이 저장소에 아이콘 세트가 없기
 * 때문이다. 아이콘 라이브러리를 이 한 자리 때문에 들이지 않는다 — 글자는 낭독기에도 그대로
 * 읽히므로 접근성으로도 손해가 아니다.
 */

import { useId, useState, type Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fonts, inputFontSize, radii, spacing, text } from '@/constants/theme';

type FieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  /**
   * 라벨을 **눈에서만** 감춘다 — 검색·필터 칸 전용이다.
   *
   * 그 칸들은 placeholder 가 이미 같은 문장을 말하고 있어서 라벨까지 그리면 한 화면에 같은
   * 말이 두 번 선다. 다만 낭독기에는 「무엇을 하는 칸인지」가 여전히 필요하므로 라벨 글자만
   * 걷고 `accessibilityLabel`(웹의 `aria-label`)로는 그대로 남긴다.
   *
   * 🔴 이름·전화번호처럼 **무엇을 넣는 칸인지 알려 주는 일반 폼 필드에는 쓰지 마라.**
   */
  hideLabel?: boolean;
  /**
   * 다음 칸으로 포커스를 넘기려면 필요하다(엔터로 이메일 → 비밀번호).
   * React 19 부터 `ref` 는 그냥 prop 이라 `forwardRef` 로 감싸지 않는다.
   */
  ref?: Ref<TextInput>;
};

export function TextField({ label, hideLabel = false, ref, ...rest }: FieldProps) {
  const labelId = useId();
  return (
    <View style={[styles.field, hideLabel && styles.fieldBare]}>
      {hideLabel ? null : (
        <Text nativeID={labelId} style={styles.label}>
          {label}
        </Text>
      )}
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        // 라벨 글자가 없으면 가리킬 대상도 없다. 그 자리는 위의 `accessibilityLabel` 이 맡는다.
        accessibilityLabelledBy={hideLabel ? undefined : labelId}
        style={[styles.input, hideLabel && styles.inputBare]}
        placeholderTextColor={colors.empty}
        selectionColor={colors.green}
        {...rest}
      />
    </View>
  );
}

export function PasswordField({ label, ref, ...rest }: FieldProps) {
  const [visible, setVisible] = useState(false);
  const labelId = useId();

  return (
    <View style={styles.field}>
      <Text nativeID={labelId} style={styles.label}>
        {label}
      </Text>
      <View style={styles.row}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityLabelledBy={labelId}
          style={[styles.input, styles.inputInRow]}
          placeholderTextColor={colors.empty}
          selectionColor={colors.green}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          {...rest}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} ${visible ? '숨기기' : '보기'}`}
          accessibilityState={{ disabled: rest.editable === false }}
          disabled={rest.editable === false}
          onPress={() => setVisible((prev) => !prev)}
          style={styles.toggle}>
          <Text style={styles.toggleText}>{visible ? '숨기기' : '보기'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginTop: spacing.lg },
  /** 라벨이 없으면 라벨이 앉을 위 여백도 없다. 바깥 묶음의 간격만 남긴다. */
  fieldBare: { marginTop: 0 },
  label: {
    ...fonts.bodySemi,
    fontSize: text.sm,
    letterSpacing: 1,
    color: colors.muted,
  },
  /** 라벨을 감춘 칸은 라벨과의 간격도 필요 없다. */
  inputBare: { marginTop: 0 },
  input: {
    marginTop: spacing.xs,
    height: 48,
    /*
     * 🔴 **안드로이드에서 글자가 칸 위쪽에 붙는 것을 막는 두 줄이다. 둘 다 필요하다.**
     *
     * `textAlignVertical` 은 `TextInput` 의 기본값이 `'top'` 이라 필요하고,
     * `includeFontPadding` 은 안드로이드가 글꼴 위아래에 **자체 여백**을 덧대기 때문에
     * 필요하다 — 한글 글꼴은 그 여백이 커서, 가운데 정렬을 켜도 그 여백째로 가운데가 되어
     * 글자는 여전히 위로 밀린다. 실기기에서 `textAlignVertical` 만 넣고 다시 빌드했더니
     * 화면이 그대로였고, 번들에 값이 들어간 것을 확인한 뒤에야 이 두 번째 원인을 찾았다.
     *
     * ⚠️ iOS 는 기본이 가운데이고 `includeFontPadding` 은 안드로이드 전용이라 무시된다.
     * 웹도 해당 없다 — **안드로이드 실기기에서만** 드러나는 차이다.
     */
    textAlignVertical: 'center',
    includeFontPadding: false,
    // 고정 높이(48) 안에서 세로 여백까지 있으면 글자가 설 자리가 그만큼 좁아진다.
    paddingVertical: 0,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.button,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    ...fonts.body,
    fontSize: inputFontSize(text.lg),
    color: colors.ink,
  },
  row: { position: 'relative' },
  // 토글 글자가 앉을 자리를 비워 둔다. 비우지 않으면 긴 비밀번호가 글자 밑으로 들어간다.
  inputInRow: { paddingRight: 64 },
  toggle: {
    position: 'absolute',
    right: 0,
    // 입력칸이 `marginTop` 만큼 내려가 있으므로 토글도 같은 만큼 내려야 세로 중앙에 선다.
    top: spacing.xs,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  toggleText: { ...fonts.bodySemi, fontSize: text.base, color: colors.greenText },
});
