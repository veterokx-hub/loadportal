package com.loadtest.orchestrator.service;

import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import com.loadtest.orchestrator.persistence.PortalSettingsEntity;
import com.loadtest.orchestrator.persistence.TestRunEntity;
import com.loadtest.orchestrator.web.dto.RunVerdictDto;
import com.loadtest.orchestrator.web.dto.TestRunDto;
import com.loadtest.orchestrator.web.dto.TestRunEventDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.StreamSupport;

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
                run.getTargetCluster(),
                run.getTargetNamespace(),
                run.getTargetService(),
                run.getTargetContainer(),
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
                json.readList(run.getEventsJson(), EVENTS_TYPE),
                verdictOf(run));
    }

    private RunVerdictDto verdictOf(TestRunEntity run) {
        String status = run.getVerdictStatus();
        if (status == null || status.isBlank()) {
            return null;
        }
        JsonNode root = null;
        try {
            String raw = run.getVerdictJson();
            if (raw != null && !raw.isBlank()) {
                root = json.mapper().readTree(raw);
            }
        } catch (JacksonException ex) {
            log.warn("Cannot parse verdict of run {}: {}", run.getId(), ex.getMessage());
        }
        JsonNode metrics = root == null ? null : root.path("metrics");
        List<String> reasons = List.of();
        if (root != null && root.path("reasons").isArray()) {
            reasons = StreamSupport.stream(root.path("reasons").spliterator(), false)
                    .map(JsonNode::asText)
                    .filter(text -> !text.isBlank())
                    .limit(20)
                    .toList();
        }
        return new RunVerdictDto(
                status,
                longOrNull(metrics, "samples"),
                doubleOrNull(metrics, "p95_ms"),
                doubleOrNull(metrics, "p99_ms"),
                doubleOrNull(metrics, "error_rate_pct"),
                doubleOrNull(metrics, "rps"),
                reasons);
    }

    private static Long longOrNull(JsonNode node, String field) {
        if (node == null || !node.path(field).isNumber()) {
            return null;
        }
        return node.path(field).asLong();
    }

    private static Double doubleOrNull(JsonNode node, String field) {
        if (node == null || !node.path(field).isNumber()) {
            return null;
        }
        return node.path(field).asDouble();
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
        } catch (JacksonException ex) {
            log.warn("Cannot append run event '{}': {}", event, ex.getMessage());
            if (previous != null) {
                run.setEventsJson(previous);
            }
        }
    }
}
