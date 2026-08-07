package com.loadtest.orchestrator.web;

import com.loadtest.orchestrator.config.AuthInterceptor;
import com.loadtest.orchestrator.service.GitLabSettingsService;
import com.loadtest.orchestrator.web.dto.GitLabRunDefaultsDto;
import com.loadtest.orchestrator.web.dto.GitLabSettingsDto;
import com.loadtest.orchestrator.web.dto.GitLabTestConnectionResult;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/settings/gitlab")
public class GitLabSettingsController {

    private final GitLabSettingsService gitLabSettingsService;

    public GitLabSettingsController(GitLabSettingsService gitLabSettingsService) {
        this.gitLabSettingsService = gitLabSettingsService;
    }

    @GetMapping
    public GitLabSettingsDto getGitLab(HttpServletRequest request) {
        AuthInterceptor.requireAdmin(request);
        return gitLabSettingsService.getGitLab();
    }

    @GetMapping("/defaults")
    public GitLabRunDefaultsDto getDefaults(HttpServletRequest request) {
        AuthInterceptor.requireAuth(request);
        return gitLabSettingsService.getRunDefaults();
    }

    @PutMapping
    public GitLabSettingsDto saveGitLab(@RequestBody GitLabSettingsDto dto, HttpServletRequest request) {
        AuthInterceptor.requireAdmin(request);
        return gitLabSettingsService.saveGitLab(dto);
    }

    @PostMapping("/test")
    public GitLabTestConnectionResult testConnection(HttpServletRequest request) {
        AuthInterceptor.requireAdmin(request);
        return gitLabSettingsService.testConnection();
    }
}
