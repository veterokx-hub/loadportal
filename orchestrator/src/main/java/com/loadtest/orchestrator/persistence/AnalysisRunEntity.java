package com.loadtest.orchestrator.persistence;

import com.loadtest.orchestrator.model.AnalysisStatus;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

/**
 * Результат одного запуска анализа.
 *
 * <p>Отчёт лежит целиком в {@code report_json}, а не разложен по таблицам находок.
 * Причина простая: находки читаются и показываются документом, отдельного запроса
 * «дай мне все находки по метрике X за квартал» в продукте нет, зато их структура
 * меняется вместе с каталогом правил. Наружу вынесено только то, по чему строится
 * список: вердикт, оценка, число находок.
 */
@Entity
@Table(name = "analysis_runs", indexes = {
        @Index(name = "idx_analysis_runs_username", columnList = "username"),
        @Index(name = "idx_analysis_runs_created", columnList = "created_at"),
        @Index(name = "idx_analysis_runs_test_run", columnList = "test_run_id")
})
public class AnalysisRunEntity {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, length = 128)
    private String username;

    /** Прогон из модуля «Запуск», если анализ запущен от него, иначе null. */
    @Column(name = "test_run_id")
    private UUID testRunId;

    @Column(name = "test_id", length = 128)
    private String testId = "";

    @Column(name = "target_cluster", length = 128)
    private String targetCluster = "";

    @Column(name = "target_namespace", length = 128)
    private String targetNamespace = "";

    @Column(name = "target_service", length = 191)
    private String targetService = "";

    @Column(name = "target_container", length = 128)
    private String targetContainer = "";

    @Column(name = "window_from", nullable = false)
    private Instant windowFrom;

    @Column(name = "window_to", nullable = false)
    private Instant windowTo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private AnalysisStatus status = AnalysisStatus.QUEUED;

    @Column(length = 16)
    private String verdict = "";

    @Column(name = "health_score")
    private int healthScore;

    @Column(name = "findings_count")
    private int findingsCount;

    @Column(length = 1024)
    private String headline = "";

    @Column(name = "ruleset_version", length = 32)
    private String rulesetVersion = "";

    @Column(nullable = false)
    private boolean demo;

    /** Профиль дефекта демо-прогона: нужен, чтобы пересчёт взял ту же синтетику. */
    @Column(name = "demo_fault", length = 32)
    private String demoFault = "";

    /** Запрос к сервису analysis целиком — по нему воспроизводится пересчёт. */
    @Column(name = "request_json", columnDefinition = "text")
    private String requestJson = "";

    @Column(name = "report_json", columnDefinition = "text")
    private String reportJson = "";

    @Column(name = "error_message", length = 2048)
    private String errorMessage = "";

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "finished_at")
    private Instant finishedAt;

    protected AnalysisRunEntity() {
    }

    public AnalysisRunEntity(
            String username,
            UUID testRunId,
            String testId,
            String cluster,
            String namespace,
            String service,
            String container,
            Instant windowFrom,
            Instant windowTo,
            boolean demo,
            String demoFault,
            String requestJson) {
        this.username = username;
        this.testRunId = testRunId;
        this.testId = testId == null ? "" : testId;
        this.targetCluster = cluster == null ? "" : cluster;
        this.targetNamespace = namespace == null ? "" : namespace;
        this.targetService = service == null ? "" : service;
        this.targetContainer = container == null ? "" : container;
        this.windowFrom = windowFrom;
        this.windowTo = windowTo;
        this.demo = demo;
        this.demoFault = demoFault == null ? "" : demoFault;
        this.requestJson = requestJson == null ? "" : requestJson;
    }

    public UUID getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public UUID getTestRunId() {
        return testRunId;
    }

    public String getTestId() {
        return testId;
    }

    public String getTargetCluster() {
        return targetCluster;
    }

    public String getTargetNamespace() {
        return targetNamespace;
    }

    public String getTargetService() {
        return targetService;
    }

    public String getTargetContainer() {
        return targetContainer;
    }

    public Instant getWindowFrom() {
        return windowFrom;
    }

    public Instant getWindowTo() {
        return windowTo;
    }

    public void setWindow(Instant from, Instant to) {
        this.windowFrom = from;
        this.windowTo = to;
    }

    public AnalysisStatus getStatus() {
        return status;
    }

    public void setStatus(AnalysisStatus status) {
        this.status = status;
    }

    public String getVerdict() {
        return verdict;
    }

    public int getHealthScore() {
        return healthScore;
    }

    public int getFindingsCount() {
        return findingsCount;
    }

    public String getHeadline() {
        return headline;
    }

    public String getRulesetVersion() {
        return rulesetVersion;
    }

    public boolean isDemo() {
        return demo;
    }

    public String getDemoFault() {
        return demoFault == null ? "" : demoFault;
    }

    public String getRequestJson() {
        return requestJson == null ? "" : requestJson;
    }

    public String getReportJson() {
        return reportJson;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage == null ? "" : errorMessage;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public void setFinishedAt(Instant finishedAt) {
        this.finishedAt = finishedAt;
    }

    /** Заполняет сводку из готового отчёта — то, что показывается в списке без чтения JSON. */
    public void applyReport(
            String verdict,
            int healthScore,
            int findingsCount,
            String headline,
            String rulesetVersion,
            boolean demo,
            String demoFault,
            String reportJson) {
        this.verdict = verdict;
        this.healthScore = healthScore;
        this.findingsCount = findingsCount;
        this.headline = headline;
        this.rulesetVersion = rulesetVersion;
        this.demo = demo;
        this.demoFault = demoFault == null ? "" : demoFault;
        this.reportJson = reportJson;
    }
}
