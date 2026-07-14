package com.loadtest.constructor.web.dto;

import com.loadtest.constructor.persistence.ProjectEntity;

import java.time.Instant;
import java.util.UUID;

public record ProjectDto(UUID id, String name, Instant createdAt) {
    public static ProjectDto from(ProjectEntity e) {
        return new ProjectDto(e.getId(), e.getName(), e.getCreatedAt());
    }
}
