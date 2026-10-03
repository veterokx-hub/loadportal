package com.loadtest.orchestrator.client;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Клиент GitLab API: проверка проекта и trigger pipeline. Скрипты в GitLab не пишутся. */
@Component
public class GitLabClient {

    public static final String DEFAULT_REF = "master";

    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    public GitLabClient(ObjectMapper objectMapper, @Qualifier("sharedRestClient") RestClient restClient) {
        this.objectMapper = objectMapper;
        this.restClient = restClient;
    }

    /** GET /projects/:id — проверка доступа и существования проекта. */
    public ProjectInfo getProject(String baseUrl, String token, String projectIdOrPath) {
        String url = projectApiBase(baseUrl, projectIdOrPath);
        return execute("проект GitLab", () -> {
            JsonNode node = readJson(restClient.get()
                    .uri(url)
                    .header("PRIVATE-TOKEN", token)
                    .retrieve()
                    .body(String.class));
            return new ProjectInfo(
                    node.path("id").asLong(),
                    node.path("path_with_namespace").asText(projectIdOrPath),
                    node.path("web_url").asText(""));
        });
    }

    /** GET /api/v4/version — жив ли GitLab, без токена. */
    public String version(String baseUrl) {
        String url = normalizeBase(baseUrl) + "/api/v4/version";
        return execute("версию GitLab", () -> readJson(restClient.get()
                .uri(url)
                .retrieve()
                .body(String.class)).path("version").asText(""));
    }

    /** POST /pipelines/:id/cancel. Нужен personal/project access token, trigger token сюда не подходит. */
    public void cancelPipeline(String baseUrl, String projectIdOrPath, String apiToken, long pipelineId) {
        String url = projectApiBase(baseUrl, projectIdOrPath) + "/pipelines/" + pipelineId + "/cancel";
        execute("отмену pipeline", () -> {
            restClient.post()
                    .uri(url)
                    .header("PRIVATE-TOKEN", apiToken)
                    .retrieve()
                    .toBodilessEntity();
            return null;
        });
    }

    /** Trigger Pipeline API (form-urlencoded). */
    public TriggerResult triggerPipeline(
            String baseUrl,
            String projectIdOrPath,
            String triggerToken,
            String ref,
            Map<String, String> variables) {
        String url = projectApiBase(baseUrl, projectIdOrPath) + "/trigger/pipeline";
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("token", triggerToken);
        form.add("ref", (ref == null || ref.isBlank()) ? DEFAULT_REF : ref.trim());
        if (variables != null) {
            variables.entrySet().stream()
                    .filter(e -> e.getKey() != null && !e.getKey().isBlank())
                    .forEach(e -> form.add(
                            "variables[" + e.getKey() + "]",
                            e.getValue() == null ? "" : e.getValue()));
        }
        return execute("trigger pipeline", () -> {
            JsonNode node = readJson(restClient.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(String.class));
            return new TriggerResult(
                    node.path("id").asLong(),
                    node.path("web_url").asText(""),
                    node.path("status").asText("pending"));
        });
    }

    private JsonNode readJson(String body) throws Exception {
        return objectMapper.readTree(body == null ? "{}" : body);
    }

    private <T> T execute(String action, SupplierWithException<T> call) {
        try {
            return call.get();
        } catch (GitLabException ex) {
            throw ex;
        } catch (HttpStatusCodeException ex) {
            throw mapHttpError(ex, action);
        } catch (IllegalArgumentException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new GitLabException(
                    HttpStatus.BAD_GATEWAY,
                    "GitLab недоступен при " + action + ": " + ex.getMessage());
        }
    }

    private static String projectApiBase(String baseUrl, String projectIdOrPath) {
        return normalizeBase(baseUrl) + "/api/v4/projects/" + encodeProjectId(projectIdOrPath);
    }

    private static String encodeProjectId(String projectIdOrPath) {
        if (projectIdOrPath == null || projectIdOrPath.isBlank()) {
            throw new IllegalArgumentException("GitLab project ID не задан");
        }
        if (projectIdOrPath.matches("\\d+")) {
            return projectIdOrPath;
        }
        return URLEncoder.encode(projectIdOrPath, StandardCharsets.UTF_8);
    }

    private static String normalizeBase(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalArgumentException("GitLab base URL не задан");
        }
        return baseUrl.replaceAll("/$", "");
    }

    private static GitLabException mapHttpError(HttpStatusCodeException ex, String action) {
        int code = ex.getStatusCode().value();
        String detail = ex.getResponseBodyAsString();
        if (detail != null && detail.length() > 200) {
            detail = detail.substring(0, 200) + "…";
        }
        String suffix = (detail == null || detail.isBlank()) ? "" : (": " + detail);
        HttpStatus status = switch (code) {
            case 401, 403 -> HttpStatus.BAD_GATEWAY;
            case 404 -> HttpStatus.BAD_GATEWAY;
            default -> code >= 500 ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_GATEWAY;
        };
        String message = switch (code) {
            case 401 -> "GitLab: неверный token (401)" + suffix;
            case 403 -> "GitLab: доступ запрещён (403) при " + action + suffix;
            case 404 -> "GitLab: не найдено (404) при " + action + suffix;
            default -> "GitLab HTTP " + code + " при " + action + suffix;
        };
        return new GitLabException(status, message);
    }

    @FunctionalInterface
    private interface SupplierWithException<T> {
        T get() throws Exception;
    }

    public record ProjectInfo(long id, String pathWithNamespace, String webUrl) {
    }

    public record TriggerResult(long pipelineId, String webUrl, String status) {
    }
}
