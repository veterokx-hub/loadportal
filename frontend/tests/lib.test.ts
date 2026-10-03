import assert from "node:assert/strict";
import test from "node:test";

import { analyzeScenario } from "../lib/readiness.ts";
import { groupRequests, groupTitle } from "../lib/grouping.ts";
import {
  arrivalRate,
  formatRps,
  groupProfile,
  samplesPerIteration,
  totalDuration,
} from "../lib/profile.ts";
import { bracesIn, consolidateRequestParams, paramsFromTemplates } from "../lib/request-params.ts";
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

test("arrivalRate делит HTTP RPS на число сэмплов итерации", () => {
  assert.equal(samplesPerIteration([{ repeat: 1 }, { repeat: 3 }]), 4);
  assert.equal(arrivalRate(20, 4), 5);
  assert.equal(arrivalRate(20, 1), 20);
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

test("jmeterToParamSource разбирает функции JMeter", () => {
  assert.deepEqual(jmeterToParamSource("${__Random(1,9)}"), {
    kind: "generator",
    generator: { type: "randomInt", min: 1, max: 9 },
  });
  assert.deepEqual(jmeterToParamSource("${token}"), { kind: "correlation", variable: "token" });
  assert.deepEqual(jmeterToParamSource("plain"), { kind: "constant", value: "plain" });
});

test("analyzeScenario пустой сценарий — ошибка и нулевой балл", () => {
  const report = analyzeScenario(scenario([]));
  assert.equal(report.score, 0);
  assert.equal(report.blockers, 1);
  assert.equal(report.checks[0].id, "no-requests");
});
