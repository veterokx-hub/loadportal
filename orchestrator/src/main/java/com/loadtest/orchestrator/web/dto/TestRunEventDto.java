package com.loadtest.orchestrator.web.dto;

import java.time.Instant;

public record TestRunEventDto(
        Instant at,
        String event,
        String detail
) {
}
