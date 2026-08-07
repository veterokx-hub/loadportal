package com.loadtest.constructor.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.loadtest.constructor.client.GitLabClient;
import com.loadtest.constructor.metrics.PortalMetrics;
import com.loadtest.constructor.model.TestRunStatus;
import com.loadtest.constructor.persistence.BuildRecordEntity;
import com.loadtest.constructor.persistence.BuildRecordRepository;
import com.loadtest.constructor.persistence.PortalSettingsEntity;
import com.loadtest.constructor.persistence.ScriptEntity;
import com.loadtest.constructor.persistence.TestRunEntity;
import com.loadtest.constructor.persistence.TestRunRepository;
import com.loadtest.constructor.security.AuthContext;
import com.loadtest.constructor.web.dto.CreateTestRunRequest;
import com.loadtest.constructor.web.dto.TestRunDto;
import com.loadtest.constructor.web.dto.TestRunEventDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

/**
 * Жизненный цикл прогона: заливка скрипта в Git → trigger pipeline → статусы из webhook.
 */
@Service
public class TestRunService {

    private static final Logger log = LoggerFactory.getLogger(TestRunService.class);
    private static final String DEFAULT_CPU = "500m";
    private static final String DEFAULT_MEMORY = "2Gi";

    private final TestRunRepository testRunRepository;
    private final BuildRecordRepository buildRecordRepository;
    private final PortalSettingsService portalSettingsService;
    private final GitLabSettingsService gitLabSettingsService;
    private final ScriptService scriptService;
    private final GitLabClient gitLabClient;
    private final ObjectMapper objectMapper;
    private final PortalMetrics metrics;

    public TestRunService(
            TestRunRepository testRunRepository,
            BuildRecordRepository buildRecordRepository,
            PortalSettingsService portalSettingsService,
            GitLabSettingsService gitLabSettingsService,
            ScriptService scriptService,
            GitLabClient gitLabClient,
            ObjectMapper objectMapper,
            PortalMetrics metrics) {
        this.testRunRepository = testRunRepository;
        this.buildRecordRepository = buildRecordRepository;
        this.portalSettingsService = portalSettingsService;
        this.gitLabSettingsService = gitLabSettingsService;
        this.scriptService = scriptService;
        this.gitLabClient = gitLabClient;
        this.objectMapper = objectMapper;
        this.metrics = metrics;
    }

    public List<TestRunDto> listRuns(AuthContext ctx) {
        List<TestRunEntity> rows = ctx.isAdmin()
                ? testRunRepository.findAllByOrderByCreatedAtDesc()
                : testRunRepository.findByUsernameOrderByCreatedAtDesc(ctx.username());
        return rows.stream().map(this::toDto).toList();
    }

    public TestRunDto getRun(UUID id, AuthContext ctx) {
        TestRunEntity run = testRunRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Прогон не найден"));
        if (!ctx.isAdmin() && !run.getUsername().equals(ctx.username())) {
            throw new IllegalArgumentException("Нет доступа к этому прогону");
        }
        return toDto(run);
    }

