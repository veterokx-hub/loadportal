/** Невидимые символы, которые попадают из Word, Excel и почты и не видны в поле. */
const INVISIBLE =
  /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u200B-\u200D\u2060\uFEFF\u00AD\u2028\u2029]/g;

export function stripHidden(text: string): string {
  return text.replace(INVISIBLE, (ch) =>
    ch === "\u00A0" ||
    ch === "\u1680" ||
    (ch >= "\u2000" && ch <= "\u200A") ||
    ch === "\u202F" ||
    ch === "\u205F" ||
    ch === "\u3000" ||
    ch === "\u2028" ||
    ch === "\u2029"
      ? " "
      : ""
  );
}

/** Убирает скрытые символы. Если текст — JSON, приводит его к отступу в 2 пробела. */
export function tidyPasted(text: string): { text: string; formatted: boolean; changed: boolean } {
  const cleaned = stripHidden(text);
  const trimmed = cleaned.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const pretty = JSON.stringify(JSON.parse(trimmed), null, 2);
      return { text: pretty, formatted: true, changed: pretty !== text };
    } catch {
      return { text: cleaned, formatted: false, changed: cleaned !== text };
    }
  }
  return { text: cleaned, formatted: false, changed: cleaned !== text };
}
