package com.loadtest.orchestrator.web.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record TestRunDto(
        String id,
        String testId,
        String username,
        String scenarioName,
        String engine,
        String buildId,
        String scriptId,
        String targetUrl,
        Map<String, Object> params,
        Map<String, String> labels,
        String status,
        Long gitlabPipelineId,
        String gitlabWebUrl,
        String grafanaUrl,
        Instant startedAt,
        Instant endedAt,
        String errorMessage,
        Instant createdAt,
        List<TestRunEventDto> events
) {
}
