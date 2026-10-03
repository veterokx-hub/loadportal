package com.loadtest.jmeterbuilder.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Настройки Backend Listener JMeter
 * {@code org.apache.jmeter.visualizers.backend.influxdb.InfluxdbBackendListenerClient}.
 * Пишет Influx line protocol в VictoriaMetrics. Старые поля Prometheus-listener
 * остаются в JSON, чтобы сохранённые сценарии открывались.
 */
public record PrometheusConfig(
        int exporterPort,
        String runId,
        String samplersRegExp,
        String sloLevels,
        String influxdbUrl,
        String application,
        String measurement,
        String percentiles,
        boolean summaryOnly,
        String influxdbToken
) {
    public static final String DEFAULT_URL = "http://victoriametrics:8428/write?db=jmeter";

    public PrometheusConfig {
        if (runId == null || runId.isBlank()) {
            runId = "1";
        }
        if (samplersRegExp == null || samplersRegExp.isBlank()) {
            samplersRegExp = ".*";
        }
        if (sloLevels == null || sloLevels.isBlank()) {
            sloLevels = "0.1;1";
        }
        if (influxdbUrl == null || influxdbUrl.isBlank()) {
            influxdbUrl = DEFAULT_URL;
        }
        if (application == null) {
            application = "";
        }
        if (measurement == null || measurement.isBlank()) {
            measurement = "jmeter";
        }
        if (percentiles == null || percentiles.isBlank()) {
            percentiles = "99;95;90";
        }
        if (influxdbToken == null) {
            influxdbToken = "";
        }
    }

    public static PrometheusConfig defaults() {
        return new PrometheusConfig(9001, "1", ".*", "0.1;1",
                DEFAULT_URL, "", "jmeter", "99;95;90", false, "");
    }

    @JsonCreator
    public static PrometheusConfig fromJson(
            @JsonProperty("exporter_port") Integer exporterPort,
            @JsonProperty("run_id") String runId,
            @JsonProperty("samplers_reg_exp") String samplersRegExp,
            @JsonProperty("slo_levels") String sloLevels,
            @JsonProperty("influxdb_url") String influxdbUrl,
            @JsonProperty("application") String application,
            @JsonProperty("measurement") String measurement,
            @JsonProperty("percentiles") String percentiles,
            @JsonProperty("summary_only") Boolean summaryOnly,
            @JsonProperty("influxdb_token") String influxdbToken) {
        return new PrometheusConfig(
                exporterPort == null ? 9001 : exporterPort,
                runId,
                samplersRegExp,
                sloLevels,
                influxdbUrl,
                application,
                measurement,
                percentiles,
                summaryOnly != null && summaryOnly,
                influxdbToken);
    }
}
