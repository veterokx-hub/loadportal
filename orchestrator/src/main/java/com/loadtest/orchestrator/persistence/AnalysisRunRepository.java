package com.loadtest.orchestrator.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AnalysisRunRepository extends JpaRepository<AnalysisRunEntity, UUID> {

    List<AnalysisRunEntity> findAllByOrderByCreatedAtDesc();

    List<AnalysisRunEntity> findByUsernameOrderByCreatedAtDesc(String username);

    List<AnalysisRunEntity> findByTestRunIdOrderByCreatedAtDesc(UUID testRunId);
}
