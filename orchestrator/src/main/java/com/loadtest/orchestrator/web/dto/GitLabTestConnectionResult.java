package com.loadtest.orchestrator.web.dto;

public record GitLabTestConnectionResult(
        boolean ok,
        String message,
        Long projectId,
        String projectPath
) {
}
