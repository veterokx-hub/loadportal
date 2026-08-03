package com.loadtest.jmeterbuilder.metrics;

import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

/**
 * Метрики сборки .jmx.
 *
 * <p>Сервис stateless, поэтому эксплуатационно важны три вещи: не растёт ли доля неуспешных
 * сборок, не деградирует ли время генерации и не приходят ли аномально большие сценарии
 * (по ним потом растёт потребление памяти у самого JMeter на прогоне).
 *
 * <p>Теги низкой кардинальности: результат и формат артефакта. Имена сценариев в метрики
 * не попадают — иначе число временных рядов будет расти с каждым новым сценарием.
 */
@Component
public class BuilderMetrics {

    private final MeterRegistry registry;

    public BuilderMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    /**
     * Итог одной сборки.
     *
     * @param format        jmx (одиночный файл) или zip (файл + CSV-датасеты)
     * @param success       завершилась ли сборка без исключения
     * @param durationNanos длительность сборки
     * @param sizeBytes     размер артефакта; 0 при неуспехе
     * @param requestCount  число запросов во входном сценарии
     */
    public void recordBuild(String format, boolean success, long durationNanos, int sizeBytes, int requestCount) {
        Timer.builder("jmx.build.duration")
                .description("Длительность сборки JMeter-артефакта")
                .tag("format", format)
                .tag("result", success ? "success" : "failure")
                .register(registry)
                .record(durationNanos, TimeUnit.NANOSECONDS);

        if (!success) {
            return;
        }
        DistributionSummary.builder("jmx.artifact.size")
                .description("Размер собранного артефакта")
                .baseUnit("bytes")
                .tag("format", format)
                .register(registry)
                .record(sizeBytes);

        DistributionSummary.builder("jmx.scenario.requests")
                .description("Число запросов во входном сценарии")
                .register(registry)
                .record(requestCount);
    }
}
