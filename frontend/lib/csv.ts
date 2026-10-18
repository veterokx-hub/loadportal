/** Запятая или точка с запятой — что чаще стоит между полями первой строки. */
export function csvDelimiter(text: string): "," | ";" {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (let i = 0; i < first.length; i++) {
    const ch = first[i];
    if (ch === '"') {
      if (quoted && first[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && ch === ",") commas++;
    else if (!quoted && ch === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

/** CSV по RFC 4180. Разделитель — запятая или точка с запятой. */
export function csvRecords(text: string, delimiter?: "," | ";"): string[][] {
  const sep = delimiter ?? csvDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  const endField = () => {
    record.push(wasQuoted ? field : field.trim());
    field = "";
    wasQuoted = false;
  };
  const endRecord = () => {
    endField();
    if (record.some((c) => c.length > 0)) records.push(record);
    record = [];
  };
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      wasQuoted = true;
      field = "";
    } else if (ch === sep) endField();
    else if (ch === "\n") endRecord();
    else field += ch;
  }
  endRecord();
  return records;
}

/** Поле CSV: в кавычки, если внутри запятая, кавычка или перевод строки. */
export function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
