package com.loadtest.orchestrator.web.dto;

import java.time.Instant;
import java.util.Map;

/**
 * Контракт модуля «Анализ» на границе портала.
 *
 * <p>Отчёт наружу проходит как {@code Map}: его структуру задаёт каталог правил
 * сервиса analysis, и дублировать её десятком record-ов в Java значит ломать
 * сборку при каждом новом поле в находке. Java-слой отвечает за доступ, хранение
 * и сводку, а не за форму отчёта.
 */
public final class AnalysisDtos {

    private AnalysisDtos() {
    }

    /**
     * @param runtime jvm, go или auto — определяет, какие метрики вообще спрашивать
     */
    public record Target(
            String cluster,
            String namespace,
            String service,
            String container,
            String runtime
    ) {
    }

    /** Профиль нагрузки: задаёт ожидания по фазам и пороги SLO. */
    public record Profile(
            String testKind,
            Double targetRps,
            Integer rampUpSec,
            Integer holdSec,
            Integer steps,
            Integer stepDurationSec,
            Double sloP90Ms,
            Double sloP99Ms,
            Double sloErrorRatePct
    ) {
    }

    /**
     * @param runId      прогон из модуля «Запуск»; тогда цель и окно берутся из него
     * @param grafanaUrl ссылка на дашборд как альтернатива ручному вводу
     */
    public record CreateRequest(
            String runId,
            String testId,
            Target target,
            String grafanaUrl,
            Instant windowFrom,
            Instant windowTo,
            Profile profile,
            Boolean demo,
            String demoFault
    ) {
    }

    public record ParseLinkRequest(String url) {
    }

    /** Элемент списка и карточка одновременно: {@code report} заполнен только при чтении одной записи. */
    public record RunDto(
            String id,
            String testRunId,
            String testId,
            String username,
            Target target,
            Instant windowFrom,
            Instant windowTo,
            String status,
            String verdict,
            int healthScore,
            int findingsCount,
            String headline,
            String rulesetVersion,
            boolean demo,
            String errorMessage,
            Instant createdAt,
            Instant finishedAt,
            Map<String, Object> report
    ) {
    }
}
