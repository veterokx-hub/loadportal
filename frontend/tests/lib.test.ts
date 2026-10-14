import assert from "node:assert/strict";
import test from "node:test";

import { analyzeScenario } from "../lib/readiness.ts";
import { groupRequests, groupTitle } from "../lib/grouping.ts";
import {
  arrivalRate,
  formatRps,
  groupProfile,
  iterationWeights,
  samplesPerIteration,
  totalDuration,
} from "../lib/profile.ts";
import { bracesIn, consolidateRequestParams, paramsFromTemplates } from "../lib/request-params.ts";
import { clashMessage, scriptVarClashes, scriptWriters } from "../lib/script-vars.ts";
import { duplicateRequestName } from "../lib/request-copy.ts";
import { jmeterToParamSource } from "../lib/render-jmeter.ts";
import { safeHttpHref } from "../lib/safe-url.ts";
import type { RequestModel, Scenario } from "../lib/types.ts";

function request(over: Partial<RequestModel> & Pick<RequestModel, "id" | "order" | "name">): RequestModel {
  return {
    method: "GET",
    path: "/",
    headers: [],
    query_params: [],
    body: { mode: "none", content: "" },
    params: [],
    extractions: [],
    intensity: { target_rps: 10, ramp_up_sec: 0, hold_sec: 30 },
    validation: { check_response_code: true, expected_status: 200, response_contains: "" },
    repeat: 1,
    ...over,
  };
}

function scenario(requests: RequestModel[], over: Partial<Scenario> = {}): Scenario {
  return {
    name: "demo",
    source_type: "openapi",
    base_url: "https://api.example",
    load: { test_mode: "ramp_hold", steps: 4, step_duration_sec: 60, assumed_latency_sec: 1 },
    datasets: [],
    autostop: {
      enabled: true,
      error_rate_pct: 5,
      error_rate_sec: 30,
      avg_response_ms: 500,
      avg_response_sec: 30,
    },
    prometheus: {
      exporter_port: 9001,
      run_id: "1",
      samplers_reg_exp: ".*",
      slo_levels: "0.1;1",
      influxdb_url: "",
      application: "",
      measurement: "jmeter",
      percentiles: "99",
      summary_only: false,
      influxdb_token: "",
    },
    requests,
    ...over,
  };
}

test("safeHttpHref принимает только http и https", () => {
  assert.equal(safeHttpHref("https://a.example/x"), "https://a.example/x");
  assert.equal(safeHttpHref(""), null);
  assert.equal(safeHttpHref("javascript:alert(1)"), null);
  assert.equal(safeHttpHref(null), null);
});

test("formatRps не схлопывает доли RPS в ноль", () => {
  assert.equal(formatRps(0), "0");
  assert.equal(formatRps(12.4), "12");
  assert.equal(formatRps(1.5), "1.5");
  assert.equal(formatRps(0.01), "0.01");
});

test("arrivalRate делит HTTP RPS на сумму долей итерации", () => {
  assert.equal(samplesPerIteration([{ throughput: 100 }, { throughput: 50 }]), 1.5);
  assert.equal(arrivalRate(30, 1.5), 20);
  assert.equal(arrivalRate(20, 1), 20);
  assert.deepEqual(iterationWeights([{ repeat: 1 }, { repeat: 3 }]), [0.33, 1]);
  assert.equal(samplesPerIteration([{ repeat: 5 }]), 1);
});

