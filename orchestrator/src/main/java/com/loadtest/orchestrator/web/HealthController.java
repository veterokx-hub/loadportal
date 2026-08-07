package com.loadtest.orchestrator.web;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class HealthController {

    private final DataSource dataSource;

    public HealthController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok", "service", "orchestrator");
    }

    @GetMapping("/ready")
    public ResponseEntity<Map<String, Object>> ready() {
        Map<String, Object> body = new LinkedHashMap<>();
        boolean dbOk = pingDb();
        body.put("status", dbOk ? "ready" : "degraded");
        body.put("service", "orchestrator");
        body.put("postgres", dbOk);
        return ResponseEntity.ok(body);
    }

    private boolean pingDb() {
        try (Connection c = dataSource.getConnection()) {
            return c.isValid(2);
        } catch (Exception ex) {
            return false;
        }
    }
}
