"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Числовое поле, которое можно полностью стереть.
 * Пустое значение не превращается в 0, пока пользователь не введёт цифру.
 */
export function NumberField({
  value,
  onCommit,
  min,
  disabled,
  required = true,
  title,
  style,
  className,
  fieldId,
  onValidity,
  placeholder,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  step?: string | number;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  style?: React.CSSProperties;
  className?: string;
  fieldId?: string;
  onValidity?: (id: string, ok: boolean) => void;
  placeholder?: string;
}) {
  const [raw, setRaw] = useState(String(value));
  const [touched, setTouched] = useState(false);
  const focused = useRef(false);
  const id = fieldId ?? "n";

  useEffect(() => {
    if (!focused.current) setRaw(String(value));
  }, [value]);

  const empty = raw.trim() === "";
  const parsed = Number(raw.replace(",", "."));
  const nan = !empty && Number.isNaN(parsed);
  const below = !empty && !nan && min != null && parsed < min;
  const ok = !required ? !nan && !below : !empty && !nan && !below;

  useEffect(() => {
    onValidity?.(id, ok);
    return () => onValidity?.(id, true);
  }, [id, ok, onValidity]);

  return (
    <span className={`num-field ${ok || !touched ? "" : "is-invalid"}`}>
      <input
        type="text"
        inputMode="decimal"
        className={className}
        style={style}
        title={title}
        disabled={disabled}
        aria-invalid={touched && !ok}
        placeholder={placeholder}
        value={raw}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          const v = e.target.value.replace(",", ".");
          if (v !== "" && !/^-?\d*\.?\d*$/.test(v)) return;
          setTouched(true);
          setRaw(v);
          if (v !== "" && !Number.isNaN(Number(v))) {
            const n = Number(v);
            if (min == null || n >= min) onCommit(n);
          }
        }}
        onBlur={() => {
          focused.current = false;
          setTouched(true);
          if (raw.trim() !== "" && !Number.isNaN(Number(raw))) {
            const n = Number(raw);
            setRaw(String(n));
            if (min == null || n >= min) onCommit(n);
          }
        }}
      />
      {touched && empty && required && (
        <span className="field-warn">Укажите значение</span>
      )}
      {touched && below && (
        <span className="field-warn">Не меньше {min}</span>
      )}
    </span>
  );
}
