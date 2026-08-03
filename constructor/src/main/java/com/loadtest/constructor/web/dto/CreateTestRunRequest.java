package com.loadtest.constructor.web.dto;

import java.util.Map;

public record CreateTestRunRequest(
        String testId,
        String buildId,
        String scriptId,
        String scenarioName,
        String engine,
        String targetUrl,
        Map<String, Object> params,
        Map<String, String> labels
) {
}
