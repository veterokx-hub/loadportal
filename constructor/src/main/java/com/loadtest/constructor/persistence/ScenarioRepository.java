package com.loadtest.constructor.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ScenarioRepository extends JpaRepository<ScenarioEntity, UUID> {

    List<ScenarioEntity> findByProjectIdOrderByVersionDesc(UUID projectId);

    int countByProjectId(UUID projectId);
}
