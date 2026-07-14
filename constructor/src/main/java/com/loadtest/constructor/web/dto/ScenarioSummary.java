package com.loadtest.constructor.web.dto;

import com.loadtest.constructor.persistence.ScenarioEntity;

import java.time.Instant;
import java.util.UUID;

public record ScenarioSummary(UUID id, UUID projectId, String name, int version, Instant createdAt) {
    public static ScenarioSummary from(ScenarioEntity e) {
        return new ScenarioSummary(e.getId(), e.getProjectId(), e.getName(), e.getVersion(), e.getCreatedAt());
    }
}
