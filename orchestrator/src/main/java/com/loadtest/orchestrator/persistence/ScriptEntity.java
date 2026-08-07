package com.loadtest.orchestrator.persistence;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "scripts", indexes = {
        @Index(name = "idx_scripts_username", columnList = "username"),
        @Index(name = "idx_scripts_build", columnList = "build_id")
})
public class ScriptEntity {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, length = 128)
    private String username;

    @Column(name = "build_id")
    private UUID buildId;

    @Column(nullable = false, length = 16)
    private String engine;

    @Column(nullable = false)
    private String filename;

    /** portal_build | upload | git */
    @Column(nullable = false, length = 32)
    private String source;

    @Column(name = "git_url", length = 2048)
    private String gitUrl = "";

    /** Не @Lob: в PostgreSQL это переводит колонку в Large Object (oid), а схема хранит bytea. */
    @JdbcTypeCode(SqlTypes.VARBINARY)
    @Column(columnDefinition = "bytea")
    private byte[] content;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected ScriptEntity() {
    }

    public ScriptEntity(
            String username,
            UUID buildId,
            String engine,
            String filename,
            String source,
            String gitUrl,
            byte[] content) {
        this.username = username;
        this.buildId = buildId;
        this.engine = engine;
        this.filename = filename;
        this.source = source;
        this.gitUrl = gitUrl == null ? "" : gitUrl;
        this.content = content;
    }

    public UUID getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public UUID getBuildId() {
        return buildId;
    }

    public String getEngine() {
        return engine;
    }

    public String getFilename() {
        return filename;
    }

    public String getSource() {
        return source;
    }

    public String getGitUrl() {
        return gitUrl;
    }

    public void setGitUrl(String gitUrl) {
        this.gitUrl = gitUrl == null ? "" : gitUrl;
    }

    public byte[] getContent() {
        return content;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
