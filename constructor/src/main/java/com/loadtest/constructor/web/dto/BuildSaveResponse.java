package com.loadtest.constructor.web.dto;

public record BuildSaveResponse(
        String buildId,
        String scriptId,
        String scenarioName,
        String engine,
        String filename
) {
}
