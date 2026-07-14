package com.loadtest.constructor.model;

import java.util.List;

public record Scenario(
        String name,
        SourceType sourceType,
        String baseUrl,
        LoadConfig load,
        List<Dataset> datasets,
        List<Request> requests,
        AutoStop autostop,
        PrometheusConfig prometheus
) {
    public LoadConfig load() {
        return load != null ? load : LoadConfig.defaults();
    }

    public AutoStop autostop() {
        return autostop != null ? autostop : AutoStop.disabled();
    }

    public PrometheusConfig prometheus() {
        return prometheus != null ? prometheus : PrometheusConfig.defaults();
    }

    public List<Dataset> datasets() {
        return datasets != null ? datasets : List.of();
    }

    public List<Request> requests() {
        return requests != null ? requests : List.of();
    }
}
