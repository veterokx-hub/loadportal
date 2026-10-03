"use client";

export function FileUploadButton({
  accept,
  disabled,
  onPick,
  children = "Загрузить файл",
}: {
  accept?: string;
  disabled?: boolean;
  onPick: (file: File) => void;
  children?: React.ReactNode;
}) {
  return (
    <label className={`file-upload-btn ${disabled ? "is-disabled" : ""}`}>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
      {children}
    </label>
  );
}
