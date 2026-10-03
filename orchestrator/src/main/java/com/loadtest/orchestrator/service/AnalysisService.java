package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.client.AnalysisClient;
import com.loadtest.orchestrator.metrics.PortalMetrics;
import com.loadtest.orchestrator.model.AnalysisStatus;
import com.loadtest.orchestrator.model.UserRole;
import com.loadtest.orchestrator.persistence.AnalysisRunEntity;
import com.loadtest.orchestrator.persistence.AnalysisRunRepository;
import com.loadtest.orchestrator.persistence.TestRunEntity;
import com.loadtest.orchestrator.persistence.TestRunRepository;
import com.loadtest.orchestrator.security.AuthContext;
import com.loadtest.orchestrator.web.dto.AnalysisDtos;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Модуль «Анализ» на стороне портала: хранение отчётов и постановка задач.
 *
 * <p>Анализ идёт в фоне, а не в HTTP-запросе пользователя: суточный тест — это
 * десятки запросов в VictoriaMetrics, и держать соединение браузера всё это время
 * бессмысленно. Запись создаётся сразу в статусе {@code queued}, UI опрашивает её.
 *
 * <p>Пул на два потока выбран сознательно: анализ — это в первую очередь нагрузка
 * на источник метрик, и он сам себя ограничивает по конкурентности внутри. Больше
 * потоков здесь означают только больше одновременных тяжёлых запросов к VM.
 */
@Service
public class AnalysisService {

