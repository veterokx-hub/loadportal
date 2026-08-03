package com.loadtest.constructor.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Клиент GitLab API: сейчас используется только для проверки доступа к проекту из настроек. */
@Component
public class GitLabClient {

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
        return switch (code) {
            case 401 -> new IllegalArgumentException("GitLab: неверный token (401)");
            case 403 -> new IllegalArgumentException("GitLab: доступ запрещён (403) при " + action);
            case 404 -> new IllegalArgumentException("GitLab: проект не найден (404)");
            default -> new IllegalArgumentException("GitLab HTTP " + code + " при " + action);
        };
    }

    public record ProjectInfo(long id, String pathWithNamespace, String webUrl) {
    }
}
