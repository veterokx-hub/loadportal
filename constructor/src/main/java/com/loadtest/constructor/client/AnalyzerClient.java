package com.loadtest.constructor.client;

import tools.jackson.databind.ObjectMapper;
import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.service.ModuleEndpoints;
import com.loadtest.constructor.web.dto.AnalyzeRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Клиент модуля analyzer: разбор OpenAPI/Postman в черновик сценария. */
@Component
public class AnalyzerClient {

    private static final Logger log = LoggerFactory.getLogger(AnalyzerClient.class);

    /** Обрезка тела в логе: спека может весить мегабайты. */
    private static final int LOG_BODY_LIMIT = 300;

    private final ModuleEndpoints endpoints;
    private final ObjectMapper objectMapper;
    private final RestClient restClient;

    /** RestClient общий на приложение (см. HttpClientConfig) — пул соединений переиспользуется. */
    public AnalyzerClient(
            ModuleEndpoints endpoints,
            ObjectMapper objectMapper,
            @Qualifier("internalRestClient") RestClient restClient) {
        this.endpoints = endpoints;
        this.objectMapper = objectMapper;
        this.restClient = restClient;
    }

    public Scenario analyze(AnalyzeRequest request) {
        String json;
        try {
            json = objectMapper.writeValueAsString(request);
        } catch (Exception e) {
            throw new IllegalStateException("Не удалось сериализовать запрос к analyzer", e);
        }
        log.info("Analyzer request body: {}",
                json.length() > LOG_BODY_LIMIT ? json.substring(0, LOG_BODY_LIMIT) + "..." : json);

        // Адрес резолвится на каждый вызов (Consul/настройки могут измениться без рестарта),
        // но соединение берётся из общего пула.
        String responseBody = restClient.post()
                .uri(endpoints.analyzerBaseUrl() + "/analyze")
                .contentType(MediaType.APPLICATION_JSON)
                .body(json)
                .retrieve()
                .body(String.class);
        try {
            return objectMapper.readValue(responseBody, Scenario.class);
        } catch (Exception e) {
            throw new IllegalStateException("Не удалось разобрать ответ analyzer", e);
        }
    }
}
