package com.loadtest.orchestrator.service.run;

import com.loadtest.orchestrator.persistence.ScriptEntity;

import java.util.UUID;

/** Разрешённый источник скрипта для запуска прогона. */
public record ScriptSource(
        UUID buildId,
        UUID scriptId,
        ScriptEntity script,
        String engine,
        String scenarioName,
        String targetUrl) {
}
