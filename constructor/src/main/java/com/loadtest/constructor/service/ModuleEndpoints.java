package com.loadtest.constructor.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.loadtest.constructor.persistence.PortalSettingsEntity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;

/**
 * Резолв URL зависимостей constructor.
 * Приоритет: (1) override из настроек портала → (2) Consul KV/Catalog → (3) env/localhost defaults.
 */
@Service
public class ModuleEndpoints {

    private static final Logger log = LoggerFactory.getLogger(ModuleEndpoints.class);

    private final PortalSettingsService settingsService;
    private final ObjectMapper objectMapper;
    private final RestClient.Builder restClientBuilder;

    private final String defaultAnalyzer;
    private final String defaultK6;
    private final String defaultJmeter;

    public ModuleEndpoints(
            PortalSettingsService settingsService,
            ObjectMapper objectMapper,
            @Value("${analyzer.base-url:http://localhost:8000}") String defaultAnalyzer,
            @Value("${k6-generator.base-url:http://localhost:8001}") String defaultK6,
            @Value("${jmeter-builder.base-url:http://localhost:8081}") String defaultJmeter) {
        this.settingsService = settingsService;
        this.objectMapper = objectMapper;
        this.defaultAnalyzer = defaultAnalyzer;
        this.defaultK6 = defaultK6;
        this.defaultJmeter = defaultJmeter;
        HttpClient httpClient = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
        this.restClientBuilder = RestClient.builder()
                .requestFactory(new JdkClientHttpRequestFactory(httpClient));
    }

    public String analyzerBaseUrl() {
        return resolve("analyzer", settingsService.loadEntity().getAnalyzerUrl(), defaultAnalyzer);
    }

    public String k6GeneratorBaseUrl() {
        return resolve("k6-generator", settingsService.loadEntity().getK6GeneratorUrl(), defaultK6);
    }

    public String jmeterBuilderBaseUrl() {
        return resolve("jmeter-builder", settingsService.loadEntity().getJmeterBuilderUrl(), defaultJmeter);
    }

    private String resolve(String serviceKey, String override, String fallback) {
        if (override != null && !override.isBlank()) {
            return trimSlash(override.trim());
        }
        PortalSettingsEntity s = settingsService.loadEntity();
        if (s.isConsulEnabled()) {
            try {
                String fromConsul = resolveFromConsul(s, serviceKey);
                if (fromConsul != null && !fromConsul.isBlank()) {
                    return trimSlash(fromConsul);
                }
            } catch (Exception e) {
                log.warn("Consul resolve failed for {}: {} — fallback to {}", serviceKey, e.getMessage(), fallback);
            }
        }
        return trimSlash(fallback);
    }

    private String resolveFromConsul(PortalSettingsEntity s, String serviceKey) throws Exception {
        String host = blankTo(s.getConsulHost(), "localhost");
        int port = s.getConsulPort() > 0 ? s.getConsulPort() : 8500;
        String prefix = blankTo(s.getConsulKvPrefix(), "loadtest/");
        if (!prefix.endsWith("/")) prefix = prefix + "/";

        RestClient consul = restClientBuilder.baseUrl("http://" + host + ":" + port).build();

        // 1) KV: loadtest/services/{serviceKey}/url
        String kvPath = "/v1/kv/" + prefix + "services/" + serviceKey + "/url?raw";
        try {
            String raw = consul.get().uri(kvPath).retrieve().body(String.class);
            if (raw != null && !raw.isBlank()) {
                return raw.trim();
            }
        } catch (Exception ignored) {
            // fall through to catalog
        }

        // 2) Catalog by service name
        String serviceName = switch (serviceKey) {
            case "analyzer" -> blankTo(s.getConsulServiceAnalyzer(), "loadtest-analyzer");
            case "k6-generator" -> blankTo(s.getConsulServiceK6(), "loadtest-k6-generator");
            case "jmeter-builder" -> blankTo(s.getConsulServiceJmeter(), "loadtest-jmeter-builder");
            default -> "loadtest-" + serviceKey;
        };
        String catalogPath = "/v1/catalog/service/" + serviceName;
        if (s.getConsulDatacenter() != null && !s.getConsulDatacenter().isBlank()) {
            catalogPath += "?dc=" + s.getConsulDatacenter().trim();
        }
        String body = consul.get().uri(catalogPath).retrieve().body(String.class);
        if (body == null || body.isBlank() || "[]".equals(body.trim())) {
            return null;
        }
        JsonNode arr = objectMapper.readTree(body);
        if (!arr.isArray() || arr.isEmpty()) {
            return null;
        }
        JsonNode first = arr.get(0);
        String address = text(first, "ServiceAddress");
        if (address == null || address.isBlank()) {
            address = text(first, "Address");
        }
        int svcPort = first.path("ServicePort").asInt(0);
        if (address == null || address.isBlank() || svcPort <= 0) {
            return null;
        }
        return "http://" + address + ":" + svcPort;
    }

    /** Проверка доступности Consul (для UI). */
    public boolean pingConsul() {
        PortalSettingsEntity s = settingsService.loadEntity();
        if (!s.isConsulEnabled()) return false;
        String host = blankTo(s.getConsulHost(), "localhost");
        int port = s.getConsulPort() > 0 ? s.getConsulPort() : 8500;
        try {
            String body = restClientBuilder.baseUrl("http://" + host + ":" + port).build()
                    .get().uri("/v1/status/leader")
                    .retrieve()
                    .body(String.class);
            return body != null && !body.isBlank();
        } catch (Exception e) {
            return false;
        }
    }

    public ResolvedEndpoints snapshot() {
        return new ResolvedEndpoints(
                analyzerBaseUrl(),
                k6GeneratorBaseUrl(),
                jmeterBuilderBaseUrl(),
                settingsService.loadEntity().isConsulEnabled(),
                pingConsul()
        );
    }

    public record ResolvedEndpoints(
            String analyzerUrl,
            String k6GeneratorUrl,
            String jmeterBuilderUrl,
            boolean consulEnabled,
            boolean consulReachable
    ) {
    }

    private static String trimSlash(String u) {
        if (u.endsWith("/")) return u.substring(0, u.length() - 1);
        return u;
    }

    private static String blankTo(String v, String def) {
        return v == null || v.isBlank() ? def : v.trim();
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }
}
