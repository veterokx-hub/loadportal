package com.loadtest.constructor.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "audit_events")
public class AuditEventEntity {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false, length = 128)
    private String username;

    @Column(nullable = false, length = 32)
    private String action;

    @Column(nullable = false, length = 512)
    private String detail = "";

    protected AuditEventEntity() {
    }

    public AuditEventEntity(String username, String action, String detail) {
        this.username = username == null ? "" : username;
        this.action = action;
        this.detail = detail == null ? "" : detail;
    }

    public UUID getId() {
        return id;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public String getUsername() {
        return username;
    }

    public String getAction() {
        return action;
    }

    public String getDetail() {
        return detail;
    }
}
