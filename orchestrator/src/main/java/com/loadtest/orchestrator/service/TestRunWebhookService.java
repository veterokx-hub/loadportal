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
        byte[] left = expected.get().getBytes(StandardCharsets.UTF_8);
        byte[] right = TextSupport.nullToEmpty(providedSecret).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(left, right);
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
    }

    private Optional<TestRunEntity> findRun(Long pipelineId, UUID runIdHint) {
        if (runIdHint != null) {
            Optional<TestRunEntity> byId = testRunRepository.findById(runIdHint);
            if (byId.isPresent()) {
                return byId;
            }
        }
        if (pipelineId == null) {
            return Optional.empty();
        }
        return testRunRepository.findByGitlabPipelineId(pipelineId);
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
}
