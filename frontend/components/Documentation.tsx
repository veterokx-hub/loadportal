"use client";

import { useRef, useState } from "react";

type DocsSectionId =
  | "about"
  | "scenario"
  | "engines"
  | "jmeter"
  | "k6"
  | "gatling"
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
  { id: "jmeter", label: "JMeter", available: true },
  { id: "k6", label: "k6", available: true },
  { id: "gatling", label: "Gatling", available: true },
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
          тестов. Сценарий из OpenAPI или Postman собирается в скрипт{" "}
          <strong>JMeter</strong>, <strong>k6</strong> или <strong>Gatling</strong>. Прогон
          запускается в GitLab CI из раздела «Запуск» и привязывается к задаче Jira.
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
              <td>Прогон в GitLab CI по сборке или скрипту, статусы</td>
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
          У каждого раздела и шага свой адрес, кнопка «Назад» в браузере работает. Справка и
          настройки открываются поверх страницы.
        </p>
      </section>

      <section>
        <h3>Вход и роли</h3>
        <ul>
          <li>
            Вход по локальному аккаунту или через LDAP. После сброса пароля администратором
            портал попросит задать новый (от 8 символов).
          </li>
          <li>
            Сессия длится 3 ч. Если она истекла, черновик сценария остаётся в браузере — после
            входа можно продолжить. Выход очищает черновик.
          </li>
          <li>
            <strong>ADMIN</strong> — пользователи и журнал действий. Настройки LDAP, GitLab и
            Grafana хранятся в Consul и Vault.
          </li>
          <li>
            <strong>USER</strong> — сценарии и свои прогоны. В истории хранятся до 30 последних
            сборок; срок хранения задаётся на сервере (по умолчанию 30 дней) и виден в шапке
            истории.
          </li>
          <li>
            LDAP: логин — sAMAccountName. Роли из AD не подтягиваются: новый LDAP-пользователь
            получает USER, роль меняет ADMIN.
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
              <td>Файл .jmx, .js, .ts или .zip (из сборки или загруженный)</td>
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
          Мастер из 4 шагов. Сценарий общий для всех движков: JMeter, k6 или Gatling
          выбирается на последнем шаге, и экран интенсивности подстраивается под него.
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
            <strong>Интенсивность и сборка</strong> — RPS, AutoStop, сохранение, выгрузка и
            переход к запуску.
          </li>
        </ol>
        <p>
          <strong>Пульс сценария</strong> над шагами показывает готовность 0–100 и блокеры.
          Блокеры не мешают сохранить и выгрузить сборку, но перед запуском их лучше исправить.
        </p>
      </section>

      <section>
        <h3>Источник и запросы</h3>
        <ul>
          <li>
            OpenAPI — URL (JSON/YAML, Swagger UI) или вставка текста. Postman — только
            JSON-коллекция, без URL.
          </li>
          <li>
            <code>{"{id}"}</code> в пути становится Path-параметром с именем из URL. Header,
            Query и Body добавляются на шаге 3.
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
          <li>Проверка ответа: HTTP-код и, при желании, подстрока в теле.</li>
          <li>Кнопка «Далее» неактивна, пока не заполнены обязательные параметры.</li>
          <li>
            Как каждая настройка этого шага попадает в скрипт — в разделах{" "}
            <strong>JMeter</strong>, <strong>k6</strong> и <strong>Gatling</strong>.
          </li>
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
            Группа — запросы, связанные корреляцией или общим CSV. В JMeter это Thread Group,
            в k6 и Gatling — scenario.
          </li>
          <li>
            <strong>Целевой RPS</strong> — HTTP-запросов в секунду на группу. JMeter дозирует
            сэмплы таймером, а k6 и Gatling запускают итерации, поэтому портал делит{" "}
            <code>RPS / (сумма ×N)</code> — итоговый поток HTTP у всех трёх одинаков.
          </li>
          <li>
            <strong>Поиск максимума</strong>: у JMeter и Gatling ступени плоские (TST и{" "}
            <code>incrementUsersPerSec</code>), у k6 между полками короткий разгон — мгновенного
            скачка в ramping-arrival-rate нет.
          </li>
          <li>
            <strong>Метрики</strong>: JMeter пишет в VictoriaMetrics через{" "}
            <code>InfluxdbBackendListenerClient</code>, k6 — встроенные метрики и{" "}
            <code>portal_errors</code> через Prometheus remote write. Gatling OSS даёт только
            HTML-отчёт и <code>simulation.log</code> (Graphite удалён в 3.12).
          </li>
          <li>
            <strong>AutoStop</strong>: скользящее окно у JMeter (jpgc-autostop) и у Gatling
            (счётчик в Simulation + <code>crashLoadGeneratorIf</code>). В k6 —
            накопительные <code>portal_errors</code> / <code>http_req_duration</code> после
            задержки проверки, окна нет.
          </li>
          <li>
            <strong>К запуску</strong> сохраняет сборку и открывает «Запуск»;{" "}
            <strong>Сохранить сборку</strong> — только в историю;{" "}
            <strong>Выгрузить скрипт</strong> — скачать файл без записи в историю.
          </li>
        </ul>
        <p className="hint">
          Для JMeter на runner нужны плагины <code>jpgc-casutg</code>, <code>jpgc-tst</code>, при
          AutoStop — <code>jpgc-autostop</code>. Для метрик отдельный jar не нужен.
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
          <strong>Gatling .zip</strong> (Maven-проект). Целевой RPS везде — HTTP-запросов в
          секунду на группу. Группа — запросы, связанные корреляцией или общим CSV.
        </p>
      </section>

      <section>
        <h3>JMeter</h3>
        <p>
          Классический GUI-инструмент на JVM. Портал собирает Test Plan: каждая группа →
          Concurrency Thread Group + Throughput Shaping Timer. Целевой RPS дозируется по
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
            сэмплами, метрики в VictoriaMetrics по ходу прогона, скользящий AutoStop.
          </li>
          <li>
            <strong>Минусы.</strong> Тяжёлый JVM, плагины должны лежать в <code>lib/ext</code>{" "}
            на каждом runner, .jmx плохо читается в diff.
          </li>
          <li>
            <strong>Особенность портала.</strong> Закрытая модель потоков + таймер открытой
            нагрузки: TST ограничивает выдачу, CTG держит нужное число потоков.
          </li>
        </ul>
      </section>

      <section>
        <h3>k6</h3>
        <p>
          Инструмент Grafana Labs: один бинарник, сценарий на JavaScript. Портал собирает
          скрипт, где каждая группа — отдельный k6 scenario с{" "}
          <code>ramping-arrival-rate</code>. k6 запускает <em>итерации</em>, а не HTTP-сэмплы:{" "}
          <code>arrival-rate = RPS / (сумма ×N)</code>, чтобы суммарный поток HTTP совпал с
          JMeter.
        </p>
        <p>
          <strong>Артефакт:</strong> zip со <code>script.js</code>, <code>vm.json</code> (адрес
          VictoriaMetrics), <code>lib/</code> (k6-utils, при CSV ещё PapaParse) и крупными CSV.
          Запуск из распакованной папки: <code>k6 run script.js</code>. Пул VU = HTTP RPS ×
          латентность × 1,5. Метрики — встроенные (<code>http_req_*</code>) плюс{" "}
          <code>portal_errors</code> (провал checks или сетевая ошибка), в VictoriaMetrics
          уходят через <code>experimental-prometheus-rw</code>.
        </p>
        <p>
          <strong>Постоянная нагрузка:</strong> разгон arrival от min(1, RPS) до цели, полка.{" "}
          <strong>Поиск максимума:</strong> stages со ступенями; между полками короткий
          разгон (~10 % длительности ступени) — мгновенного скачка у executor нет.
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
          <code>rampUsersPerSec</code> + <code>constantUsersPerSec().randomized()</code>.{" "}
          <strong>Поиск максимума:</strong>{" "}
          <code>incrementUsersPerSec().times().eachLevelLasting()</code> — плоские полки, как
          TST.
        </p>
        <p>
          <strong>AutoStop:</strong> скользящее окно в Simulation +{" "}
          <code>crashLoadGeneratorIf</code> (ненулевой код выхода) и assertions в конце.{" "}
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
            <strong>Минусы.</strong> На runner нужны JDK и Maven; в OSS метрики доступны
            только после прогона; счётчик общий на всех пользователей.
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

