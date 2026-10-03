package com.loadtest.constructor.web.dto;

import java.time.Instant;
import java.util.UUID;

public record AuditEventDto(UUID id, Instant createdAt, String username, String action, String detail) {
}
