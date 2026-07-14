package com.loadtest.constructor.web;

import com.loadtest.constructor.service.ModuleEndpoints;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class HealthController {

    private final ModuleEndpoints moduleEndpoints;
    private final RestClient.Builder restClientBuilder;

    public HealthController(ModuleEndpoints moduleEndpoints) {
        this.moduleEndpoints = moduleEndpoints;
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .version(HttpClient.Version.HTTP_1_1)
                .build();
        this.restClientBuilder = RestClient.builder()
                .requestFactory(new JdkClientHttpRequestFactory(httpClient));
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }

    /**
     * Readiness для k8s: проверяет доступность соседних модулей по resolved URL
     * (env / UI override / Consul).
     */
    @GetMapping("/ready")
    public ResponseEntity<Map<String, Object>> ready() {
        var resolved = moduleEndpoints.snapshot();
        Map<String, Object> deps = new LinkedHashMap<>();
        boolean jmeterOk = ping(resolved.jmeterBuilderUrl() + "/health");
        boolean analyzerOk = ping(resolved.analyzerUrl() + "/health");
        boolean k6Ok = ping(resolved.k6GeneratorUrl() + "/health");
        deps.put("jmeter_builder", Map.of("url", resolved.jmeterBuilderUrl(), "ok", jmeterOk));
        deps.put("analyzer", Map.of("url", resolved.analyzerUrl(), "ok", analyzerOk));
        deps.put("k6_generator", Map.of("url", resolved.k6GeneratorUrl(), "ok", k6Ok));
        deps.put("consul_enabled", resolved.consulEnabled());
        deps.put("consul_reachable", resolved.consulReachable());

        boolean all = jmeterOk && analyzerOk && k6Ok;
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", all ? "ok" : "degraded");
        body.put("dependencies", deps);

        // Статус 200 даже при degraded — конструктор может принимать логин;
        // для строгих probes используйте /ready/strict.
        return ResponseEntity.ok(body);
    }

    @GetMapping("/ready/strict")
    public ResponseEntity<Map<String, Object>> readyStrict() {
        ResponseEntity<Map<String, Object>> r = ready();
        Map<String, Object> body = r.getBody();
        if (body != null && "ok".equals(body.get("status"))) {
            return r;
        }
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(body);
    }

    private boolean ping(String url) {
        try {
            restClientBuilder.build().get().uri(url).retrieve().toBodilessEntity();
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
