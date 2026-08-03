"use client";

import { useState } from "react";

type DocsSectionId =
  | "about"
  | "scenario"
  | "run"
  | "theory"
  | "environment"
  | "analysis"
  | "report";

const SECTIONS: {
  id: DocsSectionId;
  label: string;
  available: boolean;
}[] = [
  { id: "about", label: "О портале", available: true },
  { id: "scenario", label: "Сценарий", available: true },
  { id: "run", label: "Запуск", available: true },
  { id: "theory", label: "Теория НТ", available: true },
  { id: "environment", label: "Стенд", available: false },
  { id: "analysis", label: "Анализ", available: false },
  { id: "report", label: "Отчёт", available: false },
];

function SoonBlock({ title }: { title: string }) {
  return (
    <section className="docs-soon">
      <h3>{title}</h3>
      <p className="muted">Раздел документации готовится вместе с модулем.</p>
    </section>
  );
}

function AboutDocs() {
  return (
    <>
      <section>
        <h3>Назначение</h3>
        <p>
          <strong>НТ · Портал</strong> — платформа для подготовки и запуска нагрузочных
          тестов. Сценарий собирается из OpenAPI/Postman в артефакт{" "}
          <strong>JMeter</strong> или <strong>k6</strong>, прогон фиксируется в разделе
          «Запуск» и связывается с задачей Jira.
        </p>
      </section>

      <section>
        <h3>Разделы</h3>
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
              <td>Импорт → параметры → профиль → сборка</td>
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
              <td>доступен</td>
              <td>Прогон по сборке/скрипту, Jira, статусы</td>
            </tr>
            <tr>
              <td>4</td>
              <td>Анализ</td>
              <td>скоро</td>
              <td>Метрики и аномалии по run_id</td>
            </tr>
            <tr>
              <td>5</td>
              <td>Отчёт</td>
              <td>скоро</td>
              <td>Итоговый документ по run_id</td>
            </tr>
          </tbody>
        </table>
        <p className="hint">
          URL разделов и шагов — отдельные path. «Назад» в браузере возвращает на предыдущий
          экран. Настройки и эта справка открываются поверх, без смены адреса.
        </p>
      </section>

      <section>
        <h3>Вход и роли</h3>
        <ul>
          <li>
            Первый вход: <code>admin</code> / <code>admin</code> → обязательная смена пароля
            (≥ 8 символов).
          </li>
          <li>Сессия: Bearer на 24 ч. Черновик сценария — в localStorage браузера.</li>
          <li>
            <strong>ADMIN</strong>: пользователи, LDAP, GitLab CI.
          </li>
          <li>
            <strong>USER</strong>: сценарии и свои прогоны; история сборок — до 20 записей.
          </li>
          <li>
            LDAP: логин = sAMAccountName. Роли в AD не синхронизируются — задаются в портале.
          </li>
        </ul>
      </section>

      <section>
        <h3>Идентификаторы</h3>
        <table className="docs-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Где</th>
              <th>Зачем</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>build_id</code>
              </td>
              <td>Сценарий</td>
              <td>Снимок сценария + движок</td>
            </tr>
            <tr>
              <td>
                <code>script_id</code>
              </td>
              <td>Сценарий / Запуск</td>
              <td>Файл .jmx / .js (сборка или upload)</td>
            </tr>
            <tr>
              <td>
                <code>test_id</code>
              </td>
              <td>Запуск</td>
              <td>Ключ задачи Jira</td>
            </tr>
            <tr>
              <td>
                <code>run_id</code>
              </td>
              <td>Запуск → Анализ / Отчёт</td>
              <td>Конкретный прогон</td>
            </tr>
          </tbody>
        </table>
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
          Мастер из 4 шагов. Модель <code>Scenario</code> общая; JMeter и k6 — артефакты на
          финальном шаге.
        </p>
        <ol>
          <li>
            <strong>Источник</strong> — OpenAPI или Postman.
          </li>
          <li>
            <strong>Запросы</strong> — метод, имя, путь с <code>{"{param}"}</code>.
          </li>
          <li>
            <strong>Корреляция и параметры</strong> — Header / Query / Body / Path, CSV,
            экстракторы.
          </li>
          <li>
            <strong>Интенсивность и сборка</strong> — RPS, AutoStop, сохранить / выгрузить /
            к запуску.
          </li>
        </ol>
        <p>
          <strong>Пульс сценария</strong> над шагами: готовность 0–100, блокеры. При
          блокерах сборка недоступна.
        </p>
      </section>

      <section>
        <h3>Источник и запросы</h3>
        <ul>
          <li>
            OpenAPI — URL (JSON/YAML, Swagger UI) или вставка текста. Postman — только JSON
            коллекции.
          </li>
          <li>
            В пути <code>{"{id}"}</code> → Path-параметр (имя только из URL). Header /
            Query / Body добавляются на шаге 3.
          </li>
        </ul>
      </section>

      <section>
        <h3>Параметры и корреляция</h3>
        <ul>
          <li>
            Источники значения: константа, генератор, корреляция (из ответа предыдущего
            запроса), CSV.
          </li>
          <li>
            Экстракторы: JSONPath, Regex, Boundary. Порядок запросов важен.
          </li>
          <li>Валидация: HTTP-код и опционально Contains по телу.</li>
          <li>«Далее» недоступно, пока обязательные (*) параметры пусты.</li>
        </ul>
      </section>

      <section>
        <h3>Интенсивность и сборка</h3>
        <ul>
          <li>
            <strong>Постоянная нагрузка</strong> — разгон + удержание RPS.
          </li>
          <li>
            <strong>Поиск максимума</strong> — ступени до целевого RPS.
          </li>
          <li>
            Группы запросов: связаны корреляцией или одним CSV — одна Thread Group / k6
            scenario.
          </li>
          <li>
            Кнопки: <strong>К запуску теста</strong> (основная) → сохраняет сборку и
            открывает «Запуск»; <strong>Сохранить сборку</strong>;{" "}
            <strong>Выгрузить скрипт</strong> (скачать файл).
          </li>
        </ul>
        <p className="hint">
          JMeter на runner: плагины <code>jpgc-casutg</code>, <code>jpgc-tst</code>, при
          AutoStop — <code>jpgc-autostop</code>, для метрик — prometheus-listener.
        </p>
      </section>
    </>
  );
}

