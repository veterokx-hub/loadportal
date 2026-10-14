/** Имя копии: «Запрос (1)», следующий свободный номер, без «(1) (1)». */
export function duplicateRequestName(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const trimmed = name.trim();
  const stem = trimmed.match(/^(.*) \(\d+\)$/);
  const base = (stem?.[1] ?? trimmed).trim() || trimmed || "Запрос";
  let n = 1;
  while (taken.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}
