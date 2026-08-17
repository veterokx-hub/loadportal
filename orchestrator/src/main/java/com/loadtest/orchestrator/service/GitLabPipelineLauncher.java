package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.client.GitLabClient;
import com.loadtest.orchestrator.metrics.PortalMetrics;
import com.loadtest.orchestrator.model.TestRunStatus;
import com.loadtest.orchestrator.persistence.PortalSettingsEntity;
import com.loadtest.orchestrator.persistence.ScriptEntity;
import com.loadtest.orchestrator.persistence.TestRunEntity;
import com.loadtest.orchestrator.persistence.TestRunRepository;
import com.loadtest.orchestrator.service.run.LaunchParams;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Инфраструктурный адаптер: заливка скрипта в GitLab и trigger pipeline.
 * HTTP выполняется вне txn создания прогона; результат пишется отдельной транзакцией.
 */
@Component
public class GitLabPipelineLauncher {

    private static final Logger log = LoggerFactory.getLogger(GitLabPipelineLauncher.class);

    private final GitLabClient gitLabClient;
    private final GitLabSettingsService gitLabSettingsService;
    private final TestRunRepository testRunRepository;
    private final TestRunMapper mapper;
    private final PortalMetrics metrics;
    private final TransactionTemplate tx;

    public GitLabPipelineLauncher(
            GitLabClient gitLabClient,
            GitLabSettingsService gitLabSettingsService,
            TestRunRepository testRunRepository,
            TestRunMapper mapper,
            PortalMetrics metrics,
            PlatformTransactionManager transactionManager) {
        this.gitLabClient = gitLabClient;
        this.gitLabSettingsService = gitLabSettingsService;
        this.testRunRepository = testRunRepository;
        this.mapper = mapper;
        this.metrics = metrics;
        this.tx = new TransactionTemplate(transactionManager);
    }

    public void launch(
            PortalSettingsEntity settings,
            TestRunEntity run,
            ScriptEntity script,
            LaunchParams launch) {
        requireConfigured(settings);
        String uploadToken = gitLabSettingsService.resolveUploadToken(settings)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Upload token не задан (настройки, Vault или GITLAB_UPLOAD_TOKEN)"));
        String triggerToken = gitLabSettingsService.resolveTriggerToken(settings)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Trigger token не задан (настройки, Vault или GITLAB_TRIGGER_TOKEN)"));

        String commitMsg = "portal: " + launch.testId() + " " + launch.scenarioPath();
        gitLabClient.upsertFile(
                settings.getGitlabBaseUrl(),
                uploadToken,
                settings.getGitlabProjectId(),
                launch.scenarioPath(),
                script.getContent(),
                commitMsg);
        log.info("Uploaded script for run {} path={}", run.getId(), launch.scenarioPath());

        GitLabClient.TriggerResult trigger = gitLabClient.triggerPipeline(
                settings.getGitlabBaseUrl(),
                settings.getGitlabProjectId(),
                triggerToken,
                pipelineVariables(run, launch));
        persistTriggerResult(run.getId(), launch.scenarioPath(), trigger);
        log.info("Triggered pipeline {} for run {}", trigger.pipelineId(), run.getId());
    }

    private void persistTriggerResult(UUID runId, String scenarioPath, GitLabClient.TriggerResult trigger) {
        tx.executeWithoutResult(status -> {
            TestRunEntity run = testRunRepository.findById(runId)
                    .orElseThrow(() -> new IllegalArgumentException("Прогон не найден"));
            mapper.appendEvent(run, "uploaded", "Скрипт залит в " + scenarioPath);
            run.setGitlabPipelineId(trigger.pipelineId());
            run.setGitlabWebUrl(trigger.webUrl());
            run.setStatus(TestRunStatus.fromGitLab(trigger.status()));
            if (run.getStatus() == TestRunStatus.RUNNING) {
                run.setStartedAt(Instant.now());
            }
            mapper.appendEvent(run, "triggered",
                    "Pipeline #" + trigger.pipelineId() + " (" + trigger.status() + ")");
            testRunRepository.save(run);
            metrics.recordRunStatus(run.getStatus());
        });
    }

    private static void requireConfigured(PortalSettingsEntity settings) {
        if (settings.getGitlabBaseUrl() == null || settings.getGitlabBaseUrl().isBlank()) {
            throw new IllegalArgumentException("GitLab base URL не настроен");
        }
        if (settings.getGitlabProjectId() == null || settings.getGitlabProjectId().isBlank()) {
            throw new IllegalArgumentException("GitLab project ID не настроен");
        }
    }

    private static Map<String, String> pipelineVariables(TestRunEntity run, LaunchParams launch) {
        Map<String, String> vars = new LinkedHashMap<>();
        vars.put("REPOSITORY", launch.repository());
        vars.put("RUN_ID", run.getTestId());
        vars.put("TOOL", run.getEngine());
        vars.put("SCENARIO_PATH", launch.scenarioPath());
        vars.put("POD_NAME", launch.podName());
        vars.put("REPLICAS", "1");
        vars.put("CPU", launch.cpu());
        vars.put("MEMORY", launch.memory());
        vars.put("START_TIME", launch.startTime());
        vars.put("END_TIME", launch.endTime());
        vars.put("PORTAL_RUN_ID", run.getId().toString());
        return vars;
    }
}
