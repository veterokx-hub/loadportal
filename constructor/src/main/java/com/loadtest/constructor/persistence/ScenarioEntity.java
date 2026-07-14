package com.loadtest.constructor.persistence;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

/**
 * Сценарий хранится как JSON-документ (полная доменная модель Scenario) —
 * это упрощает версионирование и эволюцию модели без миграций схемы.
 */
@Entity
@Table(name = "scenarios")
public class ScenarioEntity {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false)
    private UUID projectId;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private int version;

    @Lob
    @Column(nullable = false, columnDefinition = "text")
    private String dataJson;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    protected ScenarioEntity() {
    }

    public ScenarioEntity(UUID projectId, String name, int version, String dataJson) {
        this.projectId = projectId;
        this.name = name;
        this.version = version;
        this.dataJson = dataJson;
    }

    public UUID getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public String getName() {
        return name;
    }

    public int getVersion() {
        return version;
    }

    public String getDataJson() {
        return dataJson;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
