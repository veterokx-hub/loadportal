package com.loadtest.constructor.web;

import com.loadtest.constructor.config.AuthInterceptor;
import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.service.BuildHistoryService;
import com.loadtest.constructor.web.dto.BuildRecordSummary;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/builds")
public class BuildHistoryController {

    private final BuildHistoryService buildHistoryService;

    public BuildHistoryController(BuildHistoryService buildHistoryService) {
        this.buildHistoryService = buildHistoryService;
    }

    @GetMapping
    public List<BuildRecordSummary> list(HttpServletRequest request) {
        String username = AuthInterceptor.requireAuth(request).username();
        return buildHistoryService.listForUser(username);
    }

    @GetMapping("/{id}/scenario")
    public Scenario loadScenario(@PathVariable UUID id, HttpServletRequest request) {
        String username = AuthInterceptor.requireAuth(request).username();
        return buildHistoryService.loadScenario(id, username);
    }
}
