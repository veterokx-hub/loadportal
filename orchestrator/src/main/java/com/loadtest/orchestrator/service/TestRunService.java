package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.metrics.PortalMetrics;
import com.loadtest.orchestrator.model.TestRunStatus;
import com.loadtest.orchestrator.persistence.PortalSettingsEntity;
import com.loadtest.orchestrator.persistence.ScriptEntity;
import com.loadtest.orchestrator.persistence.TestRunEntity;
import com.loadtest.orchestrator.persistence.TestRunRepository;
import com.loadtest.orchestrator.security.AuthContext;
import com.loadtest.orchestrator.service.run.LaunchParams;
import com.loadtest.orchestrator.service.run.ScriptSource;
import com.loadtest.orchestrator.web.dto.CreateTestRunRequest;
import com.loadtest.orchestrator.web.dto.TestRunDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Application service: оркестрация создания/чтения прогонов.
 * Валидация, резолв скрипта, GitLab launch и webhook вынесены в отдельные компоненты (SRP).
 */
@Service
public class TestRunService {

    private static final Logger log = LoggerFactory.getLogger(TestRunService.class);
    private static final String DEFAULT_CPU = "500m";
    private static final String DEFAULT_MEMORY = "2Gi";
    private static final String DEFAULT_REPOSITORY = "lt-ump";

    private final TestRunRepository testRunRepository;
    private final PortalSettingsService portalSettingsService;
    private final CreateTestRunValidator validator;
    private final ScriptSourceResolver scriptSourceResolver;
    private final GitLabPipelineLauncher pipelineLauncher;
    private final TestRunMapper mapper;
    private final JsonSupport json;
    private final PortalMetrics metrics;

    public TestRunService(
            TestRunRepository testRunRepository,
            PortalSettingsService portalSettingsService,
            CreateTestRunValidator validator,
            ScriptSourceResolver scriptSourceResolver,
            GitLabPipelineLauncher pipelineLauncher,
            TestRunMapper mapper,
            JsonSupport json,
            PortalMetrics metrics) {
        this.testRunRepository = testRunRepository;
        this.portalSettingsService = portalSettingsService;
        this.validator = validator;
        this.scriptSourceResolver = scriptSourceResolver;
        this.pipelineLauncher = pipelineLauncher;
        this.mapper = mapper;
        this.json = json;
        this.metrics = metrics;
    }

    public List<TestRunDto> listRuns(AuthContext ctx) {
        List<TestRunEntity> rows = ctx.isAdmin()
                ? testRunRepository.findAllByOrderByCreatedAtDesc()
                : testRunRepository.findByUsernameOrderByCreatedAtDesc(ctx.username());
        return rows.stream().map(mapper::toDto).toList();
    }

    public TestRunDto getRun(UUID id, AuthContext ctx) {
        TestRunEntity run = testRunRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Прогон не найден"));
        if (!ctx.isAdmin() && !run.getUsername().equals(ctx.username())) {
            throw new IllegalArgumentException("Нет доступа к этому прогону");
        }
        return mapper.toDto(run);
    }

    /**
     * Создаёт прогон, заливает скрипт и триггерит pipeline.
     * При ошибке GitLab прогон сохраняется со статусом {@code failed}.
     */
    @Transactional
    public TestRunDto create(CreateTestRunRequest req, AuthContext ctx) {
        validator.validate(req);
        PortalSettingsEntity settings = portalSettingsService.loadEntity();
        ScriptSource source = scriptSourceResolver.resolve(req, ctx.username());

        TestRunEntity run = persistQueuedRun(req, ctx.username(), settings, source);
        LaunchParams launch = buildLaunchParams(req, settings, source.script(), run.getId());
        applyLaunchParams(run, launch);

        metrics.recordRunCreated(source.engine());
        metrics.recordRunStatus(TestRunStatus.QUEUED);
        MDC.put("run_id", run.getId().toString());
        log.info("Created test run {} test_id={} script_id={} build_id={} path={}",
                run.getId(), run.getTestId(), source.scriptId(), source.buildId(), launch.scenarioPath());

        try {
            pipelineLauncher.launch(settings, run, source.script(), launch);
        } catch (RuntimeException ex) {
            markFailed(run, ex);
        }
        return mapper.toDto(run);
    }

    private TestRunEntity persistQueuedRun(
            CreateTestRunRequest req,
            String username,
            PortalSettingsEntity settings,
            ScriptSource source) {
        String testId = req.testId().trim();
        Map<String, Object> params = new LinkedHashMap<>(req.params() == null ? Map.of() : req.params());
        TestRunEntity run = new TestRunEntity(
                username,
                source.scenarioName(),
                source.engine(),
                source.buildId(),
                source.scriptId(),
                testId,
                source.targetUrl(),
                json.write(params),
                json.write(req.labels() == null ? Map.of() : req.labels()));
        run.setGrafanaUrl(mapper.buildGrafanaUrl(settings, run));
        mapper.appendEvent(run, "created", "Прогон создан (test_id=" + testId + ")");
        return testRunRepository.save(run);
    }

    private LaunchParams buildLaunchParams(
            CreateTestRunRequest req,
            PortalSettingsEntity settings,
            ScriptEntity script,
            UUID runId) {
        String testId = req.testId().trim();
        String filename = TextSupport.stripFilename(script.getFilename());
        String scenarioPath = TextSupport.firstNonBlank(
                req.scenarioPath(),
                "auto_lt/" + testId + "/" + runId + "/" + filename);
        return new LaunchParams(
                testId,
                scenarioPath,
                TextSupport.firstNonBlank(req.podName(), filename),
                TextSupport.firstNonBlank(req.repository(), settings.getGitlabRepository(), DEFAULT_REPOSITORY),
                TextSupport.firstNonBlank(req.cpu(), DEFAULT_CPU),
                TextSupport.firstNonBlank(req.memory(), DEFAULT_MEMORY),
                TextSupport.requireNonBlank(req.startTime(), "start_time"),
                TextSupport.requireNonBlank(req.endTime(), "end_time"));
    }

    private void applyLaunchParams(TestRunEntity run, LaunchParams launch) {
        Map<String, Object> params = new LinkedHashMap<>(json.readMap(run.getParamsJson()));
        params.put("cpu", launch.cpu());
        params.put("memory", launch.memory());
        params.put("start_time", launch.startTime());
        params.put("end_time", launch.endTime());
        params.put("pod_name", launch.podName());
        params.put("repository", launch.repository());
        params.put("replicas", "1");
        params.put("scenario_path", launch.scenarioPath());
        run.setParamsJson(json.write(params));
        testRunRepository.save(run);
    }

    private void markFailed(TestRunEntity run, RuntimeException ex) {
        run.setStatus(TestRunStatus.FAILED);
        run.setErrorMessage(TextSupport.truncate(ex.getMessage(), 2000));
        run.setEndedAt(Instant.now());
        mapper.appendEvent(run, "error", run.getErrorMessage());
        testRunRepository.save(run);
        metrics.recordRunStatus(TestRunStatus.FAILED);
        log.warn("Run {} failed to start: {}", run.getId(), ex.getMessage());
    }
}
