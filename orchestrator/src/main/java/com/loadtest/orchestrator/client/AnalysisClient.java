package com.loadtest.orchestrator.client;

import com.loadtest.orchestrator.config.DiscoveryConfig;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

import static org.springframework.http.HttpStatus.BAD_GATEWAY;
import static org.springframework.http.HttpStatus.BAD_REQUEST;

/**
 * Клиент сервиса analysis.
 *
 * <p>Отчёт возвращается как {@code Map}: его форму задаёт каталог правил на стороне
 * Python, и типизировать её здесь значит ломать сборку Java при каждом новом поле
 * в находке. Java-слою нужны из отчёта пять полей для сводки — их он и читает.
 */
@Component
public class AnalysisClient {

    private final RestClient restClient;
    private final DiscoveryConfig discovery;
    private final String defaultBaseUrl;

    public AnalysisClient(
            @Qualifier("internalRestClient") RestClient restClient,
            DiscoveryConfig discovery,
            @Value("${analysis.base-url:http://localhost:8003}") String defaultBaseUrl) {
        this.restClient = restClient;
        this.discovery = discovery;
        this.defaultBaseUrl = defaultBaseUrl;
    }

    public Map<String, Object> analyze(Object request) {
        return call("/analyze", request, "анализе прогона");
    }

    /** Разбор ссылки на дашборд Grafana в поля формы. */
    public Map<String, Object> parseLink(String url) {
        return call("/parse-link", Map.of("url", url), "разборе ссылки");
    }

    public Map<String, Object> catalog() {
        try {
            return read(restClient.get()
                    .uri(baseUrl() + "/catalog")
                    .retrieve()
                    .body(Map.class));
        } catch (HttpStatusCodeException ex) {
            throw mapError(ex, "чтении каталога метрик");
        } catch (Exception ex) {
            throw new ResponseStatusException(BAD_GATEWAY, "Модуль анализа недоступен: " + ex.getMessage());
        }
    }

    private Map<String, Object> call(String path, Object body, String action) {
        try {
            return read(restClient.post()
                    .uri(baseUrl() + path)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(Map.class));
        } catch (HttpStatusCodeException ex) {
            throw mapError(ex, action);
        } catch (Exception ex) {
            throw new ResponseStatusException(BAD_GATEWAY, "Модуль анализа недоступен при " + action + ": " + ex.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> read(Map<?, ?> body) {
        return body == null ? Map.of() : (Map<String, Object>) body;
    }

    private String baseUrl() {
        String configured = discovery.getModules().getAnalysisUrl();
        String url = (configured == null || configured.isBlank()) ? defaultBaseUrl : configured.trim();
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    /**
     * 4xx от analysis — это ошибка ввода пользователя (не задан service, окно наизнанку),
     * и она должна дойти до формы как есть. 5xx и обрывы — проблема стенда.
     */
    private static ResponseStatusException mapError(HttpStatusCodeException ex, String action) {
        String detail = ex.getResponseBodyAsString();
        if (detail != null && detail.length() > 400) {
            detail = detail.substring(0, 400) + "…";
        }
        if (ex.getStatusCode().is4xxClientError() && ex.getStatusCode().value() != 401) {
            return new ResponseStatusException(BAD_REQUEST, "Анализ отклонил запрос: " + detail);
        }
        return new ResponseStatusException(
                BAD_GATEWAY, "Модуль анализа вернул HTTP " + ex.getStatusCode().value() + " при " + action);
    }
}
