package com.loadtest.constructor.web;

import com.loadtest.constructor.client.GatlingGeneratorClient;
import com.loadtest.constructor.client.JmeterBuilderClient;
import com.loadtest.constructor.client.K6GeneratorClient;
import com.loadtest.constructor.config.AuthInterceptor;
import com.loadtest.constructor.metrics.PortalMetrics;
import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.persistence.BuildRecordEntity;
import com.loadtest.constructor.persistence.ScriptEntity;
import com.loadtest.constructor.service.AuditService;
import com.loadtest.constructor.service.BuildHistoryService;
import com.loadtest.constructor.service.ScriptService;
import com.loadtest.constructor.web.dto.BuildSaveRequest;
import com.loadtest.constructor.web.dto.BuildSaveResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class BuildController {

    private final JmeterBuilderClient jmeterBuilderClient;
    private final K6GeneratorClient k6GeneratorClient;
    private final GatlingGeneratorClient gatlingGeneratorClient;
    private final BuildHistoryService buildHistoryService;
    private final ScriptService scriptService;
    private final PortalMetrics metrics;
    private final AuditService auditService;

    public BuildController(
            JmeterBuilderClient jmeterBuilderClient,
            K6GeneratorClient k6GeneratorClient,
            GatlingGeneratorClient gatlingGeneratorClient,
            BuildHistoryService buildHistoryService,
            ScriptService scriptService,
            PortalMetrics metrics,
            AuditService auditService) {
        this.jmeterBuilderClient = jmeterBuilderClient;
        this.k6GeneratorClient = k6GeneratorClient;
        this.gatlingGeneratorClient = gatlingGeneratorClient;
        this.buildHistoryService = buildHistoryService;
        this.scriptService = scriptService;
        this.metrics = metrics;
        this.auditService = auditService;
    }

    /** Сохранить сборку + сгенерировать script_id (без скачивания). */
    @PostMapping("/builds/save")
    public BuildSaveResponse saveBuild(@RequestBody BuildSaveRequest body, HttpServletRequest request) {
        String username = AuthInterceptor.requireAuth(request).username();
        if (body.scenario() == null) {
            throw new IllegalArgumentException("Сценарий обязателен");
        }
        String engine = body.engine() == null || body.engine().isBlank() ? "jmeter" : body.engine().trim().toLowerCase();
        GeneratedArtifact artifact = generate(body.scenario(), engine);
        BuildRecordEntity build = buildHistoryService.record(
                username, body.scenario(), engine, artifact.filename());
        ScriptEntity script = scriptService.saveFromBuild(
                username, build.getId(), engine, artifact.filename(), artifact.body());
        auditService.record(username, AuditService.BUILD_SAVE, engine + " " + artifact.filename());
        return new BuildSaveResponse(
                build.getId().toString(),
                script.getId().toString(),
                build.getScenarioName(),
                engine,
                artifact.filename());
    }

    /**
     * Разовая генерация без записи в историю: UI «Выгрузить скрипт», curl/CI.
     * История и script_id — только через {@code /api/builds/save}.
     */
    @PostMapping("/build")
    public ResponseEntity<byte[]> build(@RequestBody Scenario scenario, HttpServletRequest request) {
        String username = AuthInterceptor.requireAuth(request).username();
        return respond(username, scenario, "jmeter");
    }

    @PostMapping("/build/k6")
    public ResponseEntity<byte[]> buildK6(@RequestBody Scenario scenario, HttpServletRequest request) {
        String username = AuthInterceptor.requireAuth(request).username();
        return respond(username, scenario, "k6");
    }

    @PostMapping("/build/gatling")
    public ResponseEntity<byte[]> buildGatling(@RequestBody Scenario scenario, HttpServletRequest request) {
        String username = AuthInterceptor.requireAuth(request).username();
        return respond(username, scenario, "gatling");
    }

    private ResponseEntity<byte[]> respond(String username, Scenario scenario, String engine) {
        GeneratedArtifact artifact = generate(scenario, engine);
        auditService.record(username, AuditService.SCRIPT_EXPORT, engine + " " + artifact.filename());
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, artifact.contentDisposition())
                .contentType(MediaType.parseMediaType(artifact.contentType()))
                .body(artifact.body());
    }

    /**
     * Единственная точка обращения к генераторам — здесь же снимаются метрики сборки,
     * поэтому в них попадают оба пути: и сохранение, и разовая генерация.
     */
    private GeneratedArtifact generate(Scenario scenario, String engine) {
        long startedAt = System.nanoTime();
        try {
            GeneratedArtifact artifact = switch (engine) {
                case "k6" -> fromK6(scenario);
                case "gatling" -> fromGatling(scenario);
                default -> fromJmeter(scenario);
            };
            int size = artifact.body() == null ? 0 : artifact.body().length;
            metrics.recordBuild(engine, true, System.nanoTime() - startedAt, size);
            return artifact;
        } catch (RuntimeException e) {
            metrics.recordBuild(engine, false, System.nanoTime() - startedAt, 0);
            throw e;
        }
    }

    private GeneratedArtifact fromK6(Scenario scenario) {
        K6GeneratorClient.BinaryResult r = k6GeneratorClient.generateK6(scenario);
        String fn = filenameFromDisposition(r.contentDisposition(), safeName(scenario.name()) + ".js");
        return new GeneratedArtifact(fn, r.body(), r.contentType(), r.contentDisposition());
    }

    private GeneratedArtifact fromGatling(Scenario scenario) {
        GatlingGeneratorClient.BinaryResult r = gatlingGeneratorClient.generateGatling(scenario);
        String fn = filenameFromDisposition(r.contentDisposition(), safeName(scenario.name()) + ".zip");
        return new GeneratedArtifact(fn, r.body(), r.contentType(), r.contentDisposition());
    }

    private GeneratedArtifact fromJmeter(Scenario scenario) {
        JmeterBuilderClient.BinaryResult r = jmeterBuilderClient.generateJmeter(scenario);
        String fn = filenameFromDisposition(r.contentDisposition(), safeName(scenario.name()) + ".jmx");
        return new GeneratedArtifact(fn, r.body(), r.contentType(), r.contentDisposition());
    }

    private String filenameFromDisposition(String cd, String fallback) {
        if (cd == null) return fallback;
        var m = java.util.regex.Pattern.compile("filename=\"?([^\"]+)\"?").matcher(cd);
        return m.find() ? m.group(1) : fallback;
    }

    private String safeName(String name) {
        if (name == null || name.isBlank()) return "scenario";
        String cleaned = name.replaceAll("[^a-zA-Z0-9_.-]", "_")
                .replaceAll("_+", "_")
                .replaceAll("^_|_$", "");
        return cleaned.isBlank() ? "scenario" : cleaned;
    }

    private record GeneratedArtifact(String filename, byte[] body, String contentType, String contentDisposition) {
    }
}
