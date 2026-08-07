package com.loadtest.orchestrator.service.run;

/** Параметры CI-запуска (path, ресурсы, окно времени). */
public record LaunchParams(
        String testId,
        String scenarioPath,
        String podName,
        String repository,
        String cpu,
        String memory,
        String startTime,
        String endTime) {
}