    @Transactional
    public TestRunDto create(CreateTestRunRequest req, AuthContext ctx) {
        validateCreate(req);
        PortalSettingsEntity settings = portalSettingsService.loadEntity();

        UUID buildId = parseBuildId(req.buildId());
        UUID scriptId = parseUuid(req.scriptId(), "script_id");
        String engine = normalizeEngine(req.engine(), buildId, scriptId, ctx.username());
        String scenarioName = resolveScenarioName(req, buildId, scriptId, ctx.username());
        String targetUrl = resolveTargetUrl(req, buildId, ctx.username());

        if (scriptId == null && buildId != null) {
            var linked = scriptService.findLatestForBuild(buildId);
            if (linked != null) {
                scriptId = linked.getId();
            }
        }
        if (scriptId == null) {
            throw new IllegalArgumentException(
                    "Нет сохранённого скрипта для запуска — сохраните сборку или загрузите файл");
        }
        ScriptEntity script = scriptService.requireContent(scriptId, ctx.username());

        String testId = req.testId().trim();
        String filename = stripPath(script.getFilename());
        String podName = firstNonBlank(req.podName(), filename);
        String repository = firstNonBlank(
                req.repository(),
                settings.getGitlabRepository(),
                "lt-ump");
        String cpu = firstNonBlank(req.cpu(), DEFAULT_CPU);
        String memory = firstNonBlank(req.memory(), DEFAULT_MEMORY);
        String startTime = requireTime(req.startTime(), "start_time");
        String endTime = requireTime(req.endTime(), "end_time");

        Map<String, Object> params = new LinkedHashMap<>(req.params() == null ? Map.of() : req.params());
        params.put("cpu", cpu);
        params.put("memory", memory);
        params.put("start_time", startTime);
        params.put("end_time", endTime);
        params.put("pod_name", podName);
        params.put("repository", repository);
        params.put("replicas", "1");

        String paramsJson = writeJson(params);
        String labelsJson = writeJson(req.labels() == null ? Map.of() : req.labels());

        TestRunEntity run = new TestRunEntity(
                ctx.username(),
                scenarioName,
                engine,
                buildId,
                scriptId,
                testId,
                targetUrl,
                paramsJson,
                labelsJson);
        run.setGrafanaUrl(buildGrafanaUrl(settings, run));
        appendEvent(run, "created", "Прогон создан (test_id=" + run.getTestId() + ")");
        testRunRepository.save(run);

        // Путь после save: подпапка = portal run_id, чтобы прогоны одной Jira не перетирали файл.
        String scenarioPath = firstNonBlank(
                req.scenarioPath(),
                "auto_lt/" + testId + "/" + run.getId() + "/" + filename);
        params.put("scenario_path", scenarioPath);
        run.setParamsJson(writeJson(params));
        testRunRepository.save(run);

        metrics.recordRunCreated(engine);
        metrics.recordRunStatus(TestRunStatus.QUEUED);

        MDC.put("run_id", run.getId().toString());
        log.info("Created test run {} test_id={} script_id={} build_id={} path={}",
                run.getId(), run.getTestId(), scriptId, buildId, scenarioPath);

        try {
            uploadAndTrigger(settings, run, script, scenarioPath, podName, repository, cpu, memory,
                    startTime, endTime);
        } catch (RuntimeException ex) {
            run.setStatus(TestRunStatus.FAILED);
            run.setErrorMessage(truncate(ex.getMessage(), 2000));
            run.setEndedAt(Instant.now());
            appendEvent(run, "error", run.getErrorMessage());
            testRunRepository.save(run);
            metrics.recordRunStatus(TestRunStatus.FAILED);
            log.warn("Run {} failed to start: {}", run.getId(), ex.getMessage());
        }

        return toDto(run);
    }

    private void uploadAndTrigger(
            PortalSettingsEntity settings,
            TestRunEntity run,
            ScriptEntity script,
            String scenarioPath,
            String podName,
            String repository,
            String cpu,
            String memory,
            String startTime,
            String endTime) {
        if (settings.getGitlabBaseUrl() == null || settings.getGitlabBaseUrl().isBlank()) {
            throw new IllegalArgumentException("GitLab base URL не настроен");
        }
        if (settings.getGitlabProjectId() == null || settings.getGitlabProjectId().isBlank()) {
            throw new IllegalArgumentException("GitLab project ID не настроен");
        }
        String uploadToken = gitLabSettingsService.resolveUploadToken(settings)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Upload token не задан (настройки или GITLAB_UPLOAD_TOKEN)"));
        String triggerToken = gitLabSettingsService.resolveTriggerToken(settings)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Trigger token не задан (настройки или GITLAB_TRIGGER_TOKEN)"));

        String commitMsg = "portal: " + run.getTestId() + " " + scenarioPath;
        gitLabClient.upsertFile(
                settings.getGitlabBaseUrl(),
                uploadToken,
                settings.getGitlabProjectId(),
                scenarioPath,
                script.getContent(),
                commitMsg);
        appendEvent(run, "uploaded", "Скрипт залит в " + scenarioPath);
        log.info("Uploaded script for run {} path={}", run.getId(), scenarioPath);

        Map<String, String> vars = new LinkedHashMap<>();
        vars.put("REPOSITORY", repository);
        vars.put("RUN_ID", run.getTestId());
        vars.put("TOOL", run.getEngine());
        vars.put("SCENARIO_PATH", scenarioPath);
        vars.put("POD_NAME", podName);
        vars.put("REPLICAS", "1");
        vars.put("CPU", cpu);
        vars.put("MEMORY", memory);
        vars.put("START_TIME", startTime);
        vars.put("END_TIME", endTime);
        // Помогает связать webhook с прогоном, если pipeline variables доступны.
        vars.put("PORTAL_RUN_ID", run.getId().toString());

        GitLabClient.TriggerResult trigger = gitLabClient.triggerPipeline(
                settings.getGitlabBaseUrl(),
                settings.getGitlabProjectId(),
                triggerToken,
                vars);
        run.setGitlabPipelineId(trigger.pipelineId());
        run.setGitlabWebUrl(trigger.webUrl());
        run.setStatus(TestRunStatus.fromGitLab(trigger.status()));
        if (run.getStatus() == TestRunStatus.RUNNING) {
            run.setStartedAt(Instant.now());
        }
        appendEvent(run, "triggered",
                "Pipeline #" + trigger.pipelineId() + " (" + trigger.status() + ")");
        testRunRepository.save(run);
        metrics.recordRunStatus(run.getStatus());
        log.info("Triggered pipeline {} for run {}", trigger.pipelineId(), run.getId());
    }

