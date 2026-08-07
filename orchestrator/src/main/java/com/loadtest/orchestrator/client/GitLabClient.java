package com.loadtest.orchestrator.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/** Клиент GitLab API: проект, заливка файла, trigger pipeline. */
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

    /** Создаёт или обновляет файл в ветке {@link #DEFAULT_REF}. */
    public void upsertFile(
            String baseUrl,
            String privateToken,
            String projectIdOrPath,
            String filePath,
            byte[] content,
            String commitMessage) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("Пустое содержимое скрипта");
        }
        String fileUrl = projectApiBase(baseUrl, projectIdOrPath)
                + "/repository/files/"
                + urlEncodePath(filePath);
        boolean exists = fileExists(fileUrl, privateToken);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("branch", DEFAULT_REF);
        payload.put("content", Base64.getEncoder().encodeToString(content));
        payload.put("encoding", "base64");
        payload.put("commit_message",
                (commitMessage == null || commitMessage.isBlank())
                        ? "portal: upload " + filePath
                        : commitMessage);

        String action = exists ? "обновлении файла" : "создании файла";
        execute(action, () -> {
            var spec = exists
                    ? restClient.put().uri(fileUrl)
                    : restClient.post().uri(fileUrl);
            spec.header("PRIVATE-TOKEN", privateToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload)
                    .retrieve()
                    .toBodilessEntity();
            return null;
        });
    }

    /** Trigger Pipeline API (form-urlencoded), ref = {@link #DEFAULT_REF}. */
    public TriggerResult triggerPipeline(
            String baseUrl,
            String projectIdOrPath,
            String triggerToken,
            Map<String, String> variables) {
        String url = projectApiBase(baseUrl, projectIdOrPath) + "/trigger/pipeline";
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("token", triggerToken);
        form.add("ref", DEFAULT_REF);
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

    private boolean fileExists(String fileUrl, String privateToken) {
        String url = fileUrl + "?ref=" + URLEncoder.encode(DEFAULT_REF, StandardCharsets.UTF_8);
        try {
            restClient.get()
                    .uri(url)
                    .header("PRIVATE-TOKEN", privateToken)
                    .retrieve()
                    .toBodilessEntity();
            return true;
        } catch (HttpStatusCodeException ex) {
            if (ex.getStatusCode().value() == 404) {
                return false;
            }
            throw mapHttpError(ex, "проверке файла");
        }
    }

    private JsonNode readJson(String body) throws Exception {
        return objectMapper.readTree(body == null ? "{}" : body);
    }

    private <T> T execute(String action, SupplierWithException<T> call) {
        try {
            return call.get();
        } catch (HttpStatusCodeException ex) {
            throw mapHttpError(ex, action);
        } catch (IllegalArgumentException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalArgumentException("GitLab недоступен при " + action + ": " + ex.getMessage());
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

    private static String urlEncodePath(String filePath) {
        return URLEncoder.encode(filePath, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static String normalizeBase(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalArgumentException("GitLab base URL не задан");
        }
        return baseUrl.replaceAll("/$", "");
    }

    private static IllegalArgumentException mapHttpError(HttpStatusCodeException ex, String action) {
        int code = ex.getStatusCode().value();
        String detail = ex.getResponseBodyAsString();
        if (detail != null && detail.length() > 200) {
            detail = detail.substring(0, 200) + "…";
        }
        String suffix = (detail == null || detail.isBlank()) ? "" : (": " + detail);
        return switch (code) {
            case 401 -> new IllegalArgumentException("GitLab: неверный token (401)" + suffix);
            case 403 -> new IllegalArgumentException("GitLab: доступ запрещён (403) при " + action + suffix);
            case 404 -> new IllegalArgumentException("GitLab: не найдено (404) при " + action + suffix);
            default -> new IllegalArgumentException("GitLab HTTP " + code + " при " + action + suffix);
        };
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
