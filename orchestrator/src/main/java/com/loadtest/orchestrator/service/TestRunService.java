package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.client.GitLabClient;
import com.loadtest.orchestrator.client.GitLabException;
import com.loadtest.orchestrator.config.ExternalConnections;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Application service: оркестрация создания/чтения прогонов.
 * HTTP к GitLab выполняется вне транзакции БД.
 */
@Service
public class TestRunService {

    private static final Logger log = LoggerFactory.getLogger(TestRunService.class);
    private static final String DEFAULT_CPU = "2";
    private static final String DEFAULT_MEMORY = "4Gi";
    private static final String DEFAULT_REPOSITORY = "lt-ump";

    private final TestRunRepository testRunRepository;
    private final PortalSettingsService portalSettingsService;
    private final ScriptSourceResolver scriptSourceResolver;
    private final GitLabPipelineLauncher pipelineLauncher;
    private final TestRunMapper mapper;
    private final JsonSupport json;
    private final PortalMetrics metrics;
    private final TransactionTemplate tx;
    private final AuditService auditService;
    private final ExternalConnections connections;
    private final GitLabClient gitLabClient;

    public TestRunService(
            TestRunRepository testRunRepository,
            PortalSettingsService portalSettingsService,
            ScriptSourceResolver scriptSourceResolver,
            GitLabPipelineLauncher pipelineLauncher,
            TestRunMapper mapper,
            JsonSupport json,
            PortalMetrics metrics,
            PlatformTransactionManager transactionManager,
            AuditService auditService,
            ExternalConnections connections,
            GitLabClient gitLabClient) {
        this.testRunRepository = testRunRepository;
        this.portalSettingsService = portalSettingsService;
        this.scriptSourceResolver = scriptSourceResolver;
        this.pipelineLauncher = pipelineLauncher;
        this.mapper = mapper;
        this.json = json;
        this.metrics = metrics;
        this.tx = new TransactionTemplate(transactionManager);
        this.auditService = auditService;
        this.connections = connections;
        this.gitLabClient = gitLabClient;
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
     * Останавливает прогон: GitLab cancel pipeline (нужен API-токен, trigger token это не умеет),
     * затем статус {@code canceled}. Поды генератора снимает CI, когда job прерван.
     */
    public TestRunDto cancel(UUID id, AuthContext ctx) {
        TestRunEntity run = testRunRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Прогон не найден"));
        if (!ctx.isAdmin() && !run.getUsername().equals(ctx.username())) {
            throw new IllegalArgumentException("Нет доступа к этому прогону");
        }
        if (run.getStatus().isTerminal()) {
            throw new IllegalArgumentException("Прогон уже завершён");
        }
        Long pipelineId = run.getGitlabPipelineId();
        if (pipelineId != null) {
            PortalSettingsEntity settings = portalSettingsService.loadEntity();
            String token = connections.gitlabApiToken().orElseThrow(() -> new IllegalArgumentException(
                    "Нет API-токена GitLab (Vault loadtest/gitlab/api-token или GITLAB_API_TOKEN)"));
            gitLabClient.cancelPipeline(
                    connections.gitlabBaseUrl(settings.getGitlabBaseUrl()),
                    connections.gitlabProjectId(settings.getGitlabProjectId()),
                    token,
                    pipelineId);
        }
        tx.executeWithoutResult(status -> markCanceled(id, pipelineId));
        auditService.record(ctx.username(), AuditService.RUN_CANCEL, id.toString());
        return mapper.toDto(testRunRepository.findById(id).orElseThrow());
    }

    /**
     * Создаёт прогон, заливает скрипт и триггерит pipeline.
     * При ошибке GitLab прогон сохраняется со статусом {@code failed}.
     */
    public TestRunDto create(CreateTestRunRequest req, AuthContext ctx) {
        validateCreate(req);
        PortalSettingsEntity settings = portalSettingsService.loadEntity();
        ScriptSource source = scriptSourceResolver.resolve(req, ctx.username());

        QueuedRun queued = tx.execute(status -> persistQueuedRun(req, ctx.username(), settings, source));
        if (queued == null) {
            throw new IllegalStateException("Не удалось создать прогон");
        }

        metrics.recordRunCreated(source.engine());
        metrics.recordRunStatus(TestRunStatus.QUEUED);
        auditService.record(
                ctx.username(),
                AuditService.RUN_START,
                source.engine() + " " + queued.run().getTestId());

        MDC.put("run_id", queued.run().getId().toString());
        try {
            log.info("Created test run {} test_id={} script_id={} build_id={} path={}",
                    queued.run().getId(), queued.run().getTestId(),
                    source.scriptId(), source.buildId(), queued.launch().scenarioPath());
            pipelineLauncher.launch(settings, queued.run(), source.script(), queued.launch());
        } catch (RuntimeException ex) {
            tx.executeWithoutResult(status -> markFailed(queued.run().getId(), ex));
            log.warn("Run {} failed to start: {}", queued.run().getId(), ex.getMessage());
            if (!(ex instanceof GitLabException) && !(ex instanceof IllegalArgumentException)) {
                throw ex;
            }
        } finally {
            MDC.remove("run_id");
        }

        return mapper.toDto(testRunRepository.findById(queued.run().getId()).orElseThrow());
    }

    private QueuedRun persistQueuedRun(
            CreateTestRunRequest req,
            String username,
            PortalSettingsEntity settings,
            ScriptSource source) {
        String testId = req.testId().trim();
        String filename = TextSupport.stripFilename(source.script().getFilename());
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
        run.setTarget(req.targetCluster(), req.targetNamespace(), req.targetService(), req.targetContainer());
        mapper.appendEvent(run, "created", "Прогон создан (test_id=" + testId + ")");
        run = testRunRepository.save(run);

        LaunchParams launch = buildLaunchParams(req, settings, source.script(), run.getId(), testId, filename);
        applyLaunchParams(run, launch);
        run.setGrafanaUrl(mapper.buildGrafanaUrl(settings, run));
        run = testRunRepository.save(run);
        return new QueuedRun(run, launch);
    }

    private LaunchParams buildLaunchParams(
            CreateTestRunRequest req,
            PortalSettingsEntity settings,
            ScriptEntity script,
            UUID runId,
            String testId,
            String filename) {
        String scenarioPath = "scenarios/" + testId + "/" + runId + "/" + safeFilename(filename);
        return new LaunchParams(
                testId,
                scenarioPath,
                TextSupport.firstNonBlank(req.podName(), filename),
                TextSupport.firstNonBlank(
                        req.repository(),
                        connections.gitlabRepository(settings.getGitlabRepository()),
                        DEFAULT_REPOSITORY),
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
    }

    private void markCanceled(UUID runId, Long pipelineId) {
        TestRunEntity run = testRunRepository.findById(runId).orElse(null);
        if (run == null || run.getStatus().isTerminal()) {
            return;
        }
        run.setStatus(TestRunStatus.CANCELED);
        run.setEndedAt(Instant.now());
        mapper.appendEvent(run, "canceled", pipelineId == null
                ? "Отменён до старта pipeline"
                : "Pipeline #" + pipelineId + " отменён");
        testRunRepository.save(run);
        metrics.recordRunStatus(TestRunStatus.CANCELED);
    }

    private void markFailed(UUID runId, RuntimeException ex) {
        TestRunEntity run = testRunRepository.findById(runId).orElse(null);
        if (run == null) {
            return;
        }
        run.setStatus(TestRunStatus.FAILED);
        String msg = ex instanceof IllegalArgumentException && ex.getMessage() != null
                ? ex.getMessage()
                : "Не удалось запустить прогон";
        run.setErrorMessage(TextSupport.truncate(msg, 2000));
        run.setEndedAt(Instant.now());
        mapper.appendEvent(run, "error", run.getErrorMessage());
        testRunRepository.save(run);
        metrics.recordRunStatus(TestRunStatus.FAILED);
    }

    private void validateCreate(CreateTestRunRequest req) {
        if (req == null) {
            throw new IllegalArgumentException("Тело запроса обязательно");
        }
        if (req.testId() == null || req.testId().isBlank()) {
            throw new IllegalArgumentException("Укажите test_id (ключ задачичи в Jira)");
        }
        boolean hasBuild = req.buildId() != null && !req.buildId().isBlank();
        boolean hasScript = req.scriptId() != null && !req.scriptId().isBlank();
        if (!hasBuild && !hasScript) {
            throw new IllegalArgumentException("Выберите сборку или загрузите скрипт");
        }
        TextSupport.requireNonBlank(req.startTime(), "start_time");
        TextSupport.requireNonBlank(req.endTime(), "end_time");
    }

    private static String safeFilename(String filename) {
        String n = filename == null ? "scenario" : filename.replace('\\', '/');
        int slash = n.lastIndexOf('/');
        if (slash >= 0) {
            n = n.substring(slash + 1);
        }
        n = n.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (n.isBlank() || n.contains("..")) {
            return "scenario";
        }
        return n;
    }

    private record QueuedRun(TestRunEntity run, LaunchParams launch) {
    }
}
