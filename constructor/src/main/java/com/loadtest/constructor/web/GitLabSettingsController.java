package com.loadtest.constructor.web;

import com.loadtest.constructor.config.AuthInterceptor;
import com.loadtest.constructor.service.GitLabSettingsService;
import com.loadtest.constructor.web.dto.GitLabSettingsDto;
import com.loadtest.constructor.web.dto.GitLabTestConnectionResult;
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
