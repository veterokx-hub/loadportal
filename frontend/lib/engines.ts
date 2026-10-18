/**
 * Движки сборки и их честная семантика.
 *
 * Один целевой RPS в портале = HTTP-запросы в секунду. Инструменты добиваются
 * его по-разному, и различия здесь не сглаживаются, а выписаны текстом: экран
 * «Интенсивность и сборка» показывает ровно то, что окажется в артефакте.
 */
export type Engine = "jmeter" | "k6" | "gatling";

export interface EngineMeta {
  id: Engine;
  /** Подпись на переключателе. */
  label: string;
  /** Два-три слова под пилюлей: чем движок отличается. */
  tagline: string;
  /** Короткое имя для заголовков. */
  short: string;
  /** Расширение одиночного артефакта (без датасетов). */
  artifact: string;
  /** Нужна ли «ожидаемая латентность» для расчёта пула пользователей. */
  needsLatency: boolean;
  /** Подпись к производной величине под целевым RPS (null — не показывать). */
  derivedLabel: string | null;
  /** Как трактуется целевой RPS. */
  rpsHint: string;
  /** Как строится профиль в выбранном режиме теста. */
  modeHint: (maxSearch: boolean) => string;
  /** Подсказка к полю процента выполнений. */
  throughputTitle: string;
  /** Подсказка к полю числа повторов за итерацию. */
  repeatTitle: string;
  /** Что окажется в артефакте. */
  buildHint: string;
}

export const ENGINE_META: Record<Engine, EngineMeta> = {
  jmeter: {
    id: "jmeter",
    label: "JMeter (.jmx)",
    tagline: "Стандарт с GUI",
    short: "JMeter",
    artifact: ".jmx",
    needsLatency: true,
    derivedLabel: null,
    rpsHint:
      "Целевой RPS — HTTP-сэмплы в секунду, их держит Throughput Shaping Timer. Потоков = RPS × ожидаемая латентность.",
    modeHint: (maxSearch) =>
      maxSearch
        ? "Лестница TST от пик/N до пика, ступени без разгона."
        : "Разгон от min(1, RPS) до цели, затем удержание.",
    throughputTitle:
      "Процент итераций потока, в которых запрос выполняется (Throughput Controller). 100 — каждый проход",
    repeatTitle:
      "Сколько раз запрос выполняется за одну итерацию потока (Loop Controller). Доля RPS пропорциональна числу повторов",
    buildHint:
      "Группа → Concurrency Thread Group + Throughput Shaping Timer. Нужны плагины jpgc-casutg и jpgc-tst.",
  },
  k6: {
    id: "k6",
    label: "k6 (.js)",
    tagline: "Скрипт для CI",
    short: "k6",
    artifact: ".js",
    needsLatency: true,
    derivedLabel: "k6 arrival",
    rpsHint:
      "Целевой RPS — HTTP-запросы в секунду. k6 запускает итерации, поэтому arrival = RPS / HTTP за итерацию.",
    modeHint: (maxSearch) =>
      maxSearch
        ? "Ступени через stages: между полками короткий разгон (~10% ступени), мгновенного скачка в k6 нет."
        : "Разгон от min(1, RPS) до цели, затем удержание. Пул VU = RPS × латентность × 1,5.",
    throughputTitle:
      "Процент итераций, в которых запрос выполняется. 100 — каждый проход; arrival считается по сумме процентов",
    repeatTitle:
      "Сколько раз запрос выполняется за итерацию. arrival считается по сумме повторов",
    buildHint:
      "Группа → k6 scenario (ramping-arrival-rate). Корреляция, CSV через SharedArray, checks и portal_errors.",
  },
  gatling: {
    id: "gatling",
    label: "Gatling (.zip)",
    tagline: "Открытая модель",
    short: "Gatling",
    artifact: ".zip",
    // Открытая модель Gatling создаёт пользователей по мере поступления: пул не задаётся.
    needsLatency: false,
    derivedLabel: "Gatling usersPerSec",
    rpsHint:
      "Целевой RPS — HTTP-запросы в секунду. usersPerSec = RPS / HTTP за итерацию; throttle не используется — он корректен только для сценариев из одного запроса.",
    modeHint: (maxSearch) =>
      maxSearch
        ? "Лестница incrementUsersPerSec: ровные полки без разгона, как в TST. Пул пользователей не задаётся."
        : "rampUsersPerSec, затем constantUsersPerSec со случайными интервалами стартов. Пул пользователей не задаётся.",
    throughputTitle:
      "Процент итераций пользователя, в которых запрос выполняется. 100 — каждый проход; usersPerSec считается по сумме процентов",
    repeatTitle:
      "Сколько раз запрос выполняется за итерацию пользователя. usersPerSec считается по сумме повторов",
    buildHint:
      "Группа → Gatling scenario в общем setUp. Артефакт — Maven-проект: mvn gatling:test, JDK 17+.",
  },
};

export const ENGINES: EngineMeta[] = [
  ENGINE_META.jmeter,
  ENGINE_META.k6,
  ENGINE_META.gatling,
];

/** Команда запуска скачанного артефакта — для подсказки после сборки. */
export function runCommand(engine: Engine, filename: string): string {
  const zip = filename.toLowerCase().endsWith(".zip");
  switch (engine) {
    case "k6":
      return `k6 run ${zip ? "script.js" : filename}`;
    case "gatling":
      return "mvn gatling:test";
    default:
      return zip ? "распакуйте и откройте .jmx в JMeter" : `откройте ${filename} в JMeter`;
  }
}
