package com.loadtest.constructor.persistence;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

/** Запись об успешной сборке артефакта (снимок сценария + метаданные). */
@Entity
@Table(name = "build_records", indexes = {
        @Index(name = "idx_build_records_username", columnList = "username"),
        @Index(name = "idx_build_records_created", columnList = "createdAt")
})
public class BuildRecordEntity {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, length = 128)
    private String username;

    @Column(nullable = false)
    private String scenarioName;

    /** jmeter | k6 */
    @Column(nullable = false, length = 16)
    private String engine;

    @Column(nullable = false)
    private String filename;

    @Column(nullable = false, columnDefinition = "text")
    private String scenarioJson;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    protected BuildRecordEntity() {
    }

    public BuildRecordEntity(String username, String scenarioName, String engine, String filename, String scenarioJson) {
        this.username = username;
        this.scenarioName = scenarioName;
        this.engine = engine;
        this.filename = filename;
        this.scenarioJson = scenarioJson;
    }

    public UUID getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getScenarioName() {
        return scenarioName;
    }

    public String getEngine() {
        return engine;
    }

    public String getFilename() {
        return filename;
    }

    public String getScenarioJson() {
        return scenarioJson;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
