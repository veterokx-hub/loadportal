package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.config.ConsulKv;
import com.loadtest.orchestrator.metrics.PortalMetrics;
import com.loadtest.orchestrator.model.TestRunStatus;
import com.loadtest.orchestrator.persistence.TestRunEntity;
import com.loadtest.orchestrator.persistence.TestRunRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import tools.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

/** Обработка GitLab webhook и проверка секрета (отдельно от создания прогона). */
@Service
public class TestRunWebhookService {

    private static final Logger log = LoggerFactory.getLogger(TestRunWebhookService.class);
    private static final Set<String> VERDICTS = Set.of("passed", "failed", "invalid");

    private final TestRunRepository testRunRepository;
    private final PortalSettingsService portalSettingsService;
    private final GitLabSettingsService gitLabSettingsService;
    private final TestRunMapper mapper;
    private final PortalMetrics metrics;
    private final AnalysisService analysisService;
    private final ConsulKv consul;
    private final boolean autoAnalyzeDefault;

    public TestRunWebhookService(
            TestRunRepository testRunRepository,
            PortalSettingsService portalSettingsService,
            GitLabSettingsService gitLabSettingsService,
            TestRunMapper mapper,
            PortalMetrics metrics,
            AnalysisService analysisService,
            ConsulKv consul,
            @Value("${loadtest.analysis.auto-on-finish:true}") boolean autoAnalyze) {
        this.testRunRepository = testRunRepository;
        this.portalSettingsService = portalSettingsService;
        this.gitLabSettingsService = gitLabSettingsService;
        this.mapper = mapper;
        this.metrics = metrics;
        this.analysisService = analysisService;
        this.consul = consul;
        this.autoAnalyzeDefault = autoAnalyze;
    }

    public boolean verifySecret(String providedSecret) {
        Optional<String> expected = gitLabSettingsService.resolveWebhookSecret(portalSettingsService.loadEntity());
        if (expected.isEmpty()) {
            log.warn("Webhook secret not configured — rejecting");
            return false;
        }
        return secretsEqual(expected.get(), TextSupport.nullToEmpty(providedSecret));
    }

    @Transactional
    public void applyPipelineEvent(Long pipelineId, String gitlabStatus, String webUrl, UUID runIdHint) {
        log.info("GitLab webhook pipeline={} status={} runHint={}", pipelineId, gitlabStatus, runIdHint);
        Optional<TestRunEntity> found = findRun(pipelineId, runIdHint);
        if (found.isEmpty()) {
            log.warn("Webhook: run not found for pipeline {}", pipelineId);
            metrics.recordGitLabWebhook("unknown_pipeline");
            return;
        }

        TestRunEntity run = found.get();
        MDC.put("run_id", run.getId().toString());
        try {
            if (run.getStatus() == TestRunStatus.CANCELED) {
                metrics.recordGitLabWebhook("canceled_kept");
                return;
            }
            if (pipelineId != null && run.getGitlabPipelineId() == null) {
                run.setGitlabPipelineId(pipelineId);
            }
            TestRunStatus newStatus = TestRunStatus.fromGitLab(gitlabStatus);
            if (run.getStatus() == newStatus && Objects.equals(run.getGitlabWebUrl(), webUrl)) {
                metrics.recordGitLabWebhook("accepted");
                return;
            }

            applyStatusTransition(run, newStatus, webUrl);
            mapper.appendEvent(run, "status", gitlabStatus + " → " + newStatus.name());
            testRunRepository.save(run);
            metrics.recordRunStatus(newStatus);
            metrics.recordGitLabWebhook("accepted");
            // Тест закончился — самое время посмотреть, что происходило с сервисом.
            // Сама задача уйдёт в работу после коммита этой транзакции.
            if (autoOnFinish() && newStatus.isTerminal()) {
                analysisService.autoAnalyze(run);
            }
        } finally {
            MDC.remove("run_id");
        }
    }

