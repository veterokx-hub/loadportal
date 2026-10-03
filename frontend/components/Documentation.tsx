"use client";

import { useRef, useState } from "react";

type DocsSectionId =
  | "about"
  | "scenario"
  | "engines"
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
  { id: "engines", label: "Движки", available: true },
  { id: "run", label: "Запуск", available: true },
  { id: "theory", label: "Теория НТ", available: true },
  { id: "environment", label: "Стенд", available: false },
  { id: "analysis", label: "Анализ", available: true },
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
          <strong>JMeter</strong>, <strong>k6</strong> или <strong>Gatling</strong>, прогон
          фиксируется в разделе «Запуск» и связывается с задачей Jira.
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
              <td>доступен</td>
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
            Локальный аккаунт или LDAP. Смена пароля (≥ 8 символов) — только если портал
            её требует при входе.
          </li>
          <li>
            Сессия: Bearer на 3 ч. При истечении сборка в историю не пишется; черновик
            сценария остаётся на устройстве, после входа можно продолжить. Logout очищает
            конструктор.
          </li>
          <li>
            <strong>ADMIN</strong>: пользователи и журнал. LDAP, GitLab и Grafana задаются в Consul и Vault.
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
              <td>Файл .jmx / .js / .zip (сборка или upload)</td>
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
          Мастер из 4 шагов. Модель <code>Scenario</code> общая; JMeter, k6 и Gatling —
          артефакты на финальном шаге, и экран интенсивности перестраивается под выбранный
          движок.
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
            scenario / Gatling scenario.
          </li>
          <li>
            <strong>Целевой RPS</strong> — HTTP-запросы/с на группу. JMeter режет сэмплы
            таймером; k6 и Gatling инжектят итерации, поэтому портал делит:{" "}
            <code>RPS / (сумма ×N)</code> — суммарный HTTP совпадает у всех трёх.
          </li>
          <li>
            <strong>Поиск максимума</strong>: у JMeter и Gatling ступени плоские (TST и{" "}
            <code>incrementUsersPerSec</code>), у k6 между полками короткий разгон — jump в
            ramping-arrival-rate не поддерживается.
          </li>
          <li>
            <strong>Метрики</strong>: JMeter — <code>InfluxdbBackendListenerClient</code> пишет
            Influx line protocol в VictoriaMetrics; k6 — встроенные метрики и{" "}
            <code>portal_errors</code>; Gatling OSS — HTML-отчёт и <code>simulation.log</code>,
            real-time экспорта нет (Graphite удалён в 3.12).
          </li>
          <li>
            <strong>AutoStop</strong>: скользящее окно у JMeter (jpgc-autostop) и у Gatling
            (счётчик в Simulation + <code>crashLoadGeneratorIf</code>). В k6 —
            накопительные <code>portal_errors</code> / <code>http_req_duration</code> после
            задержки проверки, окна нет.
          </li>
          <li>
            Кнопки: <strong>К запуску теста</strong> (основная) → сохраняет сборку и
            открывает «Запуск»; <strong>Сохранить сборку</strong> — в историю;{" "}
            <strong>Выгрузить скрипт</strong> — скачать файл без записи в историю.
          </li>
        </ul>
        <p className="hint">
          JMeter на runner: плагины <code>jpgc-casutg</code>, <code>jpgc-tst</code>, при
          AutoStop — <code>jpgc-autostop</code>. Метрики JMeter пишет штатный InfluxDB listener,
          отдельный jar не нужен.
        </p>
      </section>
    </>
  );
}

