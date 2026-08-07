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

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Инфраструктурный адаптер: заливка скрипта в GitLab и trigger pipeline.
 * Не знает про HTTP/DTO — только domain entities + настройки.
 */
@Component
public class GitLabPipelineLauncher {

    private static final Logger log = LoggerFactory.getLogger(GitLabPipelineLauncher.class);

    private final GitLabClient gitLabClient;
    private final GitLabSettingsService gitLabSettingsService;
    private final TestRunRepository testRunRepository;
    private final TestRunMapper mapper;
    private final PortalMetrics metrics;

    public GitLabPipelineLauncher(
            GitLabClient gitLabClient,
            GitLabSettingsService gitLabSettingsService,
            TestRunRepository testRunRepository,
            TestRunMapper mapper,
            PortalMetrics metrics) {
        this.gitLabClient = gitLabClient;
        this.gitLabSettingsService = gitLabSettingsService;
        this.testRunRepository = testRunRepository;
        this.mapper = mapper;
        this.metrics = metrics;
    }

    public void launch(
            PortalSettingsEntity settings,
            TestRunEntity run,
            ScriptEntity script,
            LaunchParams launch) {
        requireConfigured(settings);
        String uploadToken = gitLabSettingsService.resolveUploadToken(settings)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Upload token не задан (настройки или GITLAB_UPLOAD_TOKEN)"));
        String triggerToken = gitLabSettingsService.resolveTriggerToken(settings)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Trigger token не задан (настройки или GITLAB_TRIGGER_TOKEN)"));

        String commitMsg = "portal: " + launch.testId() + " " + launch.scenarioPath();
        gitLabClient.upsertFile(
                settings.getGitlabBaseUrl(),
                uploadToken,
                settings.getGitlabProjectId(),
                launch.scenarioPath(),
                script.getContent(),
                commitMsg);
        mapper.appendEvent(run, "uploaded", "Скрипт залит в " + launch.scenarioPath());
        log.info("Uploaded script for run {} path={}", run.getId(), launch.scenarioPath());

        GitLabClient.TriggerResult trigger = gitLabClient.triggerPipeline(
                settings.getGitlabBaseUrl(),
                settings.getGitlabProjectId(),
                triggerToken,
                pipelineVariables(run, launch));
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
        log.info("Triggered pipeline {} for run {}", trigger.pipelineId(), run.getId());
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
