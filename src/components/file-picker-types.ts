export type PickedFile = { fileName: string; mimeType: string; dataBase64: string; size: number };
export type FilePickerProps = {
  label: string;
  accept: string;
  maxBytes: number;
  disabled?: boolean;
  onPick: (file: PickedFile) => void;
  onError: (message: string) => void;
};
