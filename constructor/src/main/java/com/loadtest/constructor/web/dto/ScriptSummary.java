package com.loadtest.constructor.web.dto;

public record ScriptSummary(
        String id,
        String buildId,
        String engine,
        String filename,
        String source,
        String gitUrl,
        String createdAt
) {
}
