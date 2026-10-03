package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.client.GitLabClient;
import com.loadtest.orchestrator.client.S3ScriptStore;
import com.loadtest.orchestrator.config.ExternalConnections;
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

import tools.jackson.core.JacksonException;

import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Скрипт в S3 (SeaweedFS), затем trigger GitLab pipeline.
 * HTTP выполняется вне txn создания прогона; результат пишется отдельной транзакцией.
 */
@Component
public class GitLabPipelineLauncher {

    private static final Logger log = LoggerFactory.getLogger(GitLabPipelineLauncher.class);
    private static final int CONTRACT_VERSION = 1;
    private static final Pattern JIRA = Pattern.compile("^[A-Z][A-Z0-9]*-[0-9]+$");

    private final GitLabClient gitLabClient;
    private final GitLabSettingsService gitLabSettingsService;
    private final S3ScriptStore scriptStore;
    private final ExternalConnections connections;
    private final TestRunRepository testRunRepository;
    private final TestRunMapper mapper;
    private final JsonSupport json;
    private final PortalMetrics metrics;
    private final TransactionTemplate tx;

    public GitLabPipelineLauncher(
            GitLabClient gitLabClient,
            GitLabSettingsService gitLabSettingsService,
            S3ScriptStore scriptStore,
            ExternalConnections connections,
            TestRunRepository testRunRepository,
            TestRunMapper mapper,
            JsonSupport json,
            PortalMetrics metrics,
            PlatformTransactionManager transactionManager) {
        this.gitLabClient = gitLabClient;
        this.gitLabSettingsService = gitLabSettingsService;
        this.scriptStore = scriptStore;
        this.connections = connections;
        this.testRunRepository = testRunRepository;
        this.mapper = mapper;
        this.json = json;
        this.metrics = metrics;
        this.tx = new TransactionTemplate(transactionManager);
    }

    public void launch(
            PortalSettingsEntity settings,
            TestRunEntity run,
            ScriptEntity script,
            LaunchParams launch) {
        String baseUrl = connections.gitlabBaseUrl(settings.getGitlabBaseUrl());
        String projectId = connections.gitlabProjectId(settings.getGitlabProjectId());
        String ref = connections.gitlabRef(settings.getGitlabTriggerRef());
        if (baseUrl.isBlank()) {
            throw new IllegalArgumentException("GitLab base URL не настроен");
        }
        if (projectId.isBlank()) {
            throw new IllegalArgumentException("GitLab project ID не настроен");
        }
        String triggerToken = gitLabSettingsService.resolveTriggerToken(settings)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Trigger token не задан (Vault, GITLAB_TRIGGER_TOKEN или настройки)"));

        String dest = launch.scenarioPath();
        S3ScriptStore.Stored stored = scriptStore.putRun(
                dest,
                script.getContent(),
                script.getFilename() != null ? script.getFilename() : dest);
        log.info("Uploaded script for run {} bucket={} key={} files={}",
                run.getId(), stored.bucket(), stored.primaryKey(), stored.files());

        LaunchParams effective = launch.withScenarioPath(stored.primaryKey());
        GitLabClient.TriggerResult trigger = gitLabClient.triggerPipeline(
                baseUrl,
                projectId,
                triggerToken,
                ref,
                pipelineVariables(run, effective, stored));
        boolean canceled = persistTriggerResult(run.getId(), stored, trigger);
        if (canceled) {
            cancelLatePipeline(settings, trigger.pipelineId());
        }
        log.info("Triggered pipeline {} for run {}", trigger.pipelineId(), run.getId());
    }

    /** @return true, если прогон успели отменить, пока скрипт заливался в S3 */
    private boolean persistTriggerResult(UUID runId, S3ScriptStore.Stored stored, GitLabClient.TriggerResult trigger) {
        Boolean canceled = tx.execute(status -> {
            TestRunEntity run = testRunRepository.findById(runId)
                    .orElseThrow(() -> new IllegalArgumentException("Прогон не найден"));
            Map<String, Object> params = new LinkedHashMap<>(json.readMap(run.getParamsJson()));
            params.put("scenario_path", stored.primaryKey());
            params.put("s3_bucket", stored.bucket());
            run.setParamsJson(json.write(params));
            mapper.appendEvent(run, "uploaded",
                    "Скрипт в s3://" + stored.bucket() + "/" + stored.primaryKey());
            if (run.getStatus() == TestRunStatus.CANCELED) {
                run.setGitlabPipelineId(trigger.pipelineId());
                run.setGitlabWebUrl(trigger.webUrl());
                mapper.appendEvent(run, "triggered",
                        "Pipeline #" + trigger.pipelineId() + " создан после отмены");
                testRunRepository.save(run);
                return true;
            }
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
            return false;
        });
        return Boolean.TRUE.equals(canceled);
    }

