package com.loadtest.orchestrator.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface ScriptRepository extends JpaRepository<ScriptEntity, UUID> {

    Optional<ScriptEntity> findFirstByBuildIdOrderByCreatedAtDesc(UUID buildId);
}
