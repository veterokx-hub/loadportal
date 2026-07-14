"use client";

import { useState } from "react";

type DocsSectionId =
  | "about"
  | "scenario"
  | "theory"
  | "environment"
  | "run"
  | "analysis"
  | "report";

const SECTIONS: {
  id: DocsSectionId;
  label: string;
  available: boolean;
}[] = [
  { id: "about", label: "О портале", available: true },
  { id: "scenario", label: "Подготовка сценария", available: true },
  { id: "theory", label: "Теория НТ", available: false },
  { id: "environment", label: "Стенд", available: false },
  { id: "run", label: "Запуск", available: false },
  { id: "analysis", label: "Анализ", available: false },
  { id: "report", label: "Отчёт", available: false },
];

function SoonBlock({ title }: { title: string }) {
  return (
    <section className="docs-soon">
      <h3>{title}</h3>
      <p className="muted">
        Раздел документации готовится. Здесь появятся инструкции по соответствующему
        модулю портала.
      </p>
    </section>
  );
}

function AboutDocs() {
  return (
    <>
      <section>
        <h3>Назначение</h3>
        <p>
          <strong>НТ · Портал</strong> — корпоративная платформа нагрузочного тестирования.
          Сейчас доступен модуль <strong>«Сценарий»</strong>: подготовка сценария из
          OpenAPI/Swagger или Postman и сборка артефактов для <strong>JMeter</strong> (.jmx)
          или <strong>k6</strong> (.js).
        </p>
      </section>

      <section>
        <h3>Разделы портала</h3>
        <p className="muted" style={{ marginTop: -4 }}>
          Глобальная навигация под шапкой. Активен только «Сценарий»; остальные открывают
          экран «скоро».
        </p>
        <table className="docs-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Раздел</th>
              <th>Статус</th>
              <th>Содержание</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Сценарий</td>
              <td>доступен</td>
              <td>Мастер из 4 шагов, пульс, сборка, история</td>
            </tr>
            <tr>
              <td>2</td>
              <td>Стенд</td>
              <td>скоро</td>
              <td>Объект теста, заглушки, baseUrl</td>
            </tr>
            <tr>
              <td>3</td>
              <td>Запуск</td>
              <td>скоро</td>
              <td>Генератор нагрузки в k8s</td>
            </tr>
            <tr>
              <td>4</td>
              <td>Анализ</td>
              <td>скоро</td>
              <td>Метрики, baseline, рекомендации</td>
            </tr>
            <tr>
              <td>5</td>
              <td>Отчёт</td>
              <td>скоро</td>
              <td>PDF / Confluence</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>Вход и роли</h3>
        <ul>
          <li>
            Первый запуск: <code>admin</code> / <code>admin</code> —{" "}
            <strong>обязательная смена пароля</strong> (минимум 8 символов).
          </li>
          <li>
            Сессия: Bearer-токен на 24 часа. Состояние мастера сценария сохраняется в
            браузере (localStorage).
          </li>
          <li>
            Роль <strong>ADMIN</strong>: настройки ⚙ — пользователи и LDAP/AD.
          </li>
          <li>
            Роль <strong>USER</strong>: работа со сценариями; своя история сборок (до 20).
          </li>
          <li>
            LDAP: вход доменной учёткой (sAMAccountName). Группы AD не синхронизируются —
            роли задаются в портале. При первом LDAP-входе пользователь создаётся с ролью
            USER.
          </li>
        </ul>
      </section>

      <section>
        <h3>Куда смотреть дальше</h3>
        <p>
          Подробности по текущему функционалу — в подразделе{" "}
          <strong>«Подготовка сценария»</strong> слева. Теория НТ и инструкции по стенду,
          запуску, анализу и отчёту появятся в отдельных вкладках.
        </p>
      </section>
    </>
  );
}

