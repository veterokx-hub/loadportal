package com.loadtest.orchestrator.service;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.loadtest.orchestrator.persistence.BuildRecordEntity;
import com.loadtest.orchestrator.persistence.BuildRecordRepository;
import com.loadtest.orchestrator.persistence.ScriptEntity;
import com.loadtest.orchestrator.service.run.ScriptSource;
import com.loadtest.orchestrator.web.dto.CreateTestRunRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/**
 * Резолв сборки/скрипта и метаданных сценария для запуска.
 * Отделяет доступ к данным от оркестрации прогона.
 */
@Component
public class ScriptSourceResolver {

    private static final Logger log = LoggerFactory.getLogger(ScriptSourceResolver.class);

    private final BuildRecordRepository buildRecordRepository;
    private final ScriptService scriptService;
    private final ObjectMapper objectMapper;

    public ScriptSourceResolver(
            BuildRecordRepository buildRecordRepository,
            ScriptService scriptService,
            ObjectMapper objectMapper) {
        this.buildRecordRepository = buildRecordRepository;
        this.scriptService = scriptService;
        this.objectMapper = objectMapper;
    }

    public ScriptSource resolve(CreateTestRunRequest req, String username) {
        UUID buildId = parseUuid(req.buildId(), "build_id");
        UUID scriptId = parseUuid(req.scriptId(), "script_id");
        Optional<BuildRecordEntity> build = loadOwnedBuild(buildId, username);

        if (scriptId == null && buildId != null) {
            scriptId = scriptService.findLatestForBuild(buildId)
                    .map(ScriptEntity::getId)
                    .orElse(null);
        }
        if (scriptId == null) {
            throw new IllegalArgumentException(
                    "Нет сохранённого скрипта для запуска — сохраните сборку или загрузите файл");
        }

        ScriptEntity script = scriptService.requireContent(scriptId, username);
        return new ScriptSource(
                buildId,
                scriptId,
                script,
                resolveEngine(req.engine(), script, build),
                resolveScenarioName(req.scenarioName(), script, build),
                resolveTargetUrl(req.targetUrl(), build));
    }

    private Optional<BuildRecordEntity> loadOwnedBuild(UUID buildId, String username) {
        if (buildId == null) {
            return Optional.empty();
        }
        BuildRecordEntity build = buildRecordRepository.findById(buildId)
                .orElseThrow(() -> new IllegalArgumentException("Сборка не найдена"));
        if (!build.getUsername().equals(username)) {
            throw new IllegalArgumentException("Сборка принадлежит другому пользователю");
        }
        return Optional.of(build);
    }

    private static String resolveEngine(String requested, ScriptEntity script, Optional<BuildRecordEntity> build) {
        if (requested != null && !requested.isBlank()) {
            return requested.trim().toLowerCase();
        }
        if (script.getEngine() != null && !script.getEngine().isBlank()) {
            return script.getEngine();
        }
        return build.map(BuildRecordEntity::getEngine)
                .filter(e -> e != null && !e.isBlank())
                .orElseThrow(() -> new IllegalArgumentException(
                        "Укажите движок (jmeter/k6/gatling) или сборку/скрипт"));
    }

    private static String resolveScenarioName(
            String requested,
            ScriptEntity script,
            Optional<BuildRecordEntity> build) {
        if (requested != null && !requested.isBlank()) {
            return requested.trim();
        }
        return build.map(BuildRecordEntity::getScenarioName)
                .filter(n -> n != null && !n.isBlank())
                .orElseGet(() -> TextSupport.firstNonBlank(script.getFilename(), "Сценарий"));
    }

    private String resolveTargetUrl(String requested, Optional<BuildRecordEntity> build) {
        if (requested != null && !requested.isBlank()) {
            return requested.trim();
        }
        return build.map(BuildRecordEntity::getScenarioJson)
                .flatMap(this::readBaseUrl)
                .orElse("");
    }

    private Optional<String> readBaseUrl(String scenarioJson) {
        try {
            JsonNode scenario = objectMapper.readTree(
                    scenarioJson == null || scenarioJson.isBlank() ? "{}" : scenarioJson);
            String base = scenario.path("base_url").asText("");
            return base.isBlank() ? Optional.empty() : Optional.of(base);
        } catch (JacksonException ex) {
            log.warn("Cannot parse scenario JSON for base_url: {}", ex.getMessage());
            return Optional.empty();
        }
    }

    private static UUID parseUuid(String value, String field) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Некорректный " + field);
        }
    }
}
