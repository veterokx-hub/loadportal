package com.loadtest.jmeterbuilder.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class HealthController {

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok", "service", "jmeter-builder");
    }

    /** Readiness / liveness для k8s (stateless). */
    @GetMapping("/ready")
    public Map<String, String> ready() {
        return Map.of("status", "ok", "service", "jmeter-builder");
    }
}
