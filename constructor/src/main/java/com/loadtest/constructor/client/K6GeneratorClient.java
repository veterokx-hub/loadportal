package com.loadtest.constructor.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.service.ModuleEndpoints;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;

@Component
public class K6GeneratorClient {

    private final ModuleEndpoints endpoints;
    private final ObjectMapper objectMapper;
    private final RestClient.Builder restClientBuilder;

    public K6GeneratorClient(ModuleEndpoints endpoints, ObjectMapper objectMapper) {
        this.endpoints = endpoints;
        this.objectMapper = objectMapper;
        HttpClient httpClient = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
        this.restClientBuilder = RestClient.builder()
                .requestFactory(new JdkClientHttpRequestFactory(httpClient));
    }

    public BinaryResult generateK6(Scenario scenario) {
        String json;
        try {
            json = objectMapper.writeValueAsString(scenario);
        } catch (Exception e) {
            throw new IllegalStateException("Не удалось сериализовать сценарий для k6-generator", e);
        }

        ResponseEntity<byte[]> resp = restClientBuilder
                .baseUrl(endpoints.k6GeneratorBaseUrl())
                .build()
                .post()
                .uri("/generate/k6")
                .contentType(MediaType.APPLICATION_JSON)
                .body(json)
                .retrieve()
                .toEntity(byte[].class);

        MediaType ct = resp.getHeaders().getContentType();
        String cd = resp.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION);
        return new BinaryResult(
                resp.getBody(),
                ct != null ? ct.toString() : "application/octet-stream",
                cd != null ? cd : "attachment; filename=\"scenario.js\"");
    }

    public record BinaryResult(byte[] body, String contentType, String contentDisposition) {
    }
}
