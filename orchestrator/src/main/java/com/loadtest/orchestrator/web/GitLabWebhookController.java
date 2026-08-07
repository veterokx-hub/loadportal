package com.loadtest.orchestrator.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.loadtest.orchestrator.metrics.PortalMetrics;
import com.loadtest.orchestrator.service.TestRunService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/** Входящие статусы pipeline из GitLab. Bearer-auth не применяется — только X-Gitlab-Token. */
@RestController
@RequestMapping("/api/runs/webhook")
public class GitLabWebhookController {

    private static final Logger log = LoggerFactory.getLogger(GitLabWebhookController.class);

    private final TestRunService testRunService;
    private final ObjectMapper objectMapper;
    private final PortalMetrics metrics;

    public GitLabWebhookController(
            TestRunService testRunService,
            ObjectMapper objectMapper,
            PortalMetrics metrics) {
        this.testRunService = testRunService;
        this.objectMapper = objectMapper;
        this.metrics = metrics;
    }

    @PostMapping("/gitlab")
    public ResponseEntity<Map<String, String>> handleGitLabWebhook(
            @RequestBody String rawBody,
            @RequestHeader(value = "X-Gitlab-Token", required = false) String token,
            HttpServletRequest request) {
        if (!testRunService.verifyWebhookSecret(token == null ? "" : token)) {
            log.warn("GitLab webhook rejected: invalid token");
            metrics.recordGitLabWebhook("rejected");
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "invalid token"));
        }
        try {
            JsonNode root = objectMapper.readTree(rawBody);
            String kind = root.path("object_kind").asText("");
            if (!"pipeline".equals(kind)) {
                return ResponseEntity.ok(Map.of("status", "ignored"));
            }
            JsonNode attrs = root.path("object_attributes");
            Long pipelineId = attrs.path("id").asLong(0);
            if (pipelineId == 0) {
                pipelineId = null;
            }
            String status = attrs.path("status").asText("");
            String webUrl = attrs.path("url").asText("");
            UUID runId = extractRunId(root);
            testRunService.applyGitLabWebhook(pipelineId, status, webUrl, runId);
            return ResponseEntity.ok(Map.of("status", "ok"));
        } catch (Exception ex) {
            log.warn("GitLab webhook parse error: {}", ex.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", "invalid payload"));
        }
    }

    private static UUID extractRunId(JsonNode root) {
        JsonNode variables = root.path("object_attributes").path("variables");
        if (variables.isArray()) {
            for (JsonNode v : variables) {
                String key = v.path("key").asText();
                if ("PORTAL_RUN_ID".equals(key) || "LOADTEST_RUN_ID".equals(key)) {
                    try {
                        return UUID.fromString(v.path("value").asText());
                    } catch (IllegalArgumentException ignored) {
                        return null;
                    }
                }
            }
        }
        return null;
    }
}