function ScenarioDocs() {
  return (
    <>
      <section>
        <h3>Обзор</h3>
        <p>
          Раздел <strong>«Сценарий»</strong> — мастер из четырёх шагов. Единая доменная
          модель <code>Scenario</code> не зависит от движка: JMeter и k6 — производные
          артефакты на шаге сборки.
        </p>
        <ol>
          <li>
            <strong>Источник</strong> — импорт OpenAPI или Postman.
          </li>
          <li>
            <strong>Запросы</strong> — состав, методы, пути с <code>{"{param}"}</code>.
          </li>
          <li>
            <strong>Корреляция и параметры</strong> — Header / Query / Body / Path, CSV,
            экстракторы, валидация.
          </li>
          <li>
            <strong>Интенсивность и сборка</strong> — профиль RPS, AutoStop, JMeter/k6,
            история.
          </li>
        </ol>
        <p>
          Над шагами — <strong>«Пульс сценария»</strong>: оценка готовности, карта потока,
          чеклист. Сборка блокируется при критических ошибках пульса.
        </p>
      </section>

      <section>
        <h3>Шаг 1 · Источник</h3>
        <ul>
          <li>
            <strong>Swagger / OpenAPI</strong> — по URL (прямой JSON/YAML,{" "}
            <code>swagger.json</code>, страница Swagger UI) или вставка содержимого.
          </li>
          <li>
            <strong>Postman Collection</strong> — только вставка JSON (URL не
            поддерживается).
          </li>
          <li>Опционально: имя сценария (иначе берётся из спецификации).</li>
          <li>
            Analyzer нормализует операции в список запросов с предполагаемыми параметрами
            и базовым URL.
          </li>
          <li>
            Ошибки SSL / недоступности URL зависят от сетевых настроек сервиса analyzer в
            кластере (egress, CA).
          </li>
        </ul>
      </section>

      <section>
        <h3>Шаг 2 · Запросы</h3>
        <ul>
          <li>
            Редактируются метод (select), человекочитаемое имя и <strong>путь</strong>.
          </li>
          <li>
            Фрагменты <code>{"{name}"}</code> в пути автоматически становятся{" "}
            <strong>Path-параметрами</strong>. Их нельзя добавить на шаге 3 — только
            настроить значение. Удаление/переименование path — через правку URL здесь.
          </li>
          <li>
            <code>{"{…}"}</code> в теле также распознаются как body-параметры (с
            сохранением уже настроенных Header/Query).
          </li>
          <li>Можно добавить свой запрос или удалить лишний.</li>
          <li>
            На шаге 3 в шапке карточки отображается путь с подсветкой{" "}
            <code>{"{param}"}</code>.
          </li>
        </ul>
      </section>

      <section>
        <h3>Шаг 3 · Корреляция и параметры</h3>
        <h4>Датасеты (CSV)</h4>
        <ul>
          <li>
            Общие CSV на уровне сценария: имя, колонки (первая строка), строки данных,
            флаг случайного порядка.
          </li>
          <li>Лимит строк в редакторе: 2000 (для k6 большие файлы уходят во внешний CSV в zip).</li>
          <li>
            У запроса выбирается датасет — колонки становятся доступны в источнике «CSV».
          </li>
        </ul>

        <h4>Вкладки параметров</h4>
        <ul>
          <li>
            <strong>Header / Query / Body</strong> — можно добавлять и удалять. Пустая
            вкладка показывает «Нет параметров» и кнопку «Добавить».
          </li>
          <li>
            <strong>Path</strong> — только из URL шага 2; имя вида <code>{"{id}"}</code>{" "}
            только для чтения; настраивается источник значения.
          </li>
          <li>
            Query в JMeter попадает в HTTP Arguments (Parameters), не в path; в k6 — как{" "}
            <code>?key=</code>.
          </li>
        </ul>

        <h4>Источники значения</h4>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Источник</th>
              <th>Назначение</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Константа</td>
              <td>
                Фиксированная строка; допускает <code>${"{"}var{"}"}</code> и функции
                JMeter/k6-аналоги в тексте
              </td>
            </tr>
            <tr>
              <td>Генератор</td>
              <td>UUID, случайное число/строка, счётчик, метка времени</td>
            </tr>
            <tr>
              <td>Корреляция</td>
              <td>Переменная из экстрактора <em>предыдущего</em> запроса</td>
            </tr>
            <tr>
              <td>CSV</td>
              <td>Колонка выбранного датасета запроса</td>
            </tr>
          </tbody>
        </table>

        <h4>Генераторы (JMeter-семантика)</h4>
        <ul>
          <li>
            <code>${"{"}__UUID(){"}"}</code> — UUID
          </li>
          <li>
            <code>${"{"}__Random(min,max){"}"}</code> — целое
          </li>
          <li>
            <code>${"{"}__RandomString(len){"}"}</code> — строка заданной длины
          </li>
          <li>
            <code>${"{"}__counter(FALSE){"}"}</code> — счётчик
          </li>
          <li>
            <code>${"{"}__time(format){"}"}</code> — время; пустой format = Unix мс;
            иначе SimpleDateFormat
          </li>
        </ul>

        <h4>Извлечение из ответа</h4>
        <ul>
          <li>
            Типы: <strong>JSONPath</strong>, <strong>Regex</strong>,{" "}
            <strong>Boundary</strong> (left|right).
          </li>
          <li>
            Имя переменной без <code>${"{"}{"}"}</code> — в следующих запросах доступно как{" "}
            <code>${"{"}имя{"}"}</code>.
          </li>
          <li>
            Порядок запросов важен: корреляция видит только экстракторы с меньшим{" "}
            <code>order</code>.
          </li>
        </ul>

        <h4>Валидация ответа</h4>
        <ul>
          <li>Проверка HTTP-кода (Response Assertion).</li>
          <li>
            Опционально Contains по телу (текст; часто имя поля из swagger). Пусто —
            проверка тела не добавляется.
          </li>
        </ul>

        <h4>Переход дальше</h4>
        <p>
          Кнопка «Далее» недоступна, пока обязательные параметры (*) без значения.
          Обязательность типична для path/body из спецификации; header/query по умолчанию
          необязательны.
        </p>
      </section>

      <section>
        <h3>Пульс сценария</h3>
        <ul>
          <li>
            Оценка <strong>0–100</strong>, подпись готовности, пиковый RPS и длительность
            профиля.
          </li>
          <li>
            <strong>Карта потока</strong>: узлы-запросы и рёбра корреляции (какая
            переменная связывает A→B).
          </li>
          <li>
            <strong>Чеклист</strong>: блокеры (error), предупреждения, советы. Клик —
            переход на шаг. Блокеры запрещают сборку на шаге 4.
          </li>
          <li>
            <strong>«Копировать описание»</strong> — текст для согласования/отчёта.
          </li>
          <li>
            Типичные проверки: пустой обязательный параметр; корреляция на несуществующую
            переменную; CSV без датасета/колонки; нулевой RPS; отсутствие проверок ответа.
          </li>
        </ul>
      </section>

      <section>
        <h3>Группировка запросов</h3>
        <p>
          На шаге интенсивности запросы объединяются в группы (одна Thread Group / один
          k6 scenario), если:
        </p>
        <ul>
          <li>
            связаны корреляцией (<code>${"{"}var{"}"}</code> из экстрактора предыдущего),
            или
          </li>
          <li>используют один и тот же CSV-датасет.</li>
        </ul>
        <p>
          Остальные — отдельные группы со своей интенсивностью. Внутри группы RPS
          распределяется с учётом <strong>повторов</strong> запроса (Loop / repeat).
        </p>
      </section>

      <section>
        <h3>Шаг 4 · Интенсивность и сборка</h3>
        <h4>Режимы теста</h4>
        <ul>
          <li>
            <strong>Постоянная нагрузка (ramp_hold)</strong> — разгон + удержание целевого
            RPS.
          </li>
          <li>
            <strong>Поиск максимума (max_search)</strong> — ступени: число ступеней и
            длительность каждой; целевой RPS группы — пик последней ступени.
          </li>
        </ul>
        <ul>
          <li>
            <strong>Ожидаемая латентность</strong> — для оценки числа потоков/VU.
          </li>
          <li>
            График профиля нагрузки по группам; общие ramp/hold можно синхронизировать
            чекбоксами.
          </li>
          <li>
            <strong>Повтор запроса (×N)</strong> — доля RPS внутри группы пропорциональна
            повторам.
          </li>
        </ul>

        <h4>AutoStop</h4>
        <p>
          При включении: порог доли ошибок за окно секунд и/или порог среднего времени
          ответа. В JMeter — listener jpgc-autostop; в k6 — thresholds.
        </p>

        <h4>Prometheus (только JMeter)</h4>
        <p>
          В каждый .jmx добавляется Backend Listener{" "}
          <code>com.github.kolesnikovm.PrometheusListener</code>. Хост метрик — на стороне
          машины/пода с JMeter; в портале задаётся порт exporter (по умолчанию 9001).
        </p>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Параметр</th>
              <th>Описание</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>testName</code>
              </td>
              <td>Имя сценария</td>
            </tr>
            <tr>
              <td>
                <code>runId</code>
              </td>
              <td>Идентификатор прогона</td>
            </tr>
            <tr>
              <td>
                <code>applicationPort</code> / exporter port
              </td>
              <td>Порт HTTP <code>/metrics</code></td>
            </tr>
            <tr>
              <td>
                <code>samplersRegExp</code>
              </td>
              <td>
                Фильтр сэмплеров (<code>.*</code> — все)
              </td>
            </tr>
            <tr>
              <td>
                <code>sloLevels</code>
              </td>
              <td>
                Корзины гистограммы, напр. <code>0.1;1</code>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="hint">
          Для k6 отдельный Prometheus listener не генерируется — используются checks и
          thresholds; remote write настраивается при запуске runner&apos;а (модуль
          «Запуск»).
        </p>

        <h4>Выбор движка и сборка</h4>
        <ul>
          <li>
            <strong>JMeter</strong> — скачивается .jmx (или zip с CSV при необходимости).
          </li>
          <li>
            <strong>k6</strong> — .js или zip при больших датасетах.
          </li>
          <li>
            Успешная сборка пишется в <strong>историю сборок</strong> пользователя (хранится
            последние <strong>20</strong>). Можно восстановить сценарий из истории.
          </li>
        </ul>
      </section>

      <section>
        <h3>Что попадает в JMeter (.jmx)</h3>
        <ul>
          <li>Concurrency Thread Group + Throughput Shaping Timer на группу</li>
          <li>Loop Controller при repeat &gt; 1</li>
          <li>CSV Data Set / Random CSV Data Set</li>
          <li>JSON/Regex/Boundary extractors</li>
          <li>Response Assertion (код + Contains)</li>
          <li>AutoStop Listener (jpgc-autostop) при включении</li>
          <li>Prometheus Backend Listener (Колесников) по умолчанию</li>
          <li>Header / Query (Arguments) / Body / Path из параметров</li>
        </ul>
      </section>

      <section>
        <h3>Что попадает в k6 (.js)</h3>
        <ul>
          <li>
            <code>ramping-arrival-rate</code> — open-model по RPS
          </li>
          <li>Корреляция через переменные сценария, <code>check()</code></li>
          <li>thresholds для AutoStop</li>
          <li>SharedArray / внешний CSV в zip при больших датасетах (&gt;2000 строк)</li>
        </ul>
      </section>

      <section>
        <h3>Плагины JMeter (на машине запуска)</h3>
        <ul>
          <li>
            <code>jpgc-casutg</code> — Concurrency Thread Group
          </li>
          <li>
            <code>jpgc-tst</code> — Throughput Shaping Timer
          </li>
          <li>
            <code>jpgc-autostop</code> — AutoStop (если включён в сценарии)
          </li>
          <li>
            <code>jmeter-prometheus-listener</code> — Prometheus Backend Listener в{" "}
            <code>lib/ext</code>
          </li>
        </ul>
        <p className="hint">
          Установка: JMeter Plugins Manager → соответствующие плагины. Без них .jmx из
          портала может не открыться или не дать целевой RPS.
        </p>
      </section>

      <section>
        <h3>Практические советы</h3>
        <ul>
          <li>
            Сначала настройте login/token → экстрактор → заголовок Authorization в
            следующих запросах.
          </li>
          <li>
            Не хардкодьте prod URL в path: base URL сценария и будущий override на стенде
            (раздел «Стенд»).
          </li>
          <li>
            Смотрите пульс перед сборкой: блокеры дешевле исправить в UI, чем в JMeter GUI.
          </li>
          <li>
            История сборок привязана к пользователю — у коллеги свой список.
          </li>
        </ul>
      </section>
    </>
  );
}

