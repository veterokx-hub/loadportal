package com.loadtest.constructor.client;

import tools.jackson.databind.ObjectMapper;
import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.service.ModuleEndpoints;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Клиент модуля jmeter-builder: сборка .jmx (или zip с CSV-датасетами). */
@Component
public class JmeterBuilderClient {

    private final ModuleEndpoints endpoints;
    private final ObjectMapper objectMapper;
    private final RestClient restClient;

    /** RestClient общий на приложение (см. HttpClientConfig) — пул соединений переиспользуется. */
    public JmeterBuilderClient(
            ModuleEndpoints endpoints,
            ObjectMapper objectMapper,
            @Qualifier("internalRestClient") RestClient restClient) {
        this.endpoints = endpoints;
        this.objectMapper = objectMapper;
        this.restClient = restClient;
    }

    public BinaryResult generateJmeter(Scenario scenario) {
        String json;
        try {
            json = objectMapper.writeValueAsString(scenario);
        } catch (Exception e) {
            throw new IllegalStateException("Не удалось сериализовать сценарий для jmeter-builder", e);
        }

        ResponseEntity<byte[]> resp = restClient.post()
                .uri(endpoints.jmeterBuilderBaseUrl() + "/generate/jmeter")
                .contentType(MediaType.APPLICATION_JSON)
                .body(json)
                .retrieve()
                .toEntity(byte[].class);

        // Тип и имя файла определяет генератор: одиночный .jmx или zip, если есть датасеты.
        MediaType ct = resp.getHeaders().getContentType();
        String cd = resp.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION);
        return new BinaryResult(
                resp.getBody(),
                ct != null ? ct.toString() : "application/octet-stream",
                cd != null ? cd : "attachment; filename=\"scenario.jmx\"");
    }

    /** Артефакт вместе с заголовками, под которыми его отдаст constructor. */
    public record BinaryResult(byte[] body, String contentType, String contentDisposition) {
    }
}