function EnginesDocs() {
  return (
    <>
      <section>
        <h3>Общая модель</h3>
        <p>
          Сценарий в портале один. Движок выбирается на шаге «Интенсивность и сборка»: из
          той же модели получаются <strong>JMeter .jmx</strong>, <strong>k6 .js</strong> или{" "}
          <strong>Gatling .zip</strong> (Maven-проект). Целевой RPS везде — HTTP-запросы в
          секунду на группу. Группа — запросы, связанные корреляцией или общим CSV.
        </p>
      </section>

      <section>
        <h3>JMeter</h3>
        <p>
          Классический GUI-инструмент на JVM. Портал собирает Test Plan: каждая группа →
          Concurrency Thread Group + Throughput Shaping Timer. Целевой RPS режется по
          HTTP-сэмплам. Потоки = RPS × ожидаемая латентность. Повторы — Loop Controller.
        </p>
        <p>
          <strong>Артефакт:</strong> <code>.jmx</code>, при CSV — zip с датасетами. Запуск: GUI
          или <code>jmeter -n -t script.jmx</code>. На runner нужны{" "}
          <code>jpgc-casutg</code>, <code>jpgc-tst</code>, для AutoStop —{" "}
          <code>jpgc-autostop</code>. Метрики — штатный{" "}
          <code>InfluxdbBackendListenerClient</code>: POST Influx line protocol на{" "}
          <code>/write</code> VictoriaMetrics.
        </p>
        <p>
          <strong>Постоянная нагрузка:</strong> разгон TST от min(1, RPS) до цели, затем
          полка. <strong>Поиск максимума:</strong> плоские ступени пик/N → пик.
        </p>
        <p>
          <strong>AutoStop:</strong> скользящее окно jpgc-autostop по доле ошибок и среднему
          отклику. <strong>Генераторы:</strong> <code>__UUID</code>, <code>__Random</code>,{" "}
          <code>__RandomString</code>, CounterConfig (один шаг на итерацию потока),{" "}
          <code>__time</code>. Корреляция — JSON / Regex / Boundary Extractor.
        </p>
        <ul>
          <li>
            <strong>Плюсы.</strong> Привычный стек НТ, отладка в GUI, точное управление
            сэмплами, живые метрики в Prometheus, скользящий AutoStop.
          </li>
          <li>
            <strong>Минусы.</strong> Тяжёлый JVM, плагины должны лежать в <code>lib/ext</code>{" "}
            на каждом runner, .jmx плохо читается в diff.
          </li>
          <li>
            <strong>Особенность портала.</strong> Закрытая модель потоков + таймер открытой
            нагрузки: TST режет выдачу, CTG держит нужное число потоков.
          </li>
        </ul>
      </section>

      <section>
        <h3>k6</h3>
        <p>
          Инструмент Grafana Labs: один бинарник, сценарий на JavaScript. Портал собирает
          скрипт, где каждая группа — отдельный k6 scenario с{" "}
          <code>ramping-arrival-rate</code>. k6 инжектит <em>итерации</em>, не HTTP-сэмплы:
          <code>arrival-rate = RPS / (сумма ×N)</code>, чтобы суммарный HTTP совпал с
          JMeter.
        </p>
        <p>
          <strong>Артефакт:</strong> zip со <code>script.js</code>, <code>lib/</code> (k6-utils,
          при CSV ещё PapaParse) и крупными CSV. Запуск из распакованной папки:{" "}
          <code>k6 run script.js</code>. Пул VU = HTTP RPS × латентность × 1.5.
          Метрики — встроенные (<code>http_req_*</code>) плюс <code>portal_errors</code>{" "}
          (провал checks или сеть). Вывод — флаги <code>--out</code>.
        </p>
        <p>
          <strong>Постоянная нагрузка:</strong> разгон arrival от min(1, RPS) до цели, полка.
          <strong>Поиск максимума:</strong> stages со ступенями; между полками короткий
          разгон (~10% длительности ступени) — у executor нет мгновенного jump.
        </p>
        <p>
          <strong>AutoStop:</strong> thresholds с <code>abortOnFail</code> и{" "}
          <code>delayAbortEval</code> по накопительному <code>portal_errors</code> и среднему{" "}
          <code>http_req_duration</code>. <strong>Генераторы:</strong> <code>uuidv4</code>,{" "}
          <code>randomIntBetween</code>, <code>randomString</code>, счётчик на итерацию VU
          (<code>__ITER</code>), timestamp в стиле SimpleDateFormat. CSV — SharedArray.
        </p>
        <ul>
          <li>
            <strong>Плюсы.</strong> Лёгкий CI-раннер, читаемый JS, встроенные метрики и
            thresholds, без зоопарка плагинов.
          </li>
          <li>
            <strong>Минусы.</strong> Нет скользящего окна AutoStop; лестница поиска максимума
            не плоская; нужен запас VU по латентности.
          </li>
          <li>
            <strong>Особенность портала.</strong> Кастомный <code>portal_errors</code>, чтобы
            провал валидации не смешивался с сырым <code>http_req_failed</code>.
          </li>
        </ul>
      </section>

      <section>
        <h3>Gatling</h3>
        <p>
          Инструмент с Java DSL: нагрузка задаётся инъекцией пользователей (открытая
          модель). Портал собирает Maven-проект: каждая группа — Gatling scenario в одном{" "}
          <code>setUp</code>. <code>usersPerSec = RPS / (сумма ×N)</code>. Пользователи
          создаются по мере поступления, пул заранее не считается.
        </p>
        <p>
          <strong>Артефакт:</strong> zip (<code>pom.xml</code> +{" "}
          <code>PortalSimulation.java</code> + CSV + <code>gatling.conf</code>). Запуск:{" "}
          <code>mvn gatling:test</code>, JDK 17+. Метрики прогона — консоль,{" "}
          <code>simulation.log</code>, HTML-отчёт в <code>target/gatling/</code>.{" "}
          <code>runId</code> уходит в <code>runDescription</code>.
        </p>
        <p>
          <strong>Постоянная нагрузка:</strong>{" "}
          <code>rampUsersPerSec</code> + <code>constantUsersPerSec().randomized()</code>.
          <strong>Поиск максимума:</strong>{" "}
          <code>incrementUsersPerSec().times().eachLevelLasting()</code> — плоские полки, как
          TST.
        </p>
        <p>
          <strong>AutoStop:</strong> скользящее окно в Simulation +{" "}
          <code>crashLoadGeneratorIf</code> (ненулевой код выхода) и assertions в конце.
          <strong>Генераторы:</strong> EL <code>randomUuid</code> / <code>randomInt</code> /{" "}
          <code>currentDate</code> на каждый запрос; счётчик — общий фидер на итерацию;
          randomString — новое значение перед HTTP. CSV — <code>csv().circular()</code> или{" "}
          <code>random()</code>.
        </p>
        <ul>
          <li>
            <strong>Плюсы.</strong> Честная открытая модель, нативная лестница, компиляция
            DSL ловит ошибки до прогона, HTML-отчёт из коробки.
          </li>
          <li>
            <strong>Минусы.</strong> На runner нужны JDK и Maven; OSS отдаёт отчёт после
            прогона, не live-скрейп; счётчик общий на всех пользователей.
          </li>
          <li>
            <strong>Особенность портала.</strong> <code>throttle</code> не используется:
            документация Gatling допускает его только для однозапросных сценариев.
          </li>
        </ul>
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
            Для JMeter: память JVM (МБ). Для k6 и Gatling дополнительных полей нет — профиль
            уже в артефакте. Точка входа Gatling — <code>pom.xml</code> проекта из архива.
          </li>
        </ul>
        <p className="hint">
          Сейчас кнопка создаёт карточку прогона (<code>run_id</code>, статус «в очереди»).
          Вызов GitLab Trigger Pipeline будет подключён к той же кнопке.
        </p>
      </section>

      <section>
        <h3>GitLab и LDAP</h3>
        <p>
          В настройках портала этих блоков нет. URL, project, репозиторий, Grafana и параметры
          LDAP читаются из Consul, секреты — из Vault. Локально те же значения можно задать через
          env (<code>GITLAB_TRIGGER_TOKEN</code>, <code>GITLAB_WEBHOOK_SECRET</code> и остальные).
        </p>
        <p>
          Webhook: <code>POST /api/runs/webhook/gitlab</code>, заголовок{" "}
          <code>X-Gitlab-Token</code>, события Pipeline.
        </p>
      </section>
    </>
  );
}