    /**
     * Вердикт gate. Статус пайплайна GitLab не отличает failed от invalid:
     * оба роняют джобу. Сюда publish кладёт точный статус и метрики.
     *
     * @return {@code ok} или {@code ignored} (прогон уже отменён)
     */
    @Transactional
    public String applyVerdict(JsonNode body) {
        String rawId = body.path("portal_run_id").asText("");
        String verdict = body.path("status").asText("");
        UUID runId = parseRunId(rawId);
        if (!VERDICTS.contains(verdict)) {
            throw new IllegalArgumentException("неизвестный статус вердикта");
        }
        TestRunEntity run = testRunRepository.findById(runId).orElseThrow(
                () -> new IllegalArgumentException("прогон не найден"));
        MDC.put("run_id", run.getId().toString());
        try {
            if (run.getStatus() == TestRunStatus.CANCELED) {
                metrics.recordGitLabWebhook("verdict_ignored");
                return "ignored";
            }
            String json = body.toString();
            if (verdict.equals(run.getVerdictStatus()) && json.equals(run.getVerdictJson())) {
                metrics.recordGitLabWebhook("verdict");
                return "ok";
            }
            String reasons = reasonsOf(body);
            run.setVerdictStatus(verdict);
            run.setVerdictJson(json);
            TestRunStatus pipelineStatus = "passed".equals(verdict)
                    ? TestRunStatus.SUCCEEDED
                    : TestRunStatus.FAILED;
            applyStatusTransition(run, pipelineStatus, run.getGitlabWebUrl());
            if ("passed".equals(verdict)) {
                run.setErrorMessage("");
            } else {
                String message = reasons.isBlank()
                        ? ("invalid".equals(verdict) ? "прогон невалиден" : "SLA не пройден")
                        : reasons;
                run.setErrorMessage(TextSupport.truncate(message, 2000));
            }
            mapper.appendEvent(run, "verdict", verdict + (reasons.isBlank() ? "" : ": " + reasons));
            testRunRepository.save(run);
            metrics.recordRunStatus(pipelineStatus);
            metrics.recordGitLabWebhook("verdict");
            return "ok";
        } finally {
            MDC.remove("run_id");
        }
    }

    private static UUID parseRunId(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("в вердикте нет portal_run_id");
        }
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("portal_run_id не UUID");
        }
    }

    private static String reasonsOf(JsonNode body) {
        if (!body.path("reasons").isArray()) {
            return "";
        }
        return StreamSupport.stream(body.path("reasons").spliterator(), false)
                .map(JsonNode::asText)
                .filter(text -> !text.isBlank())
                .collect(Collectors.joining("; "));
    }

    /**
     * Ищем прогон по pipeline id; hint PORTAL_RUN_ID принимаем только если
     * pipeline совпадает или у прогона pipeline ещё не записан.
     */
    private Optional<TestRunEntity> findRun(Long pipelineId, UUID runIdHint) {
        if (pipelineId != null) {
            Optional<TestRunEntity> byPipeline = testRunRepository.findByGitlabPipelineId(pipelineId);
            if (byPipeline.isPresent()) {
                return byPipeline;
            }
        }
        if (runIdHint == null) {
            return Optional.empty();
        }
        Optional<TestRunEntity> byHint = testRunRepository.findById(runIdHint);
        if (byHint.isEmpty()) {
            return Optional.empty();
        }
        TestRunEntity run = byHint.get();
        Long stored = run.getGitlabPipelineId();
        if (stored != null) {
            if (pipelineId == null || !stored.equals(pipelineId)) {
                log.warn(
                        "Webhook rejected: PORTAL_RUN_ID={} bound to pipeline {} but event has {}",
                        runIdHint, stored, pipelineId);
                return Optional.empty();
            }
            return byHint;
        }
        if (run.getStatus() != TestRunStatus.QUEUED) {
            return Optional.empty();
        }
        if (run.getCreatedAt() != null
                && run.getCreatedAt().isBefore(Instant.now().minus(15, ChronoUnit.MINUTES))) {
            return Optional.empty();
        }
        return byHint;
    }

    private void applyStatusTransition(TestRunEntity run, TestRunStatus newStatus, String webUrl) {
        run.setStatus(newStatus);
        if (webUrl != null && !webUrl.isBlank()) {
            run.setGitlabWebUrl(webUrl);
        }
        if (run.getStartedAt() == null && newStatus == TestRunStatus.RUNNING) {
            run.setStartedAt(Instant.now());
        }
        if (newStatus.isTerminal()) {
            run.setEndedAt(Instant.now());
            run.setGrafanaUrl(mapper.buildGrafanaUrl(portalSettingsService.loadEntity(), run));
        }
    }

    /** Consul `analysis/auto-on-finish`, иначе ConfigMap / LOADTEST_ANALYSIS_AUTO. */
    private boolean autoOnFinish() {
        return consul.get("analysis/auto-on-finish")
                .filter(value -> !value.isBlank())
                .map(TestRunWebhookService::flag)
                .orElse(autoAnalyzeDefault);
    }

    private static boolean flag(String raw) {
        String value = raw.trim().toLowerCase();
        return value.equals("1") || value.equals("true") || value.equals("yes") || value.equals("on");
    }

    /** Сравнение через SHA-256 дайджесты — без утечки длины исходного секрета. */
    private static boolean secretsEqual(String expected, String provided) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] left = md.digest(expected.getBytes(StandardCharsets.UTF_8));
            md.reset();
            byte[] right = md.digest(provided.getBytes(StandardCharsets.UTF_8));
            return MessageDigest.isEqual(left, right);
        } catch (NoSuchAlgorithmException ex) {
            return expected.equals(provided);
        }
    }
}
