package com.loadtest.constructor.web.dto;

import java.time.Instant;
import java.util.UUID;

public record BuildRecordSummary(
        UUID id,
        String scenarioName,
        String engine,
        String filename,
        Instant createdAt
) {
}
