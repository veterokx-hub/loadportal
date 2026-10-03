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
  /** Два слова под пилюлей: зачем брать этот движок. */
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
  /** Подсказка к полю «×N». */
  repeatTitle: string;
  /** Что окажется в артефакте. */
  buildHint: string;
}

export const ENGINE_META: Record<Engine, EngineMeta> = {
  jmeter: {
    id: "jmeter",
    label: "JMeter (.jmx)",
    tagline: "Абсолютный стандарт",
    short: "JMeter",
    artifact: ".jmx",
    needsLatency: true,
    derivedLabel: null,
    rpsHint:
      "Целевой RPS — HTTP-сэмплы/с группы: их режет Throughput Shaping Timer. Потоки Concurrency Thread Group = RPS × ожидаемая латентность.",
    modeHint: (maxSearch) =>
      maxSearch
        ? "Лестница TST: пик/N → пик. Ступени плоские, внутри ступени разгона нет."
        : "Concurrency Thread Group + TST: разгон от min(1, RPS) до цели, затем удержание.",
    repeatTitle: "повторов за итерацию потока (Loop Controller)",
    buildHint:
      "Каждая группа → Concurrency Thread Group + Throughput Shaping Timer. Нужны плагины jpgc-casutg и jpgc-tst.",
  },
  k6: {
    id: "k6",
    label: "k6 (.js)",
    tagline: "Лёгкий CI",
    short: "k6",
    artifact: ".js",
    needsLatency: true,
    derivedLabel: "k6 arrival",
    rpsHint:
      "Целевой RPS — HTTP-запросы/с. k6 инжектит итерации, а не сэмплы, поэтому arrival-rate = RPS / число HTTP за итерацию группы.",
    modeHint: (maxSearch) =>
      maxSearch
        ? "Ступени задаются stages: между полками k6 коротко разгоняется (~10% длительности ступени) — мгновенного jump в ramping-arrival-rate нет."
        : "ramping-arrival-rate: от min(1, RPS) HTTP/с до цели, затем удержание. Пул VU = RPS × латентность × 1.5.",
    repeatTitle:
      "повторов за итерацию k6 exec: увеличивает число HTTP за итерацию и снижает arrival",
    buildHint:
      "Каждая группа → k6 scenario (ramping-arrival-rate). Корреляция, CSV (SharedArray), checks и portal_errors.",
  },
  gatling: {
    id: "gatling",
    label: "Gatling (.zip)",
    tagline: "Мощный поток",
    short: "Gatling",
    artifact: ".zip",
    // Открытая модель Gatling создаёт пользователей по мере поступления: пул не задаётся.
    needsLatency: false,
    derivedLabel: "Gatling usersPerSec",
    rpsHint:
      "Целевой RPS — HTTP-запросы/с. Открытая модель: usersPerSec = RPS / число HTTP за итерацию. throttle намеренно не используется: документация Gatling допускает его только для однозапросных сценариев.",
    modeHint: (maxSearch) =>
      maxSearch
        ? "Нативная лестница incrementUsersPerSec().times().eachLevelLasting(): ровные полки без рамп между ступенями — ближе всего к TST."
        : "rampUsersPerSec(...).to(...) + constantUsersPerSec(...).randomized(): интервалы стартов рандомизированы, чтобы длинный тест не шёл синхронными пачками.",
    repeatTitle:
      "повторов за итерацию сценария (repeat(n).on): увеличивает число HTTP за итерацию и снижает usersPerSec",
    buildHint:
      "Каждая группа → отдельный Gatling scenario в одном setUp. Артефакт — Maven-проект: mvn gatling:test, нужен JDK 17+.",
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