function JmeterParamsDocs() {
  return (
    <>
      <section>
        <h3>Корреляция и параметры</h3>
        <p>
          Шаг общий для всех движков. В JMeter из него собирается HTTP Request, Header
          Manager, экстракторы и CSV Data Set внутри группы потоков.
        </p>
        <p>
          <code>{"{имя}"}</code> в пути и теле заменяется значением параметра.{" "}
          <code>{"${имя}"}</code> остаётся переменной JMeter и подставляется уже в рантайме.
        </p>
      </section>

      <section>
        <h3>Куда попадает параметр</h3>
        <ul>
          <li>
            <strong>Path.</strong> <code>{"{имя}"}</code> вписывается в <code>HTTPSampler.path</code>.
            Свой URL запроса заменяет базовый адрес.
          </li>
          <li>
            <strong>Query.</strong> Аргумент HTTP Request (<code>HTTPArgument</code>),{" "}
            <code>always_encode</code> выключен: значение уходит как есть. Пустое имя
            пропускается.
          </li>
          <li>
            <strong>Header.</strong> HTTP Header Manager. Параметр с тем же именем
            перекрывает заголовок, пришедший из импорта.
          </li>
          <li>
            <strong>Body.</strong> <code>{"{имя}"}</code> заменяется в сыром теле (
            <code>postBodyRaw</code>). Если у тела задан Content-Type и такого заголовка ещё
            нет, он добавляется.
          </li>
        </ul>
      </section>

      <section>
        <h3>Константа</h3>
        <p>
          Строка попадает в запрос без обработки порталом. <code>{"${переменная}"}</code> и{" "}
          <code>{"${__функция()}"}</code> вычисляет сам JMeter.
        </p>
      </section>

      <section>
        <h3>Генератор</h3>
        <ul>
          <li>
            <strong>UUID</strong> — <code>{"${__UUID()}"}</code>.
          </li>
          <li>
            <strong>Случайное число</strong> — <code>{"${__Random(мин,макс)}"}</code>. Оба края
            входят. Пустые поля — 0 и 1&nbsp;000&nbsp;000.
          </li>
          <li>
            <strong>Случайная строка</strong> —{" "}
            <code>{"${__RandomString(длина,алфавит)}"}</code>. Длина по умолчанию 8, алфавит —
            латинские строчные и цифры. Новое значение на каждый запрос.
          </li>
          <li>
            <strong>Счётчик</strong> — <code>CounterConfig</code> на группу, отдельный на
            каждый поток (<code>per_user</code>). В запрос подставляется{" "}
            <code>{"${имя параметра}"}</code>. Одно значение на итерацию потока: повторы ×N его
            не увеличивают. Максимум 0 — без потолка, после максимума счёт начинается со
            старта. Формат — маска счётчика, например <code>000</code>.
          </li>
          <li>
            <strong>Метка времени</strong> — <code>{"${__time(формат)}"}</code>. Пустой формат —
            миллисекунды. Текст формата — SimpleDateFormat.
          </li>
        </ul>
      </section>

      <section>
        <h3>Корреляция</h3>
        <p>
          Источник «Корреляция» записывается как <code>{"${переменная}"}</code>. Переменная
          появляется, когда экстрактор предыдущего запроса той же группы сохранил ответ под
          этим именем.
        </p>
      </section>

      <section>
        <h3>CSV</h3>
        <p>
          Колонка становится <code>{"${колонка}"}</code>. Датасет, привязанный к запросу, —
          элемент на группе: одна строка на итерацию, её видят все запросы группы.
        </p>
        <ul>
          <li>
            <strong>По порядку</strong> — CSV Data Set Config: разделитель запятая,{" "}
            <code>quotedData</code>, первая строка — заголовки, <code>recycle</code>, общий
            на все потоки (<code>shareMode.all</code>).
          </li>
          <li>
            <strong>Случайный порядок</strong> — плагин bzm Random CSV Data Set. У него нет
            рабочей настройки кавычек, поэтому файл пишется без кавычек, а разделитель
            выбирается так, чтобы его не было в ячейках.
          </li>
        </ul>
      </section>

      <section>
        <h3>Извлечь из ответа</h3>
        <p>
          Экстрактор висит на сэмплере и пишет переменную потока. В форме номер совпадения
          всегда 1, запасное значение — <code>NOT_FOUND</code>. Если в сценарии заданы другие,
          в .jmx уходят они.
        </p>
        <ul>
          <li>
            <strong>JSONPath</strong> — JSON Extractor: выражение, номер совпадения, default.
          </li>
          <li>
            <strong>Regex</strong> — Regex Extractor по телу ответа, шаблон <code>$1$</code>{" "}
            (первая группа).
          </li>
          <li>
            <strong>Boundary</strong> — выражение <code>слева|справа</code> режется по первой
            вертикальной черте и кладётся в Boundary Extractor.
          </li>
        </ul>
      </section>

      <section>
        <h3>Проверка ответа</h3>
        <ul>
          <li>
            <strong>Код</strong> — Response Assertion по полю кода, сравнение Equals.
          </li>
          <li>
            <strong>Тело содержит</strong> — Response Assertion по телу, тип Contains.
          </li>
        </ul>
      </section>

      <section>
        <h3>Одинаковые имена</h3>
        <p>
          Два query-параметра с одним именем уходят двумя аргументами. В пути и теле{" "}
          <code>{"{имя}"}</code> заменяется первым параметром с этим именем: после замены
          скобок в строке уже нет. Заголовок с тем же именем остаётся один, его значение берётся
          из параметра. Счётчик, колонка CSV и экстрактор с одним именем пишут в одну переменную
          потока и затирают друг друга.
        </p>
      </section>
    </>
  );
}