    @Transactional
    public void applyGitLabWebhook(Long pipelineId, String gitlabStatus, String webUrl, UUID runIdHint) {
        log.info("GitLab webhook pipeline={} status={} runHint={}", pipelineId, gitlabStatus, runIdHint);
        TestRunEntity run = null;
        if (runIdHint != null) {
            run = testRunRepository.findById(runIdHint).orElse(null);
        }
        if (run == null && pipelineId != null) {
            run = testRunRepository.findByGitlabPipelineId(pipelineId).orElse(null);
        }
        if (run == null) {
            log.warn("Webhook: run not found for pipeline {}", pipelineId);
            metrics.recordGitLabWebhook("unknown_pipeline");
            return;
        }

        MDC.put("run_id", run.getId().toString());

        TestRunStatus newStatus = TestRunStatus.fromGitLab(gitlabStatus);
        if (run.getStatus() == newStatus && Objects.equals(run.getGitlabWebUrl(), webUrl)) {
            metrics.recordGitLabWebhook("accepted");
            return;
        }
        run.setStatus(newStatus);
        if (webUrl != null && !webUrl.isBlank()) {
            run.setGitlabWebUrl(webUrl);
        }
        if (run.getStartedAt() == null && newStatus == TestRunStatus.RUNNING) {
            run.setStartedAt(Instant.now());
        }
        if (isTerminal(newStatus)) {
            run.setEndedAt(Instant.now());
            PortalSettingsEntity settings = portalSettingsService.loadEntity();
            run.setGrafanaUrl(buildGrafanaUrl(settings, run));
        }
        appendEvent(run, "status", gitlabStatus + " → " + newStatus.name());
        testRunRepository.save(run);
        metrics.recordRunStatus(newStatus);
        metrics.recordGitLabWebhook("accepted");
    }

    public boolean verifyWebhookSecret(String providedSecret) {
        PortalSettingsEntity settings = portalSettingsService.loadEntity();
        Optional<String> expected = gitLabSettingsService.resolveWebhookSecret(settings);
        if (expected.isEmpty()) {
            log.warn("Webhook secret not configured — rejecting");
            return false;
        }
        return expected.get().equals(providedSecret);
    }

    private void validateCreate(CreateTestRunRequest req) {
        if (req.testId() == null || req.testId().isBlank()) {
            throw new IllegalArgumentException("Укажите test_id (ключ задачичи в Jira)");
        }
        boolean hasBuild = req.buildId() != null && !req.buildId().isBlank();
        boolean hasScript = req.scriptId() != null && !req.scriptId().isBlank();
        if (!hasBuild && !hasScript) {
            throw new IllegalArgumentException("Выберите сборку или загрузите скрипт");
        }
        if (req.startTime() == null || req.startTime().isBlank()) {
            throw new IllegalArgumentException("Укажите start_time");
        }
        if (req.endTime() == null || req.endTime().isBlank()) {
            throw new IllegalArgumentException("Укажите end_time");
        }
    }

    private UUID parseBuildId(String buildId) {
        return parseUuid(buildId, "build_id");
    }