test("groupProfile и totalDuration для ramp-hold и поиска максимума", () => {
  const ramp = groupProfile(
    { target_rps: 10, ramp_up_sec: 30, hold_sec: 60 },
    { test_mode: "ramp_hold", steps: 1, step_duration_sec: 1, assumed_latency_sec: 1 }
  );
  assert.deepEqual(ramp, [
    { t: 0, rps: 1 },
    { t: 30, rps: 10 },
    { t: 90, rps: 10 },
  ]);
  assert.equal(
    totalDuration(
      { target_rps: 10, ramp_up_sec: 30, hold_sec: 60 },
      { test_mode: "ramp_hold", steps: 1, step_duration_sec: 1, assumed_latency_sec: 1 }
    ),
    90
  );

  const steps = groupProfile(
    { target_rps: 10, ramp_up_sec: 0, hold_sec: 1 },
    { test_mode: "max_search", steps: 2, step_duration_sec: 10, assumed_latency_sec: 1 }
  );
  assert.deepEqual(steps, [
    { t: 0, rps: 5 },
    { t: 10, rps: 5 },
    { t: 10, rps: 10 },
    { t: 20, rps: 10 },
  ]);
});

test("groupRequests склеивает корреляцию и общий датасет", () => {
  const groups = groupRequests(
    scenario([
      request({
        id: "login",
        order: 2,
        name: "login",
        extractions: [
          { variable: "token", type: "json", expression: "$.token", match_no: 1, default_value: "" },
        ],
        dataset_id: "ds1",
      }),
      request({
        id: "profile",
        order: 1,
        name: "profile",
        params: [
          { name: "Authorization", location: "header", source: { kind: "constant", value: "Bearer ${token}" }, required: true },
        ],
        dataset_id: "ds1",
      }),
      request({ id: "search", order: 3, name: "search", path: "/search" }),
    ])
  );
  assert.deepEqual(
    groups.map((g) => g.requests.map((r) => r.id)),
    [["profile", "login"], ["search"]]
  );
  assert.equal(groupTitle(groups[0]), "Связка ×2: profile → login");
  assert.equal(groupTitle(groups[1]), "search");
});

test("paramsFromTemplates сохраняет источник и выкидывает устаревший path", () => {
  const params = paramsFromTemplates("/users/{id}", '{"q":"{q}"}', [
    { name: "id", location: "query", source: { kind: "csv", column: "id" }, required: false },
    { name: "old", location: "path", source: { kind: "constant", value: "x" }, required: true },
  ]);
  assert.deepEqual(
    params.map((p) => [p.name, p.location, p.required]),
    [
      ["id", "path", true],
      ["q", "body", true],
    ]
  );
  assert.deepEqual(params[0].source, { kind: "csv", column: "id" });
});

test("scriptWriters сравнивает только переменные скрипта", () => {
  const writers = scriptWriters(
    scenario(
      [
        request({
          id: "a",
          order: 1,
          name: "login",
          extractions: [
            { variable: "token", type: "json", expression: "$.t", match_no: 1, default_value: "" },
          ],
          params: [
            {
              name: "token",
              location: "query",
              source: { kind: "generator", generator: { type: "counter" } },
              required: false,
            },
            {
              name: "id",
              location: "path",
              source: { kind: "correlation", variable: "token" },
              required: true,
            },
            {
              name: "nonce",
              location: "query",
              source: { kind: "generator", generator: { type: "randomString", length: 8 } },
              required: false,
            },
          ],
        }),
      ],
      {
        datasets: [
          {
            id: "d1",
            name: "users",
            file_name: "u.csv",
            columns: ["login", "login"],
            rows: [],
            random: false,
          },
          {
            id: "d2",
            name: "other",
            file_name: "o.csv",
            columns: ["nonce"],
            rows: [],
            random: false,
          },
        ],
      }
    )
  );
  const clashes = scriptVarClashes(writers);
  const token = clashes.find((c) => c.name === "token");
  assert.equal(token?.gatlingOnly, false);
  assert.equal(token?.writers.length, 2);
  assert.equal(
    clashMessage(token!),
    "Переменная token задаётся несколько раз: извлечение в «login», счётчик «token» в «login». В скрипте останется одно значение"
  );
  const login = clashes.find((c) => c.name === "login");
  assert.match(clashMessage(login!), /датасете «users»/);
  const nonce = clashes.find((c) => c.name === "nonce");
  assert.equal(nonce?.gatlingOnly, true);
  assert.match(clashMessage(nonce!), /\(Gatling\)/);
  assert.equal(writers.some((w) => w.name === "id"), false);
  const cross = scriptVarClashes(
    scriptWriters(
      scenario([], {
        datasets: [
          { id: "a", name: "A", file_name: "a.csv", columns: ["login"], rows: [], random: false },
          { id: "b", name: "B", file_name: "b.csv", columns: ["login"], rows: [], random: false },
        ],
      })
    )
  );
  assert.match(clashMessage(cross[0]), /Колонка login есть в датасетах/);
});

