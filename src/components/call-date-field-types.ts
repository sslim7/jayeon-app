export type CallDateFieldProps = {
  label: string;
  /** 화면 형식 `YYYY-MM-DD HH:mm`. 빈 문자열은 「아직 고르지 않음」이다. */
  value: string;
  onChange: (value: string) => void;
};