function K6ParamsDocs() {
  return (
    <>
      <section>
        <h3>Корреляция и параметры</h3>
        <p>
          Группа становится функцией <code>export function groupN()</code>. На итерацию
          заводятся объект <code>vars</code> для извлечений и объект <code>row</code> для
          строки CSV. Запросы группы идут друг за другом внутри этой функции.
        </p>
        <p>
          <code>{"{имя}"}</code> в пути и теле склеивается в JS-выражение и в текст скрипта
          плейсхолдером не остаётся. <code>{"${имя}"}</code> внутри константы разбирает{" "}
          <code>interp</code> уже во время прогона.
        </p>
      </section>

      <section>
        <h3>Куда попадает параметр</h3>
        <ul>
          <li>
            <strong>Path.</strong> Значение <code>{"{имя}"}</code> проходит через{" "}
            <code>encodeURIComponent</code>. Собственный URL запроса не склеивается с базовым.
          </li>
          <li>
            <strong>Query.</strong> Пары попадают в query-string, значение кодируется{" "}
            <code>encodeURIComponent</code>.
          </li>
          <li>
            <strong>Header.</strong> Сначала заголовки из импорта, затем параметры. Одинаковое
            имя перекрывается параметром.
          </li>
          <li>
            <strong>Body.</strong> <code>{"{имя}"}</code> подставляется без URL-кодирования.
            Если в теле нет таких скобок, весь текст проходит через <code>interp</code>.
            Content-Type из тела ставится, только если заголовка ещё нет.
          </li>
        </ul>
      </section>

      <section>
        <h3>Константа</h3>
        <p>
          <code>interp</code> заменяет <code>{"${имя}"}</code> из <code>vars</code>, затем из
          строки CSV. Узнаёт функции JMeter: <code>__UUID</code>, <code>__Random</code>,{" "}
          <code>__RandomString</code>, <code>__time</code>.
        </p>
      </section>

      <section>
        <h3>Генератор</h3>
        <ul>
          <li>
            <strong>UUID</strong> — <code>uuidv4()</code> из k6-utils.
          </li>
          <li>
            <strong>Случайное число</strong> — <code>randomIntBetween(мин, макс)</code>, оба
            края входят.
          </li>
          <li>
            <strong>Случайная строка</strong> — <code>randomString(длина, алфавит)</code>.
            Новое значение на каждый запрос.
          </li>
          <li>
            <strong>Счётчик</strong> — <code>nextCounter</code> по имени параметра. Одно
            значение на итерацию VU (<code>__ITER</code>), не на каждый HTTP: повторы ×N
            видят одно и то же число. Максимум 0 — без потолка. Формат — длина маски:{" "}
            <code>000</code> дополняет число нулями слева до трёх знаков.
          </li>
          <li>
            <strong>Метка времени</strong> — <code>tsFormat</code>. Пустой формат —
            миллисекунды. Разбираются токены <code>yyyy</code>, <code>MM</code>,{" "}
            <code>dd</code>, <code>HH</code>, <code>mm</code>, <code>ss</code>; текст в
            одинарных кавычках, как <code>&apos;T&apos;</code>, остаётся как есть. Это не
            полный SimpleDateFormat.
          </li>
        </ul>
      </section>

      <section>
        <h3>Корреляция</h3>
        <p>
          Источник читает <code>vars[переменная]</code>. Если извлечения не было, в запрос
          уходит пустая строка. <code>vars</code> живёт одну итерацию группы и не виден
          соседней группе.
        </p>
      </section>

      <section>
        <h3>CSV</h3>
        <p>
          Датасет — <code>SharedArray</code>. Небольшой набор вписан в скрипт, большой читается
          PapaParse из файла рядом со скриптом (первая строка — имена колонок). На итерацию
          группы берётся одна строка: случайный индекс или{" "}
          <code>iterationInTest % длина</code>. Источник «CSV» — поле <code>row[колонка]</code>.
        </p>
      </section>

      <section>
        <h3>Извлечь из ответа</h3>
        <p>
          После <code>http.request</code> результат пишется в <code>vars</code>. Номер
          совпадения в форме — 1, запасное значение — <code>NOT_FOUND</code>.
        </p>
        <ul>
          <li>
            <strong>JSONPath</strong> — обход <code>$.a.b[0]</code> по точкам и индексам.
            Фильтров, рекурсии и условий JSONPath нет: такое выражение вернёт default.
          </li>
          <li>
            <strong>Regex</strong> — поиск по телу. Если в выражении есть группа, берётся она,
            иначе всё совпадение. Номер считается с 1.
          </li>
          <li>
            <strong>Boundary</strong> — <code>слева|справа</code> собирается в нежадную
            регулярку и читается тем же способом, что Regex.
          </li>
        </ul>
      </section>

      <section>
        <h3>Проверка ответа</h3>
        <p>
          Код и подстрока тела — это <code>check</code>. Тот же провал, плюс статус 0, попадает
          в <code>portal_errors</code>. Сырой <code>http_req_failed</code> для этого не
          используется: провал проверки и сетевой обрыв считаются отдельно.
        </p>
      </section>

      <section>
        <h3>Одинаковые имена</h3>
        <p>
          В пути и теле при двух параметрах с одним именем в склейку попадает последний. Два
          query с одним именем уходят двумя парами. Счётчик, колонка и переменная извлечения с
          одним именем делят одну ячейку <code>vars</code> или счётчика и перезаписывают её.
        </p>
      </section>
    </>
  );
}

