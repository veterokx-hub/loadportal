// Доменная модель (зеркало контракта constructor / analyzer, snake_case JSON).
// См. docs/domain-model.md.

export type SourceType = "openapi" | "postman";
export type HttpMethod =
  | "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | (string & {});
export type ParamLocation = "path" | "query" | "header" | "body";
export type BodyMode = "none" | "raw" | "json" | "form";
export type GeneratorType =
  | "uuid" | "randomInt" | "randomString" | "counter" | "timestamp";
export type ExtractionType = "json" | "regex" | "boundary";
export type TestMode = "ramp_hold" | "max_search";

export interface Generator {
  type: GeneratorType;
  min?: number;
  max?: number;
  length?: number;
  chars?: string;
  start?: number;
  increment?: number;
  format?: string;
}

export type ParamSource =
  | { kind: "constant"; value: string }
  | { kind: "generator"; generator: Generator }
  | { kind: "correlation"; variable: string }
  | { kind: "csv"; column: string };

export interface KeyValue {
  key: string;
  value: string;
}

export interface Body {
  mode: BodyMode;
  content_type?: string | null;
  content: string;
}

export interface Param {
  name: string;
  location: ParamLocation;
  source: ParamSource;
  schema_type?: string | null;
  example?: string | null;
  required: boolean;
}

export interface Extraction {
  variable: string;
  type: ExtractionType;
  expression: string;
  match_no: number;
  default_value: string;
}

export interface Validation {
  check_response_code: boolean;
  expected_status: number;
  response_contains: string;
}

export interface Intensity {
  target_rps: number;
  ramp_up_sec: number;
  hold_sec: number;
}

export interface RequestModel {
  id: string;
  order: number;
  name: string;
  method: string;
  path: string;
  /** Собственный абсолютный URL — переопределяет base_url + path. */
  url?: string | null;
  headers: KeyValue[];
  query_params: Param[];
  body: Body;
  params: Param[];
  extractions: Extraction[];
  intensity: Intensity;
  validation: Validation;
  dataset_id?: string | null;
  repeat: number;
}

export interface Dataset {
  id: string;
  name: string;
  file_name: string;
  columns: string[];
  rows: string[][];
  random: boolean;
}

export interface LoadConfig {
  test_mode: TestMode;
  steps: number;
  step_duration_sec: number;
  assumed_latency_sec: number;
}

export interface AutoStop {
  enabled: boolean;
  error_rate_pct: number;
  error_rate_sec: number;
  avg_response_ms: number;
  avg_response_sec: number;
}

export interface PrometheusConfig {
  /** Старые поля Prometheus-listener. В .jmx больше не пишутся. */
  exporter_port: number;
  run_id: string;
  samplers_reg_exp: string;
  slo_levels: string;
  /** Influx line protocol → VictoriaMetrics. */
  influxdb_url: string;
  application: string;
  measurement: string;
  percentiles: string;
  summary_only: boolean;
  influxdb_token: string;
}

export interface Scenario {
  name: string;
  source_type: SourceType;
  base_url: string;
  load: LoadConfig;
  datasets: Dataset[];
  autostop: AutoStop;
  prometheus: PrometheusConfig;
  requests: RequestModel[];
}
