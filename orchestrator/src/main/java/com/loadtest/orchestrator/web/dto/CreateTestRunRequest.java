package com.loadtest.orchestrator.web.dto;

import java.util.Map;

public record CreateTestRunRequest(
        String testId,
        String buildId,
        String scriptId,
        String scenarioName,
        String engine,
        String targetUrl,
        String startTime,
        String endTime,
        String cpu,
        String memory,
        String scenarioPath,
        String podName,
        String repository,
        Map<String, Object> params,
        Map<String, String> labels
) {
}
