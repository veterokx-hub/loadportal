package com.loadtest.orchestrator.metrics;

import com.loadtest.orchestrator.model.TestRunStatus;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

/**
 * Доменные метрики портала — то, что нельзя увидеть в стандартных JVM/HTTP-метриках.
 *
 * <p>Отвечают на эксплуатационные вопросы: сколько сборок и каким движком делают,
 * не растёт ли доля неудачных генераций, сколько прогонов заводят, доходят ли до них
 * статусы из GitLab, не подбирают ли пароль к порталу.
 *
 * <p>Все метрики регистрируются лениво при первом вызове: Micrometer сам дедуплицирует
 * счётчики по имени и набору тегов, поэтому кэшировать их здесь не нужно.
 *
 * <p>Теги намеренно низкой кардинальности (движок, статус, результат) — в них не попадают
 * имена пользователей, сценариев и идентификаторы, иначе временные ряды в VictoriaMetrics
 * начнут неограниченно расти.
 */
@Component
public class PortalMetrics {

    private static final String RESULT_SUCCESS = "success";
    private static final String RESULT_FAILURE = "failure";

    private final MeterRegistry registry;

    public PortalMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    /**
     * Генерация артефакта (.jmx / .js) через соседний модуль.
     *
     * @param engine    jmeter или k6
     * @param success   удалось ли получить артефакт
     * @param durationNanos длительность вызова генератора
     * @param sizeBytes размер артефакта; 0, если генерация не удалась
     */
    public void recordBuild(String engine, boolean success, long durationNanos, int sizeBytes) {
        Timer.builder("portal.build.duration")
                .description("Длительность генерации артефакта соседним модулем")
                .tag("engine", engine)
                .tag("result", success ? RESULT_SUCCESS : RESULT_FAILURE)
                .register(registry)
                .record(durationNanos, TimeUnit.NANOSECONDS);

        if (success && sizeBytes > 0) {
            DistributionSummary.builder("portal.artifact.size")
                    .description("Размер сгенерированного артефакта")
                    .baseUnit("bytes")
                    .tag("engine", engine)
                    .register(registry)
                    .record(sizeBytes);
        }
    }

    /**
     * Скрипт сохранён в БД и получил script_id.
     *
     * @param source portal_build (собран порталом) или upload (загружен вручную)
     */
    public void recordScriptSaved(String engine, String source, int sizeBytes) {
        registry.counter("portal.scripts.saved", "engine", engine, "source", source).increment();
        if (sizeBytes > 0) {
            DistributionSummary.builder("portal.script.size")
                    .description("Размер сохранённого скрипта")
                    .baseUnit("bytes")
                    .tag("engine", engine)
                    .tag("source", source)
                    .register(registry)
                    .record(sizeBytes);
        }
    }

    /** Создан прогон (пока в статусе queued — вызов GitLab появится позже). */
    public void recordRunCreated(String engine) {
        registry.counter("portal.runs.created", "engine", engine).increment();
    }

    /**
     * Смена статуса прогона. Рост failed при отсутствии роста succeeded — первый признак
     * проблем со стендом или скриптом.
     */
    public void recordRunStatus(TestRunStatus status) {
        registry.counter("portal.runs.status", "status", status.name().toLowerCase()).increment();
    }

    /**
     * Прогон анализа целиком, включая ожидание сервиса analysis.
     *
     * @param trigger manual — кнопка в UI; auto — автозапуск после завершения теста
     * @param verdict вердикт отчёта или {@code error}, если анализ не дошёл до конца
     */
    public void recordAnalysis(String trigger, String verdict, long durationNanos) {
        Timer.builder("portal.analysis.duration")
                .description("Длительность анализа прогона")
                .tag("trigger", trigger)
                .tag("verdict", verdict)
                .register(registry)
                .record(durationNanos, TimeUnit.NANOSECONDS);
    }

    /**
     * Попытка входа. Всплеск failure — либо сломалась интеграция с LDAP, либо перебор паролей.
     *
     * @param method local или ldap
     */
    public void recordLogin(String method, boolean success) {
        registry.counter("portal.auth.logins",
                "method", method,
                "result", success ? RESULT_SUCCESS : RESULT_FAILURE).increment();
    }

    /**
     * Входящий вебхук от GitLab.
     *
     * @param result accepted — статус применён; unknown_pipeline — прогон не найден;
     *               rejected — не прошла проверка секрета
     */
    public void recordGitLabWebhook(String result) {
        registry.counter("portal.gitlab.webhooks", "result", result).increment();
    }
}
