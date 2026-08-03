package com.loadtest.constructor.web.dto;

public record GitLabTestConnectionResult(
        boolean ok,
        String message,
        Long projectId,
        String projectPath
) {
}
