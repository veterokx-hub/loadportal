package com.loadtest.orchestrator.web;

import com.loadtest.orchestrator.config.AuthInterceptor;
import com.loadtest.orchestrator.service.AnalysisService;
import com.loadtest.orchestrator.web.dto.AnalysisDtos;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/analysis")
public class AnalysisController {

    private final AnalysisService analysisService;

    public AnalysisController(AnalysisService analysisService) {
        this.analysisService = analysisService;
    }

    /** Каталог метрик и правил — UI показывает, что модуль вообще умеет смотреть. */
    @GetMapping("/catalog")
    public Map<String, Object> catalog() {
        return analysisService.catalog();
    }

    /** Разбор ссылки на дашборд: предзаполнение формы вместо ручного ввода. */
    @PostMapping("/parse-link")
    public Map<String, Object> parseLink(@RequestBody AnalysisDtos.ParseLinkRequest body) {
        return analysisService.parseLink(body == null ? null : body.url());
    }

    @PostMapping
    public AnalysisDtos.RunDto create(
            @RequestBody AnalysisDtos.CreateRequest body, HttpServletRequest request) {
        return analysisService.create(body, AuthInterceptor.requireAuth(request));
    }

    @GetMapping
    public List<AnalysisDtos.RunDto> list(
            @RequestParam(name = "run_id", required = false) UUID runId, HttpServletRequest request) {
        var ctx = AuthInterceptor.requireAuth(request);
        return runId == null ? analysisService.list(ctx) : analysisService.listForRun(runId, ctx);
    }

    @GetMapping("/{id}")
    public AnalysisDtos.RunDto get(@PathVariable UUID id, HttpServletRequest request) {
        return analysisService.get(id, AuthInterceptor.requireAuth(request));
    }

    @PostMapping("/{id}/rerun")
    public AnalysisDtos.RunDto rerun(@PathVariable UUID id, HttpServletRequest request) {
        return analysisService.rerun(id, AuthInterceptor.requireAuth(request));
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable UUID id, HttpServletRequest request) {
        analysisService.delete(id, AuthInterceptor.requireAuth(request));
        return Map.of("deleted", true);
    }
}