function AnalysisDocs() {
  return (
    <>
      <section>
        <h3>Зачем</h3>
        <p>
          Раздел <strong>«Анализ»</strong> читает метрики тестируемого сервиса за время
          прогона и отвечает текстом: что пошло не так и куда смотреть. Он не заменяет
          Grafana — он избавляет от необходимости листать двадцать графиков, чтобы понять,
          с какого начать.
        </p>
        <p>
          Ключевая мысль: «график вырос» — это не аномалия. Под нагрузкой всё растёт.
          Аномалия — когда поведение расходится с нормой <em>этого же</em> прогона: на
          постоянной нагрузке метрика ползёт вверх, уровень скачком уехал от медианы,
          нарушен явный порог.
        </p>
      </section>

      <section>
        <h3>Что подать на вход</h3>
        <ul>
          <li>
            <strong>Прогон портала</strong> — цель и окно берутся из карточки. Если у прогона
            заполнены cluster / namespace / service, отчёт соберётся автоматически по
            завершении теста.
          </li>
          <li>
            <strong>Ссылка на дашборд Grafana</strong> — из адреса вытаскиваются переменные
            (<code>var-cluster</code>, <code>var-namespace</code>, <code>var-service</code>,{" "}
            <code>var-container</code>) и период <code>from</code>/<code>to</code>. По ссылке
            портал не ходит, только парсит её.
          </li>
          <li>
            <strong>Руками</strong> — кластер, namespace, сервис, контейнер и период.
          </li>
        </ul>
        <p className="hint">
          Тип теста меняет логику: на плато ищется дрейф, в поиске максимума — точка перелома
          и первый упёршийся ресурс. SLO из формы подставляются в пороги правил.
        </p>
      </section>

      <section>
        <h3>Как читать отчёт</h3>
        <ol>
          <li>
            <strong>Вердикт и оценка</strong> — одна фраза и число 0–100. Больше ничего
            читать не обязательно, если оценка 100.
          </li>
          <li>
            <strong>Фазы</strong> — полоса прогрева, разгона, плато и спада с засечками
            находок. Проблема на прогреве и через сорок минут плато — разные диагнозы.
            Прогрев и хвост после остановки генератора заштрихованы: они исключены из выводов.
          </li>
          <li>
            <strong>Гипотезы</strong> — сопоставление формы метрик с известными паттернами
            отказов (утечка, пул соединений, троттлинг). У каждой — процент совпадения и
            список того, что проверить в коде.
          </li>
          <li>
            <strong>Цепочки</strong> — что за чем потянулось. Пять находок от одной причины
            собираются в один сюжет, а не в пять проблем.
          </li>
          <li>
            <strong>Находки</strong> — карточка с мини-графиком, числами и запросом
            MetricsQL: вывод можно перепроверить руками.
          </li>
          <li>
            <strong>Покрытие</strong> — сколько рядов реально удалось прочитать. Вердикт
            «всё чисто» стоит ровно столько.
          </li>
        </ol>
      </section>

      <section>
        <h3>Детекторы</h3>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Детектор</th>
              <th>Что ищет</th>
              <th>Как</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Сдвиг уровня</td>
              <td>Метрика скачком ушла от своей медианы внутри фазы</td>
              <td>Робастная z-оценка по медиане и MAD + требование продержаться</td>
            </tr>
            <tr>
              <td>Дрейф</td>
              <td>Устойчивый тренд на постоянной нагрузке — признак утечки</td>
              <td>Наклон по Тейлу–Сену + критерий Манна–Кендалла</td>
            </tr>
            <tr>
              <td>Правило</td>
              <td>Нарушен порог: SLO, лимит контейнера, очередь за соединением</td>
              <td>Декларативные инварианты из каталога</td>
            </tr>
            <tr>
              <td>Событие</td>
              <td>Рестарт пода, троттлинг, срабатывание autostop</td>
              <td>Скачки счётчиков и признаки перезапуска</td>
            </tr>
            <tr>
              <td>Ёмкость</td>
              <td>Максимальный держащийся RPS и первый упёршийся ресурс</td>
              <td>Сравнение ступеней поиска максимума</td>
            </tr>
          </tbody>
        </table>
        <p className="hint">
          Медиана и MAD вместо среднего и σ выбраны намеренно: одиночный сетевой всплеск не
          должен раздувать оценку разброса и глушить настоящие находки.
        </p>
      </section>

      <section>
        <h3>Почему модуль молчит</h3>
        <ul>
          <li>Отклонение не продержалось — всплеск, а не сдвиг уровня.</li>
          <li>Амплитуда ниже порога: 2 % от базы никому не интересны.</li>
          <li>Фаза исключена — прогрев или хвост после остановки генератора.</li>
          <li>
            Есть находка информативнее: насыщение от лимита вместо сырого значения,
            нарушение правила вместо статистики.
          </li>
        </ul>
        <p>
          Всё отсеянное перечислено в отчёте блоком «Отброшено как шум» — с причиной.
          Молчащий детектор вызывает подозрение, «видел, но отбросил вот почему» — доверие.
        </p>
      </section>

      <section>
        <h3>Демо-режим</h3>
        <p>
          Галочка <strong>«Показать на демо-данных»</strong> собирает синтетический прогон с
          заранее заложенным дефектом: утечка, пул соединений, троттлинг или здоровый тест.
          Кластер и источник метрик не нужны — удобно понять, что модуль выдаёт, до
          подключения к реальному стенду. Отчёт помечен как демонстрационный.
        </p>
      </section>

      <section>
        <h3>Границы</h3>
        <ul>
          <li>
            Гипотеза — это гипотеза. Модуль видит поведение сервиса снаружи; подтвердить
            или опровергнуть можно только в коде.
          </li>
          <li>
            Без метрик выводов нет. Если в источнике нет GC или пула соединений, соответствующие
            паттерны не сработают — это видно в блоке покрытия.
          </li>
          <li>
            Отчёт неизменяем и хранит версию правил: при изменении каталога старые отчёты
            остаются такими, какими их прочитали.
          </li>
        </ul>
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
            <strong>Open model (arrival rate)</strong> — задаём поток HTTP-запросов (RPS).
            JMeter режет сэмплы таймером. k6 и Gatling задают старты итерации группы: портал
            делит целевой RPS на число HTTP за итерацию, чтобы цифры совпали. У Gatling пул
            пользователей не нужен — они создаются по мере поступления.
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
          <li>
            Выберите движок: JMeter (плагины на runner), k6 или Gatling (JDK 17+ и Maven на
            runner).
          </li>
          <li>
            Сохраните сборку → «Запуск»: укажите Jira <code>test_id</code>, для JMeter —
            разумный heap.
          </li>
          <li>
            Договоритесь о наблюдаемости: Grafana задаётся в Consul, метка прогона — run_id.
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
  const overlayMouseDown = useRef(false);
  const [section, setSection] = useState<DocsSectionId>("about");

  if (!open) return null;

  return (
    <div
      className="docs-overlay"
      onMouseDown={(e) => {
        overlayMouseDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (overlayMouseDown.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="docs-panel panel docs-panel-wide">
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
            {section === "engines" && <EnginesDocs />}
            {section === "run" && <RunDocs />}
            {section === "theory" && <TheoryDocs />}
            {section === "environment" && <SoonBlock title="Стенд" />}
            {section === "analysis" && <AnalysisDocs />}
            {section === "report" && <SoonBlock title="Отчёт" />}
          </div>
        </div>
      </div>
    </div>
  );
}
