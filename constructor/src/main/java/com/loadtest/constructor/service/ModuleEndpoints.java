package com.loadtest.constructor.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.loadtest.constructor.config.DiscoveryConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * Резолв URL зависимостей constructor.
 * Приоритет: (1) modules.* из consul-vault-config → (2) Consul KV/Catalog → (3) env defaults.
 */
@Service
public class ModuleEndpoints {

    private static final Logger log = LoggerFactory.getLogger(ModuleEndpoints.class);

    private final DiscoveryConfig discovery;
    private final ObjectMapper objectMapper;
    private final RestClient restClient;

    private final String defaultAnalyzer;
    private final String defaultK6;
    private final String defaultJmeter;
    private final String defaultGatling;

    /**
     * Используется probe-клиент с короткими таймаутами: резолв вызывается перед каждой сборкой,
     * и недоступный Consul должен быстро уступить место значениям по умолчанию, а не задерживать
     * пользовательский запрос.
     */
    public ModuleEndpoints(
            DiscoveryConfig discovery,
            ObjectMapper objectMapper,
            @Qualifier("probeRestClient") RestClient restClient,
            @Value("${analyzer.base-url:http://localhost:8000}") String defaultAnalyzer,
            @Value("${k6-generator.base-url:http://localhost:8001}") String defaultK6,
            @Value("${jmeter-builder.base-url:http://localhost:8081}") String defaultJmeter,
            @Value("${gatling-generator.base-url:http://localhost:8002}") String defaultGatling) {
        this.discovery = discovery;
        this.objectMapper = objectMapper;
        this.restClient = restClient;
        this.defaultAnalyzer = defaultAnalyzer;
        this.defaultK6 = defaultK6;
        this.defaultJmeter = defaultJmeter;
        this.defaultGatling = defaultGatling;
    }

    public String analyzerBaseUrl() {
        return resolve("analyzer", discovery.getModules().getAnalyzerUrl(), defaultAnalyzer);
    }

    public String k6GeneratorBaseUrl() {
        return resolve("k6-generator", discovery.getModules().getK6GeneratorUrl(), defaultK6);
    }

    public String jmeterBuilderBaseUrl() {
        return resolve("jmeter-builder", discovery.getModules().getJmeterBuilderUrl(), defaultJmeter);
    }

    public String gatlingGeneratorBaseUrl() {
        return resolve("gatling-generator", discovery.getModules().getGatlingGeneratorUrl(), defaultGatling);
    }

    /** Пусто = same-origin (браузер ходит на /api через Ingress). */
    public String frontendApiBaseUrl() {
        String v = discovery.getModules().getFrontendApiBaseUrl();
        return v == null ? "" : v.trim();
    }

    private String resolve(String serviceKey, String override, String fallback) {
        if (override != null && !override.isBlank()) {
            return trimSlash(override.trim());
        }
        DiscoveryConfig.Consul consul = discovery.getConsul();
        if (consul.isEnabled()) {
            try {
                String fromConsul = resolveFromConsul(consul, serviceKey);
                if (fromConsul != null && !fromConsul.isBlank()) {
                    return trimSlash(fromConsul);
                }
            } catch (Exception e) {
                log.warn("Consul resolve failed for {}: {} — fallback to {}", serviceKey, e.getMessage(), fallback);
            }
        }
        return trimSlash(fallback);
    }

    private String resolveFromConsul(DiscoveryConfig.Consul consul, String serviceKey) throws Exception {
        String host = blankTo(consul.getHost(), "localhost");
        int port = consul.getPort() > 0 ? consul.getPort() : 8500;
        String prefix = blankTo(consul.getKvPrefix(), "loadtest/");
        if (!prefix.endsWith("/")) prefix = prefix + "/";

        String consulBase = "http://" + host + ":" + port;

        // Сначала явно прописанный KV-ключ, затем — регистрация сервиса в каталоге.
        String kvPath = consulBase + "/v1/kv/" + prefix + "services/" + serviceKey + "/url?raw";
        try {
            String raw = restClient.get().uri(kvPath).retrieve().body(String.class);
            if (raw != null && !raw.isBlank()) {
                return raw.trim();
            }
        } catch (Exception ignored) {
            // Ключа нет или Consul недоступен — пробуем каталог.
        }

        String serviceName = switch (serviceKey) {
            case "analyzer" -> blankTo(consul.getServiceAnalyzer(), "loadtest-analyzer");
            case "k6-generator" -> blankTo(consul.getServiceK6(), "loadtest-k6-generator");
            case "jmeter-builder" -> blankTo(consul.getServiceJmeter(), "loadtest-jmeter-builder");
            case "gatling-generator" -> blankTo(consul.getServiceGatling(), "loadtest-gatling-generator");
            case "constructor" -> blankTo(consul.getServiceConstructor(), "loadtest-constructor");
            case "frontend" -> blankTo(consul.getServiceFrontend(), "loadtest-frontend");
            default -> "loadtest-" + serviceKey;
        };
        String catalogPath = consulBase + "/v1/catalog/service/" + serviceName;
        if (consul.getDatacenter() != null && !consul.getDatacenter().isBlank()) {
            catalogPath += "?dc=" + consul.getDatacenter().trim();
        }
        String body = restClient.get().uri(catalogPath).retrieve().body(String.class);
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

    /** Доступен ли Consul — показывается в /ready, на резолв адресов не влияет. */
    public boolean pingConsul() {
        DiscoveryConfig.Consul consul = discovery.getConsul();
        if (!consul.isEnabled()) return false;
        String host = blankTo(consul.getHost(), "localhost");
        int port = consul.getPort() > 0 ? consul.getPort() : 8500;
        try {
            String body = restClient.get()
                    .uri("http://" + host + ":" + port + "/v1/status/leader")
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
                gatlingGeneratorBaseUrl(),
                frontendApiBaseUrl(),
                discovery.getConsul().isEnabled(),
                pingConsul(),
                discovery.getVault().isEnabled(),
                blankTo(discovery.getVault().getAddress(), "")
        );
    }

    public record ResolvedEndpoints(
            String analyzerUrl,
            String k6GeneratorUrl,
            String jmeterBuilderUrl,
            String gatlingGeneratorUrl,
            String frontendApiBaseUrl,
            boolean consulEnabled,
            boolean consulReachable,
            boolean vaultEnabled,
            String vaultAddress
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
