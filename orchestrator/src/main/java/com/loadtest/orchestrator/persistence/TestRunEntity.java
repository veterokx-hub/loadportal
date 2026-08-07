package com.loadtest.orchestrator.persistence;

import com.loadtest.orchestrator.model.TestRunStatus;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "test_runs", indexes = {
        @Index(name = "idx_test_runs_username", columnList = "username"),
        @Index(name = "idx_test_runs_created", columnList = "created_at"),
        @Index(name = "idx_test_runs_pipeline", columnList = "gitlab_pipeline_id")
})
public class TestRunEntity {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, length = 128)
    private String username;

    @Column(name = "scenario_name", nullable = false)
    private String scenarioName;

    @Column(nullable = false, length = 16)
    private String engine;

    @Column(name = "build_id")
    private UUID buildId;

    @Column(name = "script_id")
    private UUID scriptId;

    /** Jira task key, e.g. NT-1234 */
    @Column(name = "test_id", length = 128)
    private String testId = "";

    @Column(name = "target_url", length = 2048)
    private String targetUrl = "";

    @Column(name = "params_json", columnDefinition = "text")
    private String paramsJson = "{}";

    @Column(name = "labels_json", columnDefinition = "text")
    private String labelsJson = "{}";

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private TestRunStatus status = TestRunStatus.QUEUED;

    @Column(name = "gitlab_pipeline_id")
    private Long gitlabPipelineId;

    @Column(name = "gitlab_web_url", length = 2048)
    private String gitlabWebUrl = "";

    @Column(name = "grafana_url", length = 4096)
    private String grafanaUrl = "";

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(name = "error_message", length = 2048)
    private String errorMessage = "";

    @Column(name = "events_json", columnDefinition = "text")
    private String eventsJson = "[]";

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected TestRunEntity() {
    }

    public TestRunEntity(
            String username,
            String scenarioName,
            String engine,
            UUID buildId,
            UUID scriptId,
            String testId,
            String targetUrl,
            String paramsJson,
            String labelsJson) {
        this.username = username;
        this.scenarioName = scenarioName;
        this.engine = engine;
        this.buildId = buildId;
        this.scriptId = scriptId;
        this.testId = testId == null ? "" : testId;
        this.targetUrl = targetUrl == null ? "" : targetUrl;
        this.paramsJson = paramsJson;
        this.labelsJson = labelsJson;
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

    public UUID getBuildId() {
        return buildId;
    }

    public UUID getScriptId() {
        return scriptId;
    }

    public void setScriptId(UUID scriptId) {
        this.scriptId = scriptId;
    }

    public String getTestId() {
        return testId;
    }

    public void setTestId(String testId) {
        this.testId = testId == null ? "" : testId;
    }

    public String getTargetUrl() {
        return targetUrl;
    }

    public String getParamsJson() {
        return paramsJson;
    }

    public void setParamsJson(String paramsJson) {
        this.paramsJson = paramsJson;
    }

    public String getLabelsJson() {
        return labelsJson;
    }

    public TestRunStatus getStatus() {
        return status;
    }

    public void setStatus(TestRunStatus status) {
        this.status = status;
    }

    public Long getGitlabPipelineId() {
        return gitlabPipelineId;
    }

    public void setGitlabPipelineId(Long gitlabPipelineId) {
        this.gitlabPipelineId = gitlabPipelineId;
    }

    public String getGitlabWebUrl() {
        return gitlabWebUrl;
    }

    public void setGitlabWebUrl(String gitlabWebUrl) {
        this.gitlabWebUrl = gitlabWebUrl;
    }

    public String getGrafanaUrl() {
        return grafanaUrl;
    }

    public void setGrafanaUrl(String grafanaUrl) {
        this.grafanaUrl = grafanaUrl;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Instant getEndedAt() {
        return endedAt;
    }

    public void setEndedAt(Instant endedAt) {
        this.endedAt = endedAt;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }

    public String getEventsJson() {
        return eventsJson;
    }

    public void setEventsJson(String eventsJson) {
        this.eventsJson = eventsJson;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