export function Documentation({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<DocsSectionId>("scenario");

  if (!open) return null;

  return (
    <div className="docs-overlay" onClick={onClose}>
      <div className="docs-panel panel docs-panel-wide" onClick={(e) => e.stopPropagation()}>
        <div className="docs-head">
          <div>
            <h2>Документация</h2>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              НТ · Портал · справка по разделам
            </p>
          </div>
          <button type="button" className="ghost small" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="docs-layout">
          <nav className="docs-nav" aria-label="Разделы документации">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`docs-nav-item ${section === s.id ? "active" : ""} ${
                  s.available ? "" : "soon"
                }`}
                onClick={() => setSection(s.id)}
              >
                <span>{s.label}</span>
                {!s.available && <span className="docs-nav-soon">скоро</span>}
              </button>
            ))}
          </nav>

          <div className="docs-content">
            {section === "about" && <AboutDocs />}
            {section === "scenario" && <ScenarioDocs />}
            {section === "theory" && <SoonBlock title="Теория нагрузочного тестирования" />}
            {section === "environment" && <SoonBlock title="Стенд" />}
            {section === "run" && <SoonBlock title="Запуск теста" />}
            {section === "analysis" && <SoonBlock title="Анализ результатов" />}
            {section === "report" && <SoonBlock title="Формирование отчёта" />}
          </div>
        </div>
      </div>
    </div>
  );
}
