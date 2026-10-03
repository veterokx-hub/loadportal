package com.loadtest.orchestrator.web.dto;

import java.util.Map;

/**
 * @param targetCluster   кластер тестируемого сервиса — нужен модулю «Анализ»
 * @param targetNamespace namespace тестируемого сервиса
 * @param targetService   имя сервиса (префикс подов) для метрик
 * @param targetContainer контейнер приложения внутри пода; пусто — берётся имя сервиса
 */
public record CreateTestRunRequest(
        String testId,
        String buildId,
        String scriptId,
        String scenarioName,
        String engine,
        String targetUrl,
        String startTime,
        String endTime,
        String cpu,
        String memory,
        String scenarioPath,
        String podName,
        String repository,
        String targetCluster,
        String targetNamespace,
        String targetService,
        String targetContainer,
        Map<String, Object> params,
        Map<String, String> labels
) {
}
