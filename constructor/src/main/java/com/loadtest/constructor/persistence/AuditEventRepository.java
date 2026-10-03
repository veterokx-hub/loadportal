package com.loadtest.constructor.persistence;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AuditEventRepository extends JpaRepository<AuditEventEntity, UUID> {

    List<AuditEventEntity> findAllByOrderByCreatedAtDesc(Pageable pageable);

    List<AuditEventEntity> findAllByOrderByCreatedAtAsc(Pageable pageable);
}
