package com.loadtest.orchestrator.persistence;

import com.loadtest.orchestrator.model.TestRunStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TestRunRepository extends JpaRepository<TestRunEntity, UUID> {

    List<TestRunEntity> findByUsernameOrderByCreatedAtDesc(String username);

    List<TestRunEntity> findAllByOrderByCreatedAtDesc();

    Optional<TestRunEntity> findByGitlabPipelineId(Long gitlabPipelineId);

    /** Для gauge-метрики незавершённых прогонов: count по индексу, без выгрузки строк. */
    long countByStatusIn(Collection<TestRunStatus> statuses);
}