    private UUID parseUuid(String value, String field) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Некорректный " + field);
        }
    }

    private String normalizeEngine(String engine, UUID buildId, UUID scriptId, String username) {
        if (engine != null && !engine.isBlank()) {
            return engine.trim().toLowerCase();
        }
        if (scriptId != null) {
            return scriptService.requireOwned(scriptId, username).getEngine();
        }
        if (buildId != null) {
            BuildRecordEntity build = buildRecordRepository.findById(buildId)
                    .orElseThrow(() -> new IllegalArgumentException("Сборка не найдена"));
            if (!build.getUsername().equals(username)) {
                throw new IllegalArgumentException("Сборка принадлежит другому пользователю");
            }
            return build.getEngine();
        }
        throw new IllegalArgumentException("Укажите движок (jmeter/k6) или сборку/скрипт");
    }

    private String resolveTargetUrl(CreateTestRunRequest req, UUID buildId, String username) {
        if (req.targetUrl() != null && !req.targetUrl().isBlank()) {
            return req.targetUrl().trim();
        }
        if (buildId != null) {
            try {
                var scenario = objectMapper.readTree(
                        buildRecordRepository.findById(buildId)
                                .filter(b -> b.getUsername().equals(username))
                                .map(BuildRecordEntity::getScenarioJson)
                                .orElse("{}"));
                String base = scenario.path("base_url").asText("");
                if (!base.isBlank()) {
                    return base;
                }
            } catch (Exception ignored) {
                /* fall through */
            }
        }
        return "";
    }

    private String resolveScenarioName(CreateTestRunRequest req, UUID buildId, UUID scriptId, String username) {
        if (req.scenarioName() != null && !req.scenarioName().isBlank()) {
            return req.scenarioName().trim();
        }
        if (buildId != null) {
            return buildRecordRepository.findById(buildId)
                    .map(BuildRecordEntity::getScenarioName)
                    .orElse("Сценарий");
        }
        if (scriptId != null) {
            return scriptService.requireOwned(scriptId, username).getFilename();
        }
        throw new IllegalArgumentException("Укажите имя сценария, build_id или script_id");
    }

    private String buildGrafanaUrl(PortalSettingsEntity settings, TestRunEntity run) {
        if (settings.getGrafanaBaseUrl().isBlank() || settings.getGrafanaDashboardTemplate().isBlank()) {
            return "";
        }
        String template = settings.getGrafanaDashboardTemplate();
        String url = template
                .replace("{run_id}", run.getId().toString())
                .replace("{engine}", run.getEngine());
        if (!url.startsWith("http")) {
            url = settings.getGrafanaBaseUrl().replaceAll("/$", "") + url;
        }
        if (run.getStartedAt() != null) {
            url = url.replace("{from}", String.valueOf(run.getStartedAt().toEpochMilli()));
        }
        if (run.getEndedAt() != null) {
            url = url.replace("{to}", String.valueOf(run.getEndedAt().toEpochMilli()));
        }
        return url;
    }

    private void appendEvent(TestRunEntity run, String event, String detail) {
        try {
            List<TestRunEventDto> events = objectMapper.readValue(
                    run.getEventsJson() == null || run.getEventsJson().isBlank() ? "[]" : run.getEventsJson(),
                    new TypeReference<List<TestRunEventDto>>() {});
            List<TestRunEventDto> mutable = new ArrayList<>(events);
            mutable.add(new TestRunEventDto(Instant.now(), event, detail));
            run.setEventsJson(objectMapper.writeValueAsString(mutable));
        } catch (Exception ex) {
            run.setEventsJson("[]");
        }
    }

    private TestRunDto toDto(TestRunEntity run) {
        return new TestRunDto(
                run.getId().toString(),
                run.getTestId(),
                run.getUsername(),
                run.getScenarioName(),
                run.getEngine(),
                run.getBuildId() != null ? run.getBuildId().toString() : null,
                run.getScriptId() != null ? run.getScriptId().toString() : null,
                run.getTargetUrl(),
                readMap(run.getParamsJson()),
                readStringMap(run.getLabelsJson()),
                run.getStatus().name().toLowerCase(),
                run.getGitlabPipelineId(),
                run.getGitlabWebUrl(),
                run.getGrafanaUrl(),
                run.getStartedAt(),
                run.getEndedAt(),
                run.getErrorMessage(),
                run.getCreatedAt(),
                readEvents(run.getEventsJson()));
    }

    private Map<String, Object> readMap(String json) {
        try {
            if (json == null || json.isBlank()) {
                return Map.of();
            }
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception ex) {
            return Map.of();
        }
    }

    private Map<String, String> readStringMap(String json) {
        try {
            if (json == null || json.isBlank()) {
                return Map.of();
            }
            return objectMapper.readValue(json, new TypeReference<Map<String, String>>() {});
        } catch (Exception ex) {
            return Map.of();
        }
    }

    private List<TestRunEventDto> readEvents(String json) {
        try {
            if (json == null || json.isBlank()) {
                return List.of();
            }
            return objectMapper.readValue(json, new TypeReference<List<TestRunEventDto>>() {});
        } catch (Exception ex) {
            return List.of();
        }
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ex) {
            return "{}";
        }
    }

    private static boolean isTerminal(TestRunStatus status) {
        return status == TestRunStatus.SUCCEEDED
                || status == TestRunStatus.FAILED
                || status == TestRunStatus.CANCELED;
    }

    private static String requireTime(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Укажите " + field);
        }
        return value.trim();
    }

    private static String firstNonBlank(String... values) {
        if (values == null) {
            return "";
        }
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                return v.trim();
            }
        }
        return "";
    }

    private static String stripPath(String filename) {
        if (filename == null) {
            return "script";
        }
        int slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
        return slash >= 0 ? filename.substring(slash + 1) : filename;
    }

    private static String truncate(String s, int max) {
        if (s == null) {
            return "";
        }
        return s.length() <= max ? s : s.substring(0, max);
    }
}
