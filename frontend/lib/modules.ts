export type AppModuleId =
  | "scenario"
  | "environment"
  | "run"
  | "analysis"
  | "report";

export interface AppModule {
  id: AppModuleId;
  /** Короткое имя в навигации */
  nav: string;
  /** Полный заголовок раздела */
  title: string;
  /** Одна строка — зачем раздел */
  blurb: string;
  /** Доступен ли раздел сейчас */
  available: boolean;
  /** Что появится (для экрана «скоро») */
  preview: string[];
}

/**
 * Глобальные разделы портала (модули платформы).
 * Раздел 2: «Стенд» — коротко и понятно для НТ (SUT + stubs + проверка готовности).
 */
export const APP_MODULES: AppModule[] = [
  {
    id: "scenario",
    nav: "Сценарий",
    title: "Подготовка сценария",
    blurb: "Источник API → параметры → корреляция → сборка JMeter / k6",
    available: true,
    preview: [],
  },
  {
    id: "environment",
    nav: "Стенд",
    title: "Стенд",
    blurb: "Развернуть объект теста и получить baseUrl",
    available: false,
    preview: [
      "Развёртывание тестируемого сервиса в изолированном namespace",
      "WireMock / заглушки внешних систем",
      "Проверка health и готовности стенда",
      "Стабильный baseUrl для запуска нагрузки",
    ],
  },
  {
    id: "run",
    nav: "Запуск",
    title: "Запуск теста",
    blurb: "Сборка или скрипт → Jira → карточка прогона (GitLab CI — далее)",
    available: true,
    preview: [],
  },
  {
    id: "analysis",
    nav: "Анализ",
    title: "Анализ результатов",
    blurb: "Аномалии в метриках сервиса → гипотеза о причине в коде",
    available: true,
    preview: [],
  },
  {
    id: "report",
    nav: "Отчёт",
    title: "Отчёт",
    blurb: "Итоговый документ для команды и заказчика",
    available: false,
    preview: [
      "Executive summary и графики",
      "Конфигурация сценария и стенда",
      "Экспорт PDF / публикация в Confluence",
      "Audit trail прогона",
    ],
  },
];

export function getModule(id: AppModuleId): AppModule {
  return APP_MODULES.find((m) => m.id === id) ?? APP_MODULES[0];
}
