package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.metrics.PortalMetrics;
import com.loadtest.orchestrator.model.TestRunStatus;
import com.loadtest.orchestrator.persistence.TestRunEntity;
import com.loadtest.orchestrator.persistence.TestRunRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/** Обработка GitLab webhook и проверка секрета (отдельно от создания прогона). */
@Service
public class TestRunWebhookService {

    private static final Logger log = LoggerFactory.getLogger(TestRunWebhookService.class);

    private final TestRunRepository testRunRepository;
    private final PortalSettingsService portalSettingsService;
    private final GitLabSettingsService gitLabSettingsService;
    private final TestRunMapper mapper;
    private final PortalMetrics metrics;

    public TestRunWebhookService(
            TestRunRepository testRunRepository,
            PortalSettingsService portalSettingsService,
            GitLabSettingsService gitLabSettingsService,
            TestRunMapper mapper,
            PortalMetrics metrics) {
        this.testRunRepository = testRunRepository;
        this.portalSettingsService = portalSettingsService;
        this.gitLabSettingsService = gitLabSettingsService;
        this.mapper = mapper;
        this.metrics = metrics;
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
        } finally {
            MDC.remove("run_id");
        }
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
        if (stored != null && pipelineId != null && !stored.equals(pipelineId)) {
            log.warn(
                    "Webhook rejected: PORTAL_RUN_ID={} bound to pipeline {} but event has {}",
                    runIdHint, stored, pipelineId);
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
