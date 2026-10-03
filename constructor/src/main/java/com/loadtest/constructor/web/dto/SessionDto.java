package com.loadtest.constructor.web.dto;

import java.time.Instant;
import java.util.UUID;

public record SessionDto(UUID id, Instant createdAt, Instant expiresAt, boolean current) {
}
