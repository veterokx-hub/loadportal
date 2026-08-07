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

    /**
     * RestClient общий на приложение (см. HttpClientConfig): у него заданы таймауты,
     * без которых недоступный GitLab держал бы поток до победного.
     */
    public GitLabClient(ObjectMapper objectMapper, @Qualifier("sharedRestClient") RestClient restClient) {
        this.objectMapper = objectMapper;
        this.restClient = restClient;
    }

    public ProjectInfo getProject(String baseUrl, String token, String projectIdOrPath) {
        String encoded = encodeProjectId(projectIdOrPath);
        String url = normalizeBase(baseUrl) + "/api/v4/projects/" + encoded;
        try {
            String body = restClient.get()
                    .uri(url)
                    .header("PRIVATE-TOKEN", token)
                    .retrieve()
                    .body(String.class);
            JsonNode node = objectMapper.readTree(body);
            return new ProjectInfo(
                    node.path("id").asLong(),
                    node.path("path_with_namespace").asText(projectIdOrPath),
                    node.path("web_url").asText("")
            );
        } catch (HttpStatusCodeException ex) {
            throw mapHttpError(ex, "проект GitLab");
        } catch (Exception ex) {
            throw new IllegalArgumentException("GitLab недоступен: " + ex.getMessage());
        }
    }

    /**
     * Создаёт или обновляет файл в репозитории (ветка {@link #DEFAULT_REF}).
     */
    public void upsertFile(
            String baseUrl,
            String privateToken,
            String projectIdOrPath,
            String filePath,
            byte[] content,
            String commitMessage) {
        if (content == null) {
            throw new IllegalArgumentException("Пустое содержимое скрипта");
        }
        String encodedProject = encodeProjectId(projectIdOrPath);
        String encodedPath = URLEncoder.encode(filePath, StandardCharsets.UTF_8)
                .replace("+", "%20");
        String fileUrl = normalizeBase(baseUrl) + "/api/v4/projects/" + encodedProject
                + "/repository/files/" + encodedPath;
        boolean exists = fileExists(fileUrl, privateToken);
        String b64 = Base64.getEncoder().encodeToString(content);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("branch", DEFAULT_REF);
        payload.put("content", b64);
        payload.put("encoding", "base64");
        payload.put("commit_message", commitMessage == null || commitMessage.isBlank()
                ? "portal: upload " + filePath
                : commitMessage);
        try {
            if (exists) {
                restClient.put()
                        .uri(fileUrl)
                        .header("PRIVATE-TOKEN", privateToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(payload)
                        .retrieve()
                        .toBodilessEntity();
            } else {
                restClient.post()
                        .uri(fileUrl)
                        .header("PRIVATE-TOKEN", privateToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(payload)
                        .retrieve()
                        .toBodilessEntity();
            }
        } catch (HttpStatusCodeException ex) {
            throw mapHttpError(ex, exists ? "обновлении файла" : "создании файла");
        } catch (Exception ex) {
            throw new IllegalArgumentException("GitLab: не удалось залить файл: " + ex.getMessage());
        }
    }

    /**
     * Trigger Pipeline API (form-urlencoded).
     */
    public TriggerResult triggerPipeline(
            String baseUrl,
            String projectIdOrPath,
            String triggerToken,
            Map<String, String> variables) {
        String encodedProject = encodeProjectId(projectIdOrPath);
        String url = normalizeBase(baseUrl) + "/api/v4/projects/" + encodedProject + "/trigger/pipeline";
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("token", triggerToken);
        form.add("ref", DEFAULT_REF);
        if (variables != null) {
            for (Map.Entry<String, String> e : variables.entrySet()) {
                if (e.getKey() == null || e.getKey().isBlank()) {
                    continue;
                }
                form.add("variables[" + e.getKey() + "]", e.getValue() == null ? "" : e.getValue());
            }
        }
        try {
            String body = restClient.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(String.class);
            JsonNode node = objectMapper.readTree(body);
            return new TriggerResult(
                    node.path("id").asLong(),
                    node.path("web_url").asText(""),
                    node.path("status").asText("pending"));
        } catch (HttpStatusCodeException ex) {
            throw mapHttpError(ex, "trigger pipeline");
        } catch (Exception ex) {
            throw new IllegalArgumentException("GitLab trigger недоступен: " + ex.getMessage());
        }
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

    private static String encodeProjectId(String projectIdOrPath) {
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

    public record ProjectInfo(long id, String pathWithNamespace, String webUrl) {
    }

    public record TriggerResult(long pipelineId, String webUrl, String status) {
    }
}