test("bracesIn и consolidateRequestParams", () => {
  assert.deepEqual(bracesIn("/a/{id}/b/{id}/{name}"), ["id", "name"]);
  const consolidated = consolidateRequestParams(
    request({
      id: "r",
      order: 1,
      name: "r",
      path: "/users/{id}",
      headers: [{ key: "X-Trace", value: "${__UUID()}" }],
    })
  );
  assert.deepEqual(consolidated.headers, []);
  const trace = consolidated.params.find((p) => p.name === "X-Trace");
  assert.deepEqual(trace?.source, { kind: "generator", generator: { type: "uuid" } });
  assert.equal(consolidated.params.some((p) => p.location === "path" && p.name === "id"), true);
});

test("duplicateRequestName дописывает свободный номер", () => {
  assert.equal(duplicateRequestName("Создать заказ", ["Создать заказ"]), "Создать заказ (1)");
  assert.equal(
    duplicateRequestName("Создать заказ", ["Создать заказ", "Создать заказ (1)"]),
    "Создать заказ (2)"
  );
  assert.equal(
    duplicateRequestName("Создать заказ (1)", ["Создать заказ", "Создать заказ (1)"]),
    "Создать заказ (2)"
  );
});

test("jmeterToParamSource разбирает функции JMeter", () => {
  assert.deepEqual(jmeterToParamSource("${__Random(1,9)}"), {
    kind: "generator",
    generator: { type: "randomInt", min: 1, max: 9 },
  });
  assert.deepEqual(jmeterToParamSource("${token}"), { kind: "correlation", variable: "token" });
  assert.deepEqual(jmeterToParamSource("plain"), { kind: "constant", value: "plain" });
});

test("analyzeScenario: корреляция без извлечения — один блокер, а не два", () => {
  const report = analyzeScenario(
    scenario([
      request({
        id: "r1",
        order: 0,
        name: "profile",
        params: [
          {
            name: "Authorization",
            location: "header",
            source: { kind: "correlation", variable: "token" },
            required: true,
          },
        ],
      }),
    ])
  );
  assert.equal(report.blockers, 1);
  assert.equal(report.checks.filter((c) => c.id.startsWith("corr-")).length, 1);
  assert.equal(report.checks.some((c) => c.id.startsWith("var-")), false);
  const corr = report.checks.find((c) => c.id.startsWith("corr-"));
  assert.equal(corr?.focus?.place, "param");
  assert.equal(corr?.focus?.requestId, "r1");
  assert.equal(corr?.focus?.location, "header");
});

test("analyzeScenario: {param2} в пути не путается с корреляцией ${param}", () => {
  const report = analyzeScenario(
    scenario([
      request({
        id: "r1",
        order: 1,
        method: "POST",
        name: "POST /test/{param2}",
        path: "/test/{param2}",
        params: [
          {
            name: "param2",
            location: "path",
            source: { kind: "constant", value: "1" },
            required: true,
          },
          {
            name: "param",
            location: "query",
            source: { kind: "correlation", variable: "param" },
            required: false,
          },
        ],
      }),
    ])
  );
  const corr = report.checks.find((c) => c.id.startsWith("corr-"));
  assert.equal(
    corr?.message,
    "«POST /test/{param2}»: параметр «param» (Query) берёт ${param}, выше её никто не извлекает"
  );
  assert.match(corr?.hint ?? "", /\{param2\} в адресе и \$\{param\} — разные имена/);
  assert.equal(corr?.focus?.place, "param");
  assert.equal(corr?.focus?.location, "query");
  assert.equal(corr?.focus?.name, "param");
});

