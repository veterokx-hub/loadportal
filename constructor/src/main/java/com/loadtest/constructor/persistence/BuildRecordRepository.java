package com.loadtest.constructor.persistence;

import com.loadtest.constructor.web.dto.BuildRecordSummary;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface BuildRecordRepository extends JpaRepository<BuildRecordEntity, UUID> {

    @Query("""
            SELECT new com.loadtest.constructor.web.dto.BuildRecordSummary(
                b.id, b.scenarioName, b.engine, b.filename, b.createdAt)
            FROM BuildRecordEntity b
            WHERE b.username = :username
            ORDER BY b.createdAt DESC
            """)
    List<BuildRecordSummary> findSummariesByUsername(@Param("username") String username, Pageable pageable);

    List<BuildRecordEntity> findByUsernameOrderByCreatedAtDesc(String username);

    @Modifying
    @Query("DELETE FROM BuildRecordEntity b WHERE b.id IN :ids")
    void deleteByIdIn(@Param("ids") List<UUID> ids);
}
