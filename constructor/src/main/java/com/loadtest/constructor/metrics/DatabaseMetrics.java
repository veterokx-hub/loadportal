package com.loadtest.constructor.metrics;

import com.loadtest.constructor.model.TestRunStatus;
import com.loadtest.constructor.persistence.BuildRecordRepository;
import com.loadtest.constructor.persistence.ScriptRepository;
import com.loadtest.constructor.persistence.TestRunRepository;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.function.ToDoubleFunction;

/**
 * Gauge-метрики по содержимому БД: текущие размеры таблиц и число незавершённых прогонов.
 *
 * <p>Счётчики из {@link PortalMetrics} показывают поток событий, а эти метрики — состояние.
 * Вместе они позволяют, например, увидеть, что прогоны создаются, но навсегда остаются
 * в queued (не приходят вебхуки от GitLab).
 *
 * <p>Значения читаются в момент scrape, поэтому каждая метрика — это дешёвый
 * {@code select count(*)} по индексу. При недоступной БД возвращается -1: так на графике
 * видно, что данных нет, и это не путается с настоящим нулём.
 */
@Component
public class DatabaseMetrics {

    private static final Logger log = LoggerFactory.getLogger(DatabaseMetrics.class);

    /** Значение-маркер: БД недоступна, реальное количество неизвестно. */
    private static final double UNAVAILABLE = -1d;

    /** Прогон считается незавершённым, пока не пришёл терминальный статус. */
    private static final List<TestRunStatus> ACTIVE_STATUSES =
            List.of(TestRunStatus.QUEUED, TestRunStatus.RUNNING);

    public DatabaseMetrics(
            MeterRegistry registry,
            BuildRecordRepository buildRecordRepository,
            ScriptRepository scriptRepository,
            TestRunRepository testRunRepository) {

        register(registry, "portal.builds.stored", "Сборок в истории",
                r -> safeCount(buildRecordRepository::count, "build_records"));

        register(registry, "portal.scripts.stored", "Сохранённых скриптов",
                r -> safeCount(scriptRepository::count, "scripts"));

        register(registry, "portal.runs.stored", "Всего прогонов",
                r -> safeCount(testRunRepository::count, "test_runs"));

        register(registry, "portal.runs.active", "Прогонов в статусе queued или running",
                r -> safeCount(() -> testRunRepository.countByStatusIn(ACTIVE_STATUSES), "test_runs.active"));
    }

    /**
     * Gauge регистрируется на самом объекте метрик: держать сильную ссылку обязательно,
     * иначе Micrometer потеряет слабую ссылку на источник значения и метрика станет NaN.
     */
    private void register(MeterRegistry registry, String name, String description,
                          ToDoubleFunction<DatabaseMetrics> valueFn) {
        Gauge.builder(name, this, valueFn)
                .description(description)
                .register(registry);
    }

    private static double safeCount(CountSupplier supplier, String what) {
        try {
            return supplier.count();
        } catch (Exception e) {
            log.warn("Не удалось посчитать {} для метрики: {}", what, e.getMessage());
            return UNAVAILABLE;
        }
    }

    /** Отдельный интерфейс, чтобы завернуть проверяемые исключения репозитория. */
    @FunctionalInterface
    private interface CountSupplier {
        long count();
    }
}