function RunDocs() {
  return (
    <>
      <section>
        <h3>Обзор</h3>
        <p>
          Раздел <strong>«Запуск»</strong>: создать прогон по готовой сборке или
          загруженному скрипту, указать задачу Jira, смотреть статусы.
        </p>
        <ol>
          <li>
            <strong>Новый запуск</strong> — Jira, скрипт, параметры runner.
          </li>
          <li>
            <strong>Прогоны</strong> — список с фильтром.
          </li>
          <li>
            <strong>Карточка</strong> — детали, ссылки, история событий.
          </li>
        </ol>
      </section>

      <section>
        <h3>Новый запуск</h3>
        <ul>
          <li>
            <strong>Задача в Jira</strong> (<code>test_id</code>) — обязательна.
          </li>
          <li>
            Скрипт: из истории сборок модуля «Сценарий» или загрузка .jmx / .js (+ опционально
            ссылка на git).
          </li>
          <li>
            Движок, имя сценария и Target URL берутся из сборки — заново не вводятся.
          </li>
          <li>
            Для JMeter: память JVM (МБ). Для k6 дополнительных полей нет — профиль уже в
            скрипте.
          </li>
        </ul>
        <p className="hint">
          Сейчас кнопка создаёт карточку прогона (<code>run_id</code>, статус «в очереди»).
          Вызов GitLab Trigger Pipeline будет подключён к той же кнопке.
        </p>
      </section>

      <section>
        <h3>Настройки GitLab (ADMIN)</h3>
        <p>
          ⚙ → <strong>GitLab CI</strong>: URL, project, ветка, пути Vault для trigger token и
          webhook secret, Grafana. Секреты в UI не вводятся. Локально: env{" "}
          <code>GITLAB_TRIGGER_TOKEN</code>, <code>GITLAB_WEBHOOK_SECRET</code>.
        </p>
        <p>
          Webhook: <code>POST /api/runs/webhook/gitlab</code>, заголовок{" "}
          <code>X-Gitlab-Token</code>, события Pipeline.
        </p>
      </section>
    </>
  );
}

