package com.loadtest.constructor.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.Collection;
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

    void deleteByBuildId(UUID buildId);

    void deleteByBuildIdIn(Collection<UUID> buildIds);

    /** Скрипты portal_build / любые с build_id, у которых сборка уже удалена (старый trim). */
    @Modifying(clearAutomatically = true)
    @Query(value = """
            DELETE FROM scripts s
            WHERE s.build_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM build_records b WHERE b.id = s.build_id)
            """, nativeQuery = true)
    int deleteOrphanBuildScripts();
}
