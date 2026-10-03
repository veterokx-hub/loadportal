package com.loadtest.constructor.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AuthSessionRepository extends JpaRepository<AuthSessionEntity, UUID> {
    Optional<AuthSessionEntity> findByTokenAndExpiresAtAfter(String token, Instant now);

    List<AuthSessionEntity> findByUsernameIgnoreCaseAndExpiresAtAfterOrderByCreatedAtDesc(
            String username, Instant now);

    @Modifying
    @Query("DELETE FROM AuthSessionEntity s WHERE LOWER(s.username) = LOWER(:username)")
    int deleteByUsernameIgnoreCase(@Param("username") String username);

    void deleteByExpiresAtBefore(Instant now);
}
