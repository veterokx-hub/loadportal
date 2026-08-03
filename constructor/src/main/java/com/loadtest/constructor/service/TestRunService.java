package com.loadtest.constructor.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.loadtest.constructor.metrics.PortalMetrics;
import com.loadtest.constructor.model.TestRunStatus;
import com.loadtest.constructor.persistence.BuildRecordEntity;
import com.loadtest.constructor.persistence.BuildRecordRepository;
import com.loadtest.constructor.persistence.PortalSettingsEntity;
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
 * Жизненный цикл прогона: создание (queued) → обновление статуса из GitLab webhook.
 * Вызов GitLab Trigger пока не подключён — метрика created растёт без status=running.
 */
@Service
public class TestRunService {

    private static final Logger log = LoggerFactory.getLogger(TestRunService.class);

    private final TestRunRepository testRunRepository;
    private final BuildRecordRepository buildRecordRepository;
    private final PortalSettingsService portalSettingsService;
    private final GitLabSettingsService gitLabSettingsService;
    private final ScriptService scriptService;
    private final ObjectMapper objectMapper;
    private final PortalMetrics metrics;

    public TestRunService(
            TestRunRepository testRunRepository,
            BuildRecordRepository buildRecordRepository,
            PortalSettingsService portalSettingsService,
            GitLabSettingsService gitLabSettingsService,
            ScriptService scriptService,
            ObjectMapper objectMapper,
            PortalMetrics metrics) {
        this.testRunRepository = testRunRepository;
        this.buildRecordRepository = buildRecordRepository;
        this.portalSettingsService = portalSettingsService;
        this.gitLabSettingsService = gitLabSettingsService;
        this.scriptService = scriptService;
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
        if (scriptId != null) {
            scriptService.requireOwned(scriptId, ctx.username());
        }

        String paramsJson = writeJson(req.params() == null ? Map.of() : req.params());
        String labelsJson = writeJson(req.labels() == null ? Map.of() : req.labels());

        TestRunEntity run = new TestRunEntity(
                ctx.username(),
                scenarioName,
                engine,
                buildId,
                scriptId,
                req.testId().trim(),
                targetUrl,
                paramsJson,
                labelsJson);
        run.setGrafanaUrl(buildGrafanaUrl(settings, run));
        appendEvent(run, "created", "Прогон создан (test_id=" + run.getTestId() + ")");
        appendEvent(run, "queued", "Ожидает вызова GitLab CI");
        testRunRepository.save(run);
        metrics.recordRunCreated(engine);
        metrics.recordRunStatus(TestRunStatus.QUEUED);

        MDC.put("run_id", run.getId().toString());
        log.info("Created test run {} test_id={} script_id={} build_id={}",
                run.getId(), run.getTestId(), scriptId, buildId);
        return toDto(run);
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
            // Повторный вебхук с тем же статусом — считаем принятым, но статус не дублируем.
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
}