function TheoryDocs() {
  return (
    <>
      <section>
        <h3>Зачем нагрузочное тестирование</h3>
        <p>
          Проверить, как система ведёт себя под ожидаемой и пиковой нагрузкой: хватает ли
          мощности, где узкие места, не ломается ли SLA по времени ответа и ошибкам.
          Портал закрывает путь «спека → скрипт → прогон» без ручной сборки .jmx/.js с нуля.
        </p>
      </section>

      <section>
        <h3>Ключевые метрики</h3>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Метрика</th>
              <th>Смысл</th>
              <th>В портале</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>RPS / throughput</td>
              <td>Запросов в секунду</td>
              <td>Целевой RPS групп на шаге интенсивности</td>
            </tr>
            <tr>
              <td>Latency (p95, p99)</td>
              <td>Хвост времени ответа</td>
              <td>Смотрите в Grafana после прогона</td>
            </tr>
            <tr>
              <td>Error rate</td>
              <td>Доля неуспешных ответов</td>
              <td>AutoStop + assertions / checks</td>
            </tr>
            <tr>
              <td>VU / threads</td>
              <td>Параллельные пользователи</td>
              <td>Считаются из RPS и ожидаемой латентности</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>Модели нагрузки</h3>
        <ul>
          <li>
            <strong>Open model (arrival rate)</strong> — задаём поток запросов (RPS). Так
            работает k6 <code>ramping-arrival-rate</code> и Throughput Shaping в JMeter.
            Ближе к реальности «много клиентов независимо».
          </li>
          <li>
            <strong>Closed model (VU)</strong> — фиксированное число пользователей, которые
            ждут ответа и снова идут. Удобно для простых скриптов, но при росте латентности
            throughput падает сам.
          </li>
        </ul>
        <p className="hint">
          В портале профиль строится вокруг <strong>RPS</strong> (open model). Поле
          «ожидаемая латентность» нужно, чтобы оценить число потоков/VU.
        </p>
      </section>

      <section>
        <h3>Режимы в портале</h3>
        <ul>
          <li>
            <strong>Постоянная нагрузка</strong> — разгон до целевого RPS и удержание.
            Типичный smoke / soak / нагрузка «как в проде».
          </li>
          <li>
            <strong>Поиск максимума</strong> — ступени вверх, пока не упрётесь в SLA или
            ошибки. Для оценки потолка системы.
          </li>
        </ul>
      </section>

      <section>
        <h3>Корреляция и реалистичность</h3>
        <p>
          Цепочка login → token → защищённый API должна идти в одной группе запросов:
          экстрактор на ответе, параметр «корреляция» на следующем шаге. Иначе скрипт бьёт
          «пустыми» или устаревшими токенами и greзит картину ошибок.
        </p>
        <ul>
          <li>CSV — разные пользователи/данные без хардкода.</li>
          <li>Path/body из спеки чаще обязательны (*); header/query — по необходимости.</li>
          <li>Assertions/checks — ловят функциональные регрессии под нагрузкой.</li>
        </ul>
      </section>

      <section>
        <h3>AutoStop</h3>
        <p>
          Автоостановка при превышении доли ошибок или среднего времени ответа за окно
          времени. Экономит стенд и сразу фиксирует точку отказа. Включайте на поиск
          максимума и длинных прогонах.
        </p>
      </section>

      <section>
        <h3>Практический чеклист перед прогоном</h3>
        <ol>
          <li>«Пульс сценария» без блокеров; корреляции и CSV согласованы.</li>
          <li>Target URL — стенд, не prod (пока нет модуля «Стенд» — проверяйте base URL).</li>
          <li>Выберите движок: JMeter (плагины на runner) или k6.</li>
          <li>
            Сохраните сборку → «Запуск»: укажите Jira <code>test_id</code>, для JMeter —
            разумный heap.
          </li>
          <li>
            Договоритесь о наблюдаемости: Grafana dashboard в настройках GitLab, метки
            run_id.
          </li>
          <li>
            После прогона сохраните <code>run_id</code> — им будут пользоваться Анализ и
            Отчёт.
          </li>
        </ol>
      </section>

      <section>
        <h3>Типичные ошибки интерпретации</h3>
        <ul>
          <li>
            Рост RPS при росте ошибок — это не «пропускная способность», а деградация.
          </li>
          <li>
            Сравнение p50 без p95/p99 скрывает хвосты, от которых страдают пользователи.
          </li>
          <li>
            Тест с одним пользователем в CSV не выявляет блокировок и contention.
          </li>
          <li>
            Слишком короткий разгон — ложные пики на прогреве кэшей и пулов соединений.
          </li>
        </ul>
      </section>
    </>
  );
}

export function Documentation({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<DocsSectionId>("about");

  if (!open) return null;

  return (
    <div className="docs-overlay" onClick={onClose}>
      <div className="docs-panel panel docs-panel-wide" onClick={(e) => e.stopPropagation()}>
        <div className="docs-head">
          <div>
            <h2>Документация</h2>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              НТ · Портал · справка
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
            {section === "run" && <RunDocs />}
            {section === "theory" && <TheoryDocs />}
            {section === "environment" && <SoonBlock title="Стенд" />}
            {section === "analysis" && <SoonBlock title="Анализ" />}
            {section === "report" && <SoonBlock title="Отчёт" />}
          </div>
        </div>
      </div>
    </div>
  );
}
