package com.loadtest.orchestrator.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.loadtest.orchestrator.persistence.PortalSettingsEntity;
import com.loadtest.orchestrator.persistence.TestRunEntity;
import com.loadtest.orchestrator.web.dto.TestRunDto;
import com.loadtest.orchestrator.web.dto.TestRunEventDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Маппинг entity ↔ DTO и побочные представления (Grafana URL, журнал событий). */
@Component
public class TestRunMapper {

    private static final Logger log = LoggerFactory.getLogger(TestRunMapper.class);
    private static final TypeReference<List<TestRunEventDto>> EVENTS_TYPE = new TypeReference<>() {};

    private final JsonSupport json;

    public TestRunMapper(JsonSupport json) {
        this.json = json;
    }

    public TestRunDto toDto(TestRunEntity run) {
        return new TestRunDto(
                run.getId().toString(),
                run.getTestId(),
                run.getUsername(),
                run.getScenarioName(),
                run.getEngine(),
                run.getBuildId() != null ? run.getBuildId().toString() : null,
                run.getScriptId() != null ? run.getScriptId().toString() : null,
                run.getTargetUrl(),
                json.readMap(run.getParamsJson()),
                json.readStringMap(run.getLabelsJson()),
                run.getStatus().name().toLowerCase(),
                run.getGitlabPipelineId(),
                run.getGitlabWebUrl(),
                run.getGrafanaUrl(),
                run.getStartedAt(),
                run.getEndedAt(),
                run.getErrorMessage(),
                run.getCreatedAt(),
                json.readList(run.getEventsJson(), EVENTS_TYPE));
    }

    public String buildGrafanaUrl(PortalSettingsEntity settings, TestRunEntity run) {
        String base = TextSupport.nullToEmpty(settings.getGrafanaBaseUrl());
        String template = TextSupport.nullToEmpty(settings.getGrafanaDashboardTemplate());
        if (base.isBlank() || template.isBlank()) {
            return "";
        }
        String url = template
                .replace("{run_id}", run.getId().toString())
                .replace("{engine}", run.getEngine());
        if (!url.startsWith("http")) {
            url = base.replaceAll("/$", "") + url;
        }
        if (run.getStartedAt() != null) {
            url = url.replace("{from}", String.valueOf(run.getStartedAt().toEpochMilli()));
        }
        if (run.getEndedAt() != null) {
            url = url.replace("{to}", String.valueOf(run.getEndedAt().toEpochMilli()));
        }
        return url;
    }

    /**
     * Добавляет событие в JSON-журнал прогона.
     * При ошибке сериализации сохраняет прежнее значение.
     */
    public void appendEvent(TestRunEntity run, String event, String detail) {
        String previous = run.getEventsJson();
        try {
            List<TestRunEventDto> events = new ArrayList<>(json.readList(
                    previous == null || previous.isBlank() ? "[]" : previous,
                    EVENTS_TYPE));
            events.add(new TestRunEventDto(Instant.now(), event, detail));
            run.setEventsJson(json.mapper().writeValueAsString(events));
        } catch (JsonProcessingException ex) {
            log.warn("Cannot append run event '{}': {}", event, ex.getMessage());
            if (previous != null) {
                run.setEventsJson(previous);
            }
        }
    }
}
