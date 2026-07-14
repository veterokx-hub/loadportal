package com.loadtest.constructor.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.service.ModuleEndpoints;
import com.loadtest.constructor.web.dto.AnalyzeRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;

@Component
public class AnalyzerClient {

    private static final Logger log = LoggerFactory.getLogger(AnalyzerClient.class);

    private final ModuleEndpoints endpoints;
    private final ObjectMapper objectMapper;
    private final RestClient.Builder restClientBuilder;

    public AnalyzerClient(ModuleEndpoints endpoints, ObjectMapper objectMapper) {
        this.endpoints = endpoints;
        this.objectMapper = objectMapper;
        HttpClient httpClient = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
        this.restClientBuilder = RestClient.builder()
                .requestFactory(new JdkClientHttpRequestFactory(httpClient));
    }

    public Scenario analyze(AnalyzeRequest request) {
        String json;
        try {
            json = objectMapper.writeValueAsString(request);
        } catch (Exception e) {
            throw new IllegalStateException("Не удалось сериализовать запрос к analyzer", e);
        }
        log.info("Analyzer request body: {}", json.length() > 300 ? json.substring(0, 300) + "..." : json);

        String responseBody = restClientBuilder
                .baseUrl(endpoints.analyzerBaseUrl())
                .build()
                .post()
                .uri("/analyze")
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
