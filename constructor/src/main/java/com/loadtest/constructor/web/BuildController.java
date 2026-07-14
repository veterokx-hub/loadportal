package com.loadtest.constructor.web;

import com.loadtest.constructor.client.JmeterBuilderClient;
import com.loadtest.constructor.client.K6GeneratorClient;
import com.loadtest.constructor.config.AuthInterceptor;
import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.service.BuildHistoryService;
import com.loadtest.constructor.service.ScenarioService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api")
public class BuildController {

    private final ScenarioService scenarioService;
    private final JmeterBuilderClient jmeterBuilderClient;
    private final K6GeneratorClient k6GeneratorClient;
    private final BuildHistoryService buildHistoryService;

    public BuildController(ScenarioService scenarioService,
                           JmeterBuilderClient jmeterBuilderClient,
                           K6GeneratorClient k6GeneratorClient,
                           BuildHistoryService buildHistoryService) {
        this.scenarioService = scenarioService;
        this.jmeterBuilderClient = jmeterBuilderClient;
        this.k6GeneratorClient = k6GeneratorClient;
        this.buildHistoryService = buildHistoryService;
    }

    @PostMapping("/build")
    public ResponseEntity<byte[]> build(@RequestBody Scenario scenario, HttpServletRequest request) {
        String username = AuthInterceptor.requireAuth(request).username();
        return respondJmeter(scenario, username);
    }

    @PostMapping("/scenarios/{id}/build")
    public ResponseEntity<byte[]> buildSaved(@PathVariable UUID id, HttpServletRequest request) {
        String username = AuthInterceptor.requireAuth(request).username();
        Scenario scenario = scenarioService.loadScenario(id);
        return respondJmeter(scenario, username);
    }

    @PostMapping("/build/k6")
    public ResponseEntity<byte[]> buildK6(@RequestBody Scenario scenario, HttpServletRequest request) {
        String username = AuthInterceptor.requireAuth(request).username();
        K6GeneratorClient.BinaryResult r = k6GeneratorClient.generateK6(scenario);
        String fn = filenameFromDisposition(r.contentDisposition(), safeName(scenario.name()) + ".js");
        buildHistoryService.record(username, scenario, "k6", fn);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, r.contentDisposition())
                .contentType(MediaType.parseMediaType(r.contentType()))
                .body(r.body());
    }

    private ResponseEntity<byte[]> respondJmeter(Scenario scenario, String username) {
        JmeterBuilderClient.BinaryResult r = jmeterBuilderClient.generateJmeter(scenario);
        String fn = filenameFromDisposition(r.contentDisposition(), safeName(scenario.name()) + ".jmx");
        buildHistoryService.record(username, scenario, "jmeter", fn);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, r.contentDisposition())
                .contentType(MediaType.parseMediaType(r.contentType()))
                .body(r.body());
    }

    private String filenameFromDisposition(String cd, String fallback) {
        if (cd == null) return fallback;
        var m = java.util.regex.Pattern.compile("filename=\"?([^\"]+)\"?").matcher(cd);
        return m.find() ? m.group(1) : fallback;
    }

    private String safeName(String name) {
        if (name == null || name.isBlank()) return "scenario";
        return name.replaceAll("[^a-zA-Z0-9_.-]", "_");
    }
}
