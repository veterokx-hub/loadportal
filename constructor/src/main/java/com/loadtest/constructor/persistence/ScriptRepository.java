package com.loadtest.constructor.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ScriptRepository extends JpaRepository<ScriptEntity, UUID> {

    /** Проекция без content: список скриптов не должен тянуть тела артефактов. */
    interface Summary {
        UUID getId();

        UUID getBuildId();

        String getEngine();

        String getFilename();

        String getSource();

        String getGitUrl();

        Instant getCreatedAt();
    }

    List<Summary> findAllProjectedByUsernameOrderByCreatedAtDesc(String username);

    Optional<ScriptEntity> findFirstByBuildIdOrderByCreatedAtDesc(UUID buildId);
}
