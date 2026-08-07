package com.loadtest.orchestrator.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface BuildRecordRepository extends JpaRepository<BuildRecordEntity, UUID> {
}