    private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);
    /** Тест короче минуты анализировать нечем: фазы не выделяются, статистика не набирается. */
    private static final Duration MIN_WINDOW = Duration.ofMinutes(1);
    /** Хвост после остановки генератора: в нём видно, отпустило ли сервис. */
    private static final Duration TAIL = Duration.ofMinutes(3);
    private static final Duration DEFAULT_WINDOW = Duration.ofMinutes(30);

    private final AnalysisRunRepository repository;
    private final TestRunRepository testRunRepository;
    private final AnalysisClient client;
    private final JsonSupport json;
    private final PortalMetrics metrics;
    private final AuditService auditService;
    private final TransactionTemplate tx;
    private final ExecutorService workers = Executors.newFixedThreadPool(2, daemonFactory());

    public AnalysisService(
            AnalysisRunRepository repository,
            TestRunRepository testRunRepository,
            AnalysisClient client,
            JsonSupport json,
            PortalMetrics metrics,
            AuditService auditService,
            PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.testRunRepository = testRunRepository;
        this.client = client;
        this.json = json;
        this.metrics = metrics;
        this.auditService = auditService;
        this.tx = new TransactionTemplate(transactionManager);
    }

    @PreDestroy
    void shutdown() {
        workers.shutdownNow();
    }

    // ————————————————————————— чтение —————————————————————————

    public List<AnalysisDtos.RunDto> list(AuthContext ctx) {
        List<AnalysisRunEntity> rows = ctx.isAdmin()
                ? repository.findAllByOrderByCreatedAtDesc()
                : repository.findByUsernameOrderByCreatedAtDesc(ctx.username());
        return rows.stream().map(row -> toDto(row, false)).toList();
    }

    public AnalysisDtos.RunDto get(UUID id, AuthContext ctx) {
        return toDto(load(id, ctx), true);
    }

    public List<AnalysisDtos.RunDto> listForRun(UUID testRunId, AuthContext ctx) {
        return repository.findByTestRunIdOrderByCreatedAtDesc(testRunId).stream()
                .filter(row -> ctx.isAdmin() || row.getUsername().equals(ctx.username()))
                .map(row -> toDto(row, false))
                .toList();
    }

    public void delete(UUID id, AuthContext ctx) {
        repository.delete(load(id, ctx));
    }

    public Map<String, Object> catalog() {
        return client.catalog();
    }

    public Map<String, Object> parseLink(String url) {
        if (url == null || url.isBlank()) {
            throw new IllegalArgumentException("Вставьте ссылку на дашборд");
        }
        return client.parseLink(url);
    }

    // ————————————————————————— запуск —————————————————————————

    /** Ручной запуск из UI. Возвращает запись в статусе {@code queued}. */
    public AnalysisDtos.RunDto create(AnalysisDtos.CreateRequest req, AuthContext ctx) {
        return create(req, ctx, "manual");
    }

    private AnalysisDtos.RunDto create(AnalysisDtos.CreateRequest req, AuthContext ctx, String trigger) {
        if (req == null) {
            throw new IllegalArgumentException("Тело запроса обязательно");
        }
        return enqueue(prepare(req, ctx), ctx, trigger);
    }

    private AnalysisDtos.RunDto enqueue(Prepared prepared, AuthContext ctx, String trigger) {
        AnalysisRunEntity queued = tx.execute(status -> repository.save(new AnalysisRunEntity(
                ctx.username(),
                prepared.testRunId(),
                prepared.testId(),
                prepared.target().cluster(),
                prepared.target().namespace(),
                prepared.target().service(),
                prepared.target().container(),
                prepared.from(),
                prepared.to(),
                prepared.demo(),
                prepared.demoFault(),
                json.write(prepared.payload()))));
        if (queued == null) {
            throw new IllegalStateException("Не удалось создать запись анализа");
        }
        auditService.record(ctx.username(), AuditService.ANALYSIS_START,
                prepared.target().service() + " " + prepared.from() + "…" + prepared.to());
        submit(queued.getId(), prepared, trigger);
        return toDto(queued, false);
    }

    /**
     * Автозапуск после завершения теста. Молча пропускается, если у прогона не заполнена
     * цель: без cluster/namespace/service анализ не построит ни одного запроса, и создавать
     * запись с гарантированной ошибкой смысла нет.
     */
    public void autoAnalyze(TestRunEntity run) {
        if (run.getTargetService() == null || run.getTargetService().isBlank()) {
            log.debug("Auto-analysis skipped for run {}: target service is empty", run.getId());
            return;
        }
        AnalysisDtos.CreateRequest req = new AnalysisDtos.CreateRequest(
                run.getId().toString(), run.getTestId(), null, "", null, null, null, null, "");
        try {
            create(req, new AuthContext(run.getUsername(), UserRole.USER, false), "auto");
        } catch (RuntimeException ex) {
            log.warn("Auto-analysis for run {} not started: {}", run.getId(), ex.getMessage());
        }
    }

    /**
     * Перезапуск: тот же запрос, новая запись — старый отчёт остаётся для сравнения.
     * Запрос переигрывается целиком из сохранённого JSON, а не собирается заново по
     * колонкам: тип теста и пороги SLO в колонках не лежат, и пересчёт молча менял их
     * на дефолты — два отчёта по одному прогону расходились без видимой причины.
     */
    public AnalysisDtos.RunDto rerun(UUID id, AuthContext ctx) {
        AnalysisRunEntity previous = load(id, ctx);
        Map<String, Object> payload = new LinkedHashMap<>(json.readMap(previous.getRequestJson()));
        if (payload.isEmpty()) {
            throw new IllegalStateException("Запрос этого отчёта не сохранён — заведите анализ заново");
        }
        // В исходном запросе дефект демо мог быть не указан: тогда синтетика выбрала его
        // по хешу, и повторить выбор можно только разыгранным значением из отчёта.
        payload.put("demo_fault", previous.getDemoFault());
        Prepared prepared = new Prepared(
                previous.getTestRunId(),
                previous.getTestId(),
                new AnalysisDtos.Target(
                        previous.getTargetCluster(),
                        previous.getTargetNamespace(),
                        previous.getTargetService(),
                        previous.getTargetContainer(),
                        "auto"),
                previous.getWindowFrom(),
                previous.getWindowTo(),
                previous.isDemo(),
                previous.getDemoFault(),
                payload);
        return enqueue(prepared, ctx, "rerun");
    }

    /**
     * Автозапуск приходит изнутри транзакции вебхука, поэтому задача откладывается
     * до коммита: воркер работает в своём соединении и просто не увидел бы запись,
     * созданную в ещё не закрытой транзакции.
     */
    private void submit(UUID id, Prepared prepared, String trigger) {
        Runnable task = () -> execute(id, prepared, trigger);
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            workers.submit(task);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                workers.submit(task);
            }
        });
    }

    private void execute(UUID id, Prepared prepared, String trigger) {
        MDC.put("analysis_id", id.toString());
        long startedNanos = System.nanoTime();
        String verdict = "error";
        try {
            tx.executeWithoutResult(status -> update(id, row -> row.setStatus(AnalysisStatus.RUNNING)));
            Map<String, Object> report = client.analyze(prepared.payload());
            verdict = text(report, "verdict", "inconclusive");
            String finalVerdict = verdict;
            tx.executeWithoutResult(status -> update(id, row -> {
                row.applyReport(
                        finalVerdict,
                        number(report, "health_score"),
                        listSize(report, "findings"),
                        text(report, "headline", ""),
                        text(report, "ruleset_version", ""),
                        Boolean.TRUE.equals(report.get("demo")),
                        text(report, "demo_fault", ""),
                        json.write(report));
                row.setStatus(AnalysisStatus.SUCCEEDED);
                row.setFinishedAt(Instant.now());
            }));
            log.info("Analysis {} finished: verdict={} findings={}", id, verdict, listSize(report, "findings"));
        } catch (RuntimeException ex) {
            log.warn("Analysis {} failed: {}", id, ex.getMessage());
            tx.executeWithoutResult(status -> update(id, row -> {
                row.setStatus(AnalysisStatus.FAILED);
                row.setErrorMessage(TextSupport.truncate(reason(ex), 2000));
                row.setFinishedAt(Instant.now());
            }));
        } finally {
            metrics.recordAnalysis(trigger, verdict, System.nanoTime() - startedNanos);
            MDC.remove("analysis_id");
        }
    }

    private void update(UUID id, java.util.function.Consumer<AnalysisRunEntity> change) {
        repository.findById(id).ifPresent(row -> {
            change.accept(row);
            repository.save(row);
        });
    }

    // ————————————————————————— подготовка запроса —————————————————————————

    /**
     * Собирает окончательный запрос к сервису analysis из трёх источников:
     * прогона портала, разобранной ссылки на дашборд и ручного ввода. Приоритет
     * у ручного ввода — пользователь видит форму и правит именно её.
     */
    private Prepared prepare(AnalysisDtos.CreateRequest req, AuthContext ctx) {
        Optional<TestRunEntity> run = resolveRun(req.runId(), ctx);
        AnalysisDtos.Target fromLink = null;
        Instant linkFrom = null;
        Instant linkTo = null;
        if (req.grafanaUrl() != null && !req.grafanaUrl().isBlank()) {
            Map<String, Object> parsed = client.parseLink(req.grafanaUrl());
            Map<String, Object> target = mapOf(parsed.get("target"));
            fromLink = new AnalysisDtos.Target(
                    str(target.get("cluster")),
                    str(target.get("namespace")),
                    str(target.get("service")),
                    str(target.get("container")),
                    "auto");
            linkFrom = instant(parsed.get("window_from"));
            linkTo = instant(parsed.get("window_to"));
        }

        AnalysisDtos.Target manual = req.target();
        AnalysisDtos.Target target = new AnalysisDtos.Target(
                pick(manual == null ? null : manual.cluster(),
                        fromLink == null ? null : fromLink.cluster(),
                        run.map(TestRunEntity::getTargetCluster).orElse("")),
                pick(manual == null ? null : manual.namespace(),
                        fromLink == null ? null : fromLink.namespace(),
                        run.map(TestRunEntity::getTargetNamespace).orElse("")),
                pick(manual == null ? null : manual.service(),
                        fromLink == null ? null : fromLink.service(),
                        run.map(TestRunEntity::getTargetService).orElse("")),
                pick(manual == null ? null : manual.container(),
                        fromLink == null ? null : fromLink.container(),
                        run.map(TestRunEntity::getTargetContainer).orElse("")),
                pick(manual == null ? null : manual.runtime(), "auto"));

        boolean demo = Boolean.TRUE.equals(req.demo());
        String demoFault = req.demoFault() == null ? "" : req.demoFault();

        if (target.service().isBlank()) {
            if (!demo) {
                throw new IllegalArgumentException(
                        "Не указан сервис. Заполните cluster / namespace / service или вставьте ссылку на дашборд");
            }
            // Галочка демо обещает, что кластер и метрики не нужны, а проверка ниже
            // требовала сервис — форма отправлялась и получала отказ. Синтетика цель не
            // читает, и в запрос она идёт только чтобы отчёту было что показать в строке
            // «что анализировали».
            target = new AnalysisDtos.Target("demo", "demo", "demo-service", "", "auto");
        }

        Window window = resolveWindow(req, run, linkFrom, linkTo);
        String testId = pick(req.testId(), run.map(TestRunEntity::getTestId).orElse(""));

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("run_id", run.map(r -> r.getId().toString()).orElse(pick(req.runId(), "")));
        payload.put("test_id", testId);
        payload.put("target", target);
        payload.put("window_from", window.from());
        payload.put("window_to", window.to());
        if (req.profile() != null) {
            payload.put("profile", req.profile());
        }
        payload.put("demo", demo);
        payload.put("demo_fault", demoFault);

        return new Prepared(
                run.map(TestRunEntity::getId).orElse(null),
                testId,
                target,
                window.from(),
                window.to(),
                demo,
                demoFault,
                payload);
    }

    private Optional<TestRunEntity> resolveRun(String runId, AuthContext ctx) {
        if (runId == null || runId.isBlank()) {
            return Optional.empty();
        }
        UUID id;
        try {
            id = UUID.fromString(runId.trim());
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
        return testRunRepository.findById(id)
                .filter(run -> ctx.isAdmin() || run.getUsername().equals(ctx.username()));
    }

    /**
     * Окно анализа. У прогона портала оно известно точно — берётся из фактических времён
     * с небольшим хвостом: после остановки генератора видно, вернулся ли сервис в норму
     * или GC так и не догнал.
     */
    private Window resolveWindow(
            AnalysisDtos.CreateRequest req, Optional<TestRunEntity> run, Instant linkFrom, Instant linkTo) {
        Instant from = firstNonNull(req.windowFrom(), linkFrom,
                run.map(r -> firstNonNull(r.getStartedAt(), r.getCreatedAt())).orElse(null));
        Instant to = firstNonNull(req.windowTo(), linkTo,
                run.map(r -> firstNonNull(r.getEndedAt(), Instant.now())).map(t -> t.plus(TAIL)).orElse(null));
        if (from == null && to == null) {
            to = Instant.now();
            from = to.minus(DEFAULT_WINDOW);
        } else if (from == null) {
            from = to.minus(DEFAULT_WINDOW);
        } else if (to == null) {
            to = Instant.now();
        }
        if (!from.isBefore(to)) {
            throw new IllegalArgumentException("Начало окна должно быть раньше конца");
        }
        if (Duration.between(from, to).compareTo(MIN_WINDOW) < 0) {
            throw new IllegalArgumentException("Окно короче минуты — анализировать нечего");
        }
        return new Window(from, to);
    }

    // ————————————————————————— мелочь —————————————————————————

    private AnalysisRunEntity load(UUID id, AuthContext ctx) {
        AnalysisRunEntity row = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Анализ не найден"));
        if (!ctx.isAdmin() && !row.getUsername().equals(ctx.username())) {
            throw new IllegalArgumentException("Нет доступа к этому анализу");
        }
        return row;
    }

    private AnalysisDtos.RunDto toDto(AnalysisRunEntity row, boolean withReport) {
        return new AnalysisDtos.RunDto(
                row.getId().toString(),
                row.getTestRunId() == null ? null : row.getTestRunId().toString(),
                row.getTestId(),
                row.getUsername(),
                new AnalysisDtos.Target(
                        row.getTargetCluster(),
                        row.getTargetNamespace(),
                        row.getTargetService(),
                        row.getTargetContainer(),
                        "auto"),
                row.getWindowFrom(),
                row.getWindowTo(),
                row.getStatus().name().toLowerCase(),
                row.getVerdict(),
                row.getHealthScore(),
                row.getFindingsCount(),
                row.getHeadline(),
                row.getRulesetVersion(),
                row.isDemo(),
                row.getErrorMessage(),
                row.getCreatedAt(),
                row.getFinishedAt(),
                withReport ? json.readMap(row.getReportJson()) : null);
    }

    private static String reason(RuntimeException ex) {
        String message = ex.getMessage();
        return message == null || message.isBlank() ? ex.getClass().getSimpleName() : message;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapOf(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private static String str(Object value) {
        return value == null ? "" : value.toString();
    }

    private static String text(Map<String, Object> source, String key, String fallback) {
        Object value = source.get(key);
        return value == null || value.toString().isBlank() ? fallback : value.toString();
    }

    private static int number(Map<String, Object> source, String key) {
        Object value = source.get(key);
        return value instanceof Number n ? n.intValue() : 0;
    }

    private static int listSize(Map<String, Object> source, String key) {
        Object value = source.get(key);
        return value instanceof List<?> list ? list.size() : 0;
    }

    private static Instant instant(Object value) {
        if (value == null || value.toString().isBlank()) {
            return null;
        }
        try {
            return Instant.parse(value.toString());
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private static String pick(String... candidates) {
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate.trim();
            }
        }
        return "";
    }

    @SafeVarargs
    private static <T> T firstNonNull(T... candidates) {
        for (T candidate : candidates) {
            if (candidate != null) {
                return candidate;
            }
        }
        return null;
    }

    private static ThreadFactory daemonFactory() {
        AtomicInteger seq = new AtomicInteger();
        return runnable -> {
            Thread thread = new Thread(runnable, "analysis-" + seq.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }

    private record Window(Instant from, Instant to) {
    }

    private record Prepared(
            UUID testRunId,
            String testId,
            AnalysisDtos.Target target,
            Instant from,
            Instant to,
            boolean demo,
            String demoFault,
            Map<String, Object> payload) {
    }
}
