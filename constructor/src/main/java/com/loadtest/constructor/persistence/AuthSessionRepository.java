package com.loadtest.constructor.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface AuthSessionRepository extends JpaRepository<AuthSessionEntity, UUID> {
    Optional<AuthSessionEntity> findByTokenAndExpiresAtAfter(String token, Instant now);
    void deleteByExpiresAtBefore(Instant now);
}