function GatlingParamsDocs() {
  return (
    <>
      <section>
        <h3>Корреляция и параметры</h3>
        <p>
          Группа — <code>scenario(...)</code> в <code>PortalSimulation.java</code>. Значения
          попадают в сессию и читаются Gatling EL: <code>{"#{имя}"}</code>. Портал заранее
          переводит <code>{"${имя}"}</code> из констант в этот синтаксис.
        </p>
        <p>
          <code>{"{имя}"}</code> в пути и теле заменяется выражением EL до того, как строка
          попадёт в <code>http(...)</code>. Уже записанные <code>{"#{…}"}</code> и{" "}
          <code>{"${…}"}</code> при этой замене не трогаются.
        </p>
      </section>

      <section>
        <h3>Куда попадает параметр</h3>
        <ul>
          <li>
            <strong>Path.</strong> Значение встраивается в URL запроса. Собственный URL
            заменяет базовый.
          </li>
          <li>
            <strong>Query.</strong> <code>.queryParam(имя, значение)</code>. Кодирование
            выполняет Gatling.
          </li>
          <li>
            <strong>Header.</strong> <code>.header</code>. Параметр перекрывает заголовок с
            тем же именем.
          </li>
          <li>
            <strong>Body.</strong> <code>StringBody</code> после замены <code>{"{имя}"}</code>.
            Content-Type из тела добавляется, если такого заголовка нет.
          </li>
        </ul>
      </section>

      <section>
        <h3>Константа</h3>
        <p>
          <code>{"${переменная}"}</code> становится <code>{"#{переменная}"}</code> и читается из
          сессии. Функции вида <code>{"${__UUID()}"}</code> Gatling не вычисляет: для
          генерации нужно выбрать источник «Генератор», а не вписать функцию JMeter в
          константу.
        </p>
      </section>

      <section>
        <h3>Генератор</h3>
        <ul>
          <li>
            <strong>UUID</strong> — <code>{"#{randomUuid()}"}</code>.
          </li>
          <li>
            <strong>Случайное число</strong> — <code>{"#{randomInt(мин, макс+1)}"}</code>. У
            Gatling верхняя граница не входит, у портала входит, поэтому к максимуму
            прибавляется 1.
          </li>
          <li>
            <strong>Случайная строка</strong> — <code>session.set</code> непосредственно перед
            HTTP. Новое значение на каждый запрос. Длина по умолчанию 8, алфавит — латинские
            строчные и цифры.
          </li>
          <li>
            <strong>Счётчик</strong> — общий <code>AtomicLong</code> на всех виртуальных
            пользователей и фидер <code>GENERATED_VALUES</code>. Одно значение на итерацию
            сценария, повторы ×N его не двигают. В запрос попадает{" "}
            <code>{"#{имя параметра}"}</code>. Максимум 0 — без потолка. Формат задаёт число
            ведущих нулей длиной маски.
          </li>
          <li>
            <strong>Метка времени</strong> — пустой формат даёт{" "}
            <code>{"#{currentTimeMillis()}"}</code>. Иначе{" "}
            <code>{"#{currentDate(шаблон)}"}</code>. Шаблон из посторонних символов заменяется
            на <code>yyyy-MM-dd&apos;T&apos;HH:mm:ss</code>.
          </li>
        </ul>
      </section>

      <section>
        <h3>Корреляция</h3>
        <p>
          Источник — <code>{"#{переменная}"}</code>. Имя в EL очищается до букв, цифр и
          подчёркивания; если оно начинается с цифры, спереди добавляется <code>v_</code>. То
          же имя использует <code>saveAs</code> у извлечения.
        </p>
      </section>

      <section>
        <h3>CSV</h3>
        <p>
          Файл лежит в <code>src/test/resources</code>. По порядку —{" "}
          <code>csv(...).circular()</code>, случайно — <code>random()</code>.{" "}
          <code>.feed</code> стоит на сценарии: одна строка на итерацию, все запросы группы
          читают её как <code>{"#{колонка}"}</code>.
        </p>
      </section>

      <section>
        <h3>Извлечь из ответа</h3>
        <p>
          Это <code>check(...).find(n).withDefault(...).saveAs(...)</code>. Номер в Gatling
          считается с нуля, поэтому портал передаёт номер совпадения минус 1. В форме номер —
          1, default — <code>NOT_FOUND</code>.
        </p>
        <ul>
          <li>
            <strong>JSONPath</strong> — <code>jsonPath(выражение)</code>.
          </li>
          <li>
            <strong>Regex</strong> — <code>regex(выражение)</code>.
          </li>
          <li>
            <strong>Boundary</strong> — <code>слева|справа</code> превращается в{" "}
            <code>regex(слева(.*?)справа)</code>, границы экранируются.
          </li>
        </ul>
      </section>

      <section>
        <h3>Проверка ответа</h3>
        <ul>
          <li>
            <strong>Код</strong> — <code>status().is(код)</code>.
          </li>
          <li>
            <strong>Тело содержит</strong> — <code>substring(текст).exists()</code>.
          </li>
        </ul>
      </section>

      <section>
        <h3>Одинаковые имена</h3>
        <p>
          Два query с одним именем — два <code>queryParam</code>. В пути и теле{" "}
          <code>{"{имя}"}</code> заменяется первым параметром с этим именем. Общий счётчик и{" "}
          <code>saveAs</code> с тем же именем пишут в одну переменную сессии.
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
          Раздел <strong>«Запуск»</strong> запускает тест в GitLab CI по готовой сборке или
          загруженному скрипту и показывает статусы прогонов.
        </p>
        <ol>
          <li>
            <strong>Новый запуск</strong> — Jira, скрипт, время, сервис и ресурсы runner.
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
            Скрипт — из истории сборок или файл .jmx, .js, .ts или .zip. Для файла выберите
            движок: по .zip его не определить.
          </li>
          <li>
            Движок, имя сценария и Target URL берутся из сборки — заново не вводятся.
          </li>
          <li>
            Кластер, namespace, сервис и контейнер нужны модулю «Анализ». Если они заполнены,
            отчёт соберётся сам после окончания теста.
          </li>
          <li>
            CPU и Memory — ресурсы runner; хип JVM образ берёт как долю от Memory. Профиль нагрузки
            уже в скрипте. Точка входа Gatling — <code>pom.xml</code> из архива.
          </li>
        </ul>
        <p className="hint">
          «Запустить тест» создаёт прогон (<code>run_id</code>), кладёт скрипт в S3 и запускает
          пайплайн GitLab CI. Статусы приходят из GitLab через webhook.
        </p>
      </section>

      <section>
        <h3>GitLab и LDAP</h3>
        <p>
          Настройки GitLab, Grafana и LDAP задаются не в портале: параметры — в Consul, секреты —
          в Vault. Локально их можно передать через переменные окружения (
          <code>GITLAB_TRIGGER_TOKEN</code>, <code>GITLAB_WEBHOOK_SECRET</code> и другие).
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
          Портал проводит по пути «спецификация → скрипт → прогон» без написания скрипта с нуля.
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
            <strong>Open model (arrival rate)</strong> — задаём поток HTTP-запросов (RPS). k6 и
            Gatling задают старты итераций, поэтому портал делит RPS на число запросов в
            итерации — поток совпадает с JMeter.
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
          «пустыми» или устаревшими токенами и искажает картину ошибок.
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
          времени. Бережёт стенд и фиксирует точку отказа. Включайте для поиска максимума и
          длинных прогонов.
        </p>
      </section>

      <section>
        <h3>Практический чеклист перед прогоном</h3>
        <ol>
          <li>«Пульс сценария» без блокеров; корреляции и CSV согласованы.</li>
          <li>Target URL ведёт на стенд, а не в prod: модуля «Стенд» пока нет, проверьте адрес сами.</li>
          <li>
            Выберите движок: JMeter (плагины на runner), k6 или Gatling (JDK 17+ и Maven на
            runner).
          </li>
          <li>
            Сохраните сборку и перейдите в «Запуск»: укажите задачу Jira (<code>test_id</code>)
            и сервис в кластере для «Анализа».
          </li>
          <li>
            Проверьте наблюдаемость: Grafana задаётся в Consul, метка прогона —{" "}
            <code>run_id</code>.
          </li>
          <li>
            После прогона сохраните <code>run_id</code> — по нему работают «Анализ» и будущий
            «Отчёт».
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
          <button type="button" className="ghost small" onClick={onClose} aria-label="Закрыть">
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
            {section === "jmeter" && <JmeterParamsDocs />}
            {section === "k6" && <K6ParamsDocs />}
            {section === "gatling" && <GatlingParamsDocs />}
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