    private void cancelLatePipeline(PortalSettingsEntity settings, long pipelineId) {
        String token = connections.gitlabApiToken().orElse("");
        if (token.isBlank()) {
            log.warn("Pipeline {} started after cancel, API token is missing", pipelineId);
            return;
        }
        try {
            gitLabClient.cancelPipeline(
                    connections.gitlabBaseUrl(settings.getGitlabBaseUrl()),
                    connections.gitlabProjectId(settings.getGitlabProjectId()),
                    token,
                    pipelineId);
        } catch (RuntimeException ex) {
            log.warn("Failed to cancel late pipeline {}: {}", pipelineId, ex.getMessage());
        }
    }

    private Map<String, String> pipelineVariables(
            TestRunEntity run, LaunchParams launch, S3ScriptStore.Stored stored) {
        Map<String, String> vars = new LinkedHashMap<>();
        vars.put("CONTRACT_VERSION", Integer.toString(CONTRACT_VERSION));
        vars.put("RUN_SPEC_B64", runSpecB64(run, launch, stored));
        vars.put("REPOSITORY", launch.repository());
        vars.put("RUN_ID", run.getTestId());
        vars.put("TOOL", run.getEngine());
        vars.put("SCENARIO_PATH", launch.scenarioPath());
        vars.put("SCENARIO_CHECKSUM", stored.checksum());
        vars.put("S3_BUCKET", stored.bucket());
        vars.put("S3_MANIFEST_URL", stored.manifestUrl());
        vars.put("REPLICAS", "1");
        vars.put("CPU", launch.cpu());
        vars.put("MEMORY", launch.memory());
        vars.put("START_TIME", launch.startTime());
        vars.put("END_TIME", launch.endTime());
        vars.put("PORTAL_RUN_ID", run.getId().toString());
        return vars;
    }

    /** Контракт v1. checksum — sha256 файла, который лежит в S3 по scenario.path. */
    private String runSpecB64(TestRunEntity run, LaunchParams launch, S3ScriptStore.Stored stored) {
        Map<String, Object> spec = new LinkedHashMap<>();
        spec.put("contract_version", CONTRACT_VERSION);
        spec.put("run", runSection(run));
        spec.put("scenario", Map.of(
                "source", "s3",
                "path", launch.scenarioPath(),
                "checksum", stored.checksum()));
        spec.put("target", targetSection(run, launch));
        spec.put("resources", Map.of(
                "cpu", launch.cpu(),
                "memory", launch.memory(),
                "replicas", 1));
        if (!launch.startTime().isBlank() && !launch.endTime().isBlank()) {
            spec.put("schedule", Map.of("start", launch.startTime(), "end", launch.endTime()));
        }
        String requestedBy = clip(run.getUsername(), 128);
        if (!requestedBy.isBlank()) {
            spec.put("meta", Map.of("requested_by", requestedBy));
        }
        try {
            return Base64.getEncoder().encodeToString(json.mapper().writeValueAsBytes(spec));
        } catch (JacksonException ex) {
            throw new IllegalArgumentException("Не удалось собрать RUN_SPEC");
        }
    }

    private static Map<String, Object> runSection(TestRunEntity run) {
        Map<String, Object> block = new LinkedHashMap<>();
        block.put("tool", run.getEngine() == null ? "" : run.getEngine().trim().toLowerCase(Locale.ROOT));
        block.put("trigger", "portal");
        block.put("profile", "load");
        block.put("portal_run_id", run.getId().toString());
        String jira = run.getTestId() == null ? "" : run.getTestId().trim().toUpperCase(Locale.ROOT);
        if (JIRA.matcher(jira).matches()) {
            block.put("jira", jira);
        }
        String name = clip(run.getScenarioName(), 200);
        if (!name.isBlank()) {
            block.put("name", name);
        }
        return block;
    }

    private static Map<String, Object> targetSection(TestRunEntity run, LaunchParams launch) {
        Map<String, Object> block = new LinkedHashMap<>();
        String repository = launch.repository() == null ? "" : launch.repository().trim().toLowerCase(Locale.ROOT);
        block.put("repository", repository);
        String url = run.getTargetUrl() == null ? "" : run.getTargetUrl().trim();
        if (url.startsWith("http://") || url.startsWith("https://")) {
            block.put("base_url", clip(url, 2048));
        }
        return block;
    }

    private static String clip(String value, int max) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max);
    }
}
