package com.loadtest.orchestrator.web;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.loadtest.orchestrator.metrics.PortalMetrics;
import com.loadtest.orchestrator.service.TestRunWebhookService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.StreamSupport;

/** Входящие статусы pipeline из GitLab. Auth — только {@code X-Gitlab-Token}. */
@RestController
@RequestMapping("/api/runs/webhook")
public class GitLabWebhookController {

    private static final Logger log = LoggerFactory.getLogger(GitLabWebhookController.class);
    private static final Set<String> RUN_ID_KEYS = Set.of("PORTAL_RUN_ID", "LOADTEST_RUN_ID");

    private final TestRunWebhookService webhookService;
    private final ObjectMapper objectMapper;
    private final PortalMetrics metrics;

    public GitLabWebhookController(
            TestRunWebhookService webhookService,
            ObjectMapper objectMapper,
            PortalMetrics metrics) {
        this.webhookService = webhookService;
        this.objectMapper = objectMapper;
        this.metrics = metrics;
    }

    @PostMapping("/gitlab")
    public ResponseEntity<Map<String, String>> handleGitLabWebhook(
            @RequestBody String rawBody,
            @RequestHeader(value = "X-Gitlab-Token", required = false) String token) {
        if (!webhookService.verifySecret(token == null ? "" : token)) {
            log.warn("GitLab webhook rejected: invalid token");
            metrics.recordGitLabWebhook("rejected");
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "invalid token"));
        }

        try {
            JsonNode root = objectMapper.readTree(rawBody);
            if (!"pipeline".equals(root.path("object_kind").asText(""))) {
                return ResponseEntity.ok(Map.of("status", "ignored"));
            }

            JsonNode attrs = root.path("object_attributes");
            long rawPipelineId = attrs.path("id").asLong(0);
            Long pipelineId = rawPipelineId == 0 ? null : rawPipelineId;
            String status = attrs.path("status").asText("");
            String webUrl = attrs.path("url").asText("");
            UUID runId = extractRunId(attrs.path("variables")).orElse(null);

            webhookService.applyPipelineEvent(pipelineId, status, webUrl, runId);
            return ResponseEntity.ok(Map.of("status", "ok"));
        } catch (JsonProcessingException ex) {
            log.warn("GitLab webhook parse error: {}", ex.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", "invalid payload"));
        }
    }

    private static Optional<UUID> extractRunId(JsonNode variables) {
        if (!variables.isArray()) {
            return Optional.empty();
        }
        return StreamSupport.stream(variables.spliterator(), false)
                .filter(v -> RUN_ID_KEYS.contains(v.path("key").asText()))
                .map(v -> v.path("value").asText(""))
                .flatMap(value -> parseUuid(value).stream())
                .findFirst();
    }

    private static Optional<UUID> parseUuid(String value) {
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(UUID.fromString(value));
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }
}
