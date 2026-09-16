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
   * 다음 칸으로 포커스를 넘기려면 필요하다(엔터로 이메일 → 비밀번호).
   * React 19 부터 `ref` 는 그냥 prop 이라 `forwardRef` 로 감싸지 않는다.
   */
  ref?: Ref<TextInput>;
};

export function TextField({ label, ref, ...rest }: FieldProps) {
  const labelId = useId();
  return (
    <View style={styles.field}>
      <Text nativeID={labelId} style={styles.label}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityLabelledBy={labelId}
        style={styles.input}
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
  label: {
    ...fonts.bodySemi,
    fontSize: text.sm,
    letterSpacing: 1,
    color: colors.muted,
  },
  input: {
    marginTop: spacing.xs,
    height: 48,
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
