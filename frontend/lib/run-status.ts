export const VERDICT_LABELS: Record<string, string> = {
  passed: "Пройден",
  failed: "SLA не пройден",
  invalid: "Недостоверен",
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  queued: "В очереди",
  running: "Идёт",
  succeeded: "Успешно",
  failed: "Провален",
  canceled: "Отменён",
};