test("analyzeScenario: ${param} с значением в этом же запросе — не пропущенная корреляция", () => {
  const report = analyzeScenario(
    scenario([
      request({
        id: "r1",
        order: 1,
        method: "POST",
        name: "create",
        path: "/items",
        body: { mode: "json", content: '{"id":"${param}"}' },
        params: [
          {
            name: "param",
            location: "body",
            source: { kind: "constant", value: "42" },
            required: true,
          },
        ],
      }),
    ])
  );
  assert.equal(
    report.checks.some((c) => c.id.startsWith("var-") || c.id.startsWith("corr-")),
    false
  );
});

test("analyzeScenario пустой сценарий — ошибка и нулевой балл", () => {
  const report = analyzeScenario(scenario([]));
  assert.equal(report.score, 0);
  assert.equal(report.blockers, 1);
  assert.equal(report.checks[0].id, "no-requests");
  assert.equal(report.checks[0].focus?.place, "add-request");
  assert.equal(report.checks[0].step, 1);
});

test("analyzeScenario ведёт каждое сообщение в место правки", () => {
  const report = analyzeScenario(
    scenario(
      [
        request({
          id: "login",
          order: 1,
          name: "login",
          path: "/login/${token}",
          dataset_id: "ds1",
          extractions: [
            { variable: "q", type: "json", expression: "$.id", match_no: 1, default_value: "" },
          ],
          params: [
            {
              name: "q",
              location: "query",
              source: { kind: "constant", value: "" },
              required: true,
            },
            {
              name: "q",
              location: "query",
              source: { kind: "csv", column: "missing" },
              required: false,
            },
          ],
        }),
        request({
          id: "profile",
          order: 2,
          name: "profile",
          params: [
            {
              name: "user",
              location: "query",
              source: { kind: "correlation", variable: "token" },
              required: false,
            },
          ],
        }),
      ],
      {
        datasets: [
          {
            id: "ds1",
            name: "users",
            file_name: "users.csv",
            columns: ["login", "q"],
            rows: [],
            random: false,
          },
        ],
        base_url: "",
        autostop: {
          enabled: false,
          error_rate_pct: 50,
          error_rate_sec: 10,
          avg_response_ms: 0,
          avg_response_sec: 0,
        },
      }
    )
  );
  const byId = (prefix: string) => report.checks.find((c) => c.id.startsWith(prefix));
  assert.equal(byId("no-base-url")?.focus?.place, "base-url");
  const qChecks = report.checks.filter((c) => c.id.startsWith("svar-q-"));
  assert.equal(qChecks.length, 2);
  assert.ok(qChecks.some((c) => c.focus?.place === "extract" && c.focus.requestId === "login"));
  assert.ok(qChecks.some((c) => c.focus?.place === "datasets" && c.focus.name === "ds1"));
  assert.match(qChecks[0]?.message ?? "", /Переменная q задаётся несколько раз/);
  assert.equal(byId("req-param-")?.focus?.place, "param");
  assert.equal(byId("corr-")?.focus?.place, "param");
  assert.equal(byId("corr-")?.focus?.requestId, "profile");
  assert.equal(byId("corr-")?.focus?.location, "query");
  assert.equal(byId("corr-")?.focus?.name, "user");
  assert.match(byId("corr-")?.message ?? "", /параметр «user» \(Query\) берёт \$\{token\}/);
  assert.equal(byId("csv-col-")?.focus?.place, "datasets");
  assert.equal(byId("csv-col-")?.focus?.name, "ds1");
  assert.equal(byId("var-")?.focus?.place, "request-path");
  assert.equal(byId("var-")?.step, 1);
  assert.equal(byId("autostop-off")?.focus?.place, "autostop");
  assert.equal(byId("autostop-off")?.step, 3);
});
