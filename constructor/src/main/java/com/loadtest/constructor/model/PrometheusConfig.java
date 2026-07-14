package com.loadtest.constructor.model;

/** Настройки Backend Listener Prometheus (kolesnikovm/jmeter-prometheus-listener). */
public record PrometheusConfig(
        int exporterPort,
        String runId,
        String samplersRegExp,
        String sloLevels
) {
    public static PrometheusConfig defaults() {
        return new PrometheusConfig(9001, "1", ".*", "0.1;1");
    }
}
