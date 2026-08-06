package com.loadtest.constructor.service;

import com.loadtest.constructor.client.GitLabClient;
import com.loadtest.constructor.persistence.PortalSettingsEntity;
import com.loadtest.constructor.web.dto.GitLabRunDefaultsDto;
import com.loadtest.constructor.web.dto.GitLabSettingsDto;
import com.loadtest.constructor.web.dto.GitLabTestConnectionResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

@Service
public class GitLabSettingsService {

    private static final Logger log = LoggerFactory.getLogger(GitLabSettingsService.class);

    private final PortalSettingsService portalSettingsService;
    private final GitLabClient gitLabClient;

    public GitLabSettingsService(
            PortalSettingsService portalSettingsService,
            GitLabClient gitLabClient) {
        this.portalSettingsService = portalSettingsService;
        this.gitLabClient = gitLabClient;
    }

    public GitLabSettingsDto getGitLab() {
        return toDto(portalSettingsService.loadEntity());
    }

    public GitLabRunDefaultsDto getRunDefaults() {
        PortalSettingsEntity e = portalSettingsService.loadEntity();
        String repo = nullToEmpty(e.getGitlabRepository()).isBlank() ? "lt-ump" : e.getGitlabRepository().trim();
        boolean configured = !nullToEmpty(e.getGitlabBaseUrl()).isBlank()
                && !nullToEmpty(e.getGitlabProjectId()).isBlank()
                && resolveTriggerToken(e).isPresent()
                && resolveUploadToken(e).isPresent();
        return new GitLabRunDefaultsDto(repo, configured);
    }

    @Transactional
    public GitLabSettingsDto saveGitLab(GitLabSettingsDto dto) {
        PortalSettingsEntity e = portalSettingsService.loadEntity();
        e.setGitlabBaseUrl(nullToEmpty(dto.gitlabBaseUrl()));
        e.setGitlabProjectId(nullToEmpty(dto.gitlabProjectId()));
        e.setGitlabRepository(nullToEmpty(dto.gitlabRepository()).isBlank()
                ? "lt-ump"
                : dto.gitlabRepository().trim());
        e.setGitlabTriggerRef("master");
        if (dto.gitlabTriggerToken() != null) {
            e.setGitlabTriggerToken(dto.gitlabTriggerToken().trim());
        }
        if (dto.gitlabUploadToken() != null) {
            e.setGitlabUploadToken(dto.gitlabUploadToken().trim());
        }
        if (dto.gitlabWebhookSecret() != null) {
            e.setGitlabWebhookSecret(dto.gitlabWebhookSecret().trim());
        }
        e.setGrafanaBaseUrl(nullToEmpty(dto.grafanaBaseUrl()));
        e.setGrafanaDashboardTemplate(nullToEmpty(dto.grafanaDashboardTemplate()));
        portalSettingsService.saveEntity(e);
        return toDto(e);
    }

    public GitLabTestConnectionResult testConnection() {
        PortalSettingsEntity settings = portalSettingsService.loadEntity();
        if (settings.getGitlabBaseUrl() == null || settings.getGitlabBaseUrl().isBlank()) {
            return new GitLabTestConnectionResult(false, "Укажите GitLab base URL", null, null);
        }
        if (settings.getGitlabProjectId() == null || settings.getGitlabProjectId().isBlank()) {
            return new GitLabTestConnectionResult(false, "Укажите Project ID или path", null, null);
        }
        Optional<String> token = resolveUploadToken(settings);
        if (token.isEmpty()) {
            token = resolveTriggerToken(settings);
        }
        if (token.isEmpty()) {
            String msg = "Задайте upload token или trigger token в настройках (или GITLAB_UPLOAD_TOKEN / GITLAB_TRIGGER_TOKEN)";
            log.warn("GitLab connection test failed: {}", msg);
            return new GitLabTestConnectionResult(false, msg, null, null);
        }
        try {
            GitLabClient.ProjectInfo project = gitLabClient.getProject(
                    settings.getGitlabBaseUrl(),
                    token.get(),
                    settings.getGitlabProjectId());
            log.info("GitLab connection test ok project={}", project.pathWithNamespace());
            return new GitLabTestConnectionResult(
                    true,
                    "Соединение с GitLab успешно",
                    project.id(),
                    project.pathWithNamespace());
        } catch (IllegalArgumentException ex) {
            log.warn("GitLab connection test failed: {}", ex.getMessage());
            return new GitLabTestConnectionResult(false, ex.getMessage(), null, null);
        }
    }

    public Optional<String> resolveTriggerToken(PortalSettingsEntity settings) {
        String stored = nullToEmpty(settings.getGitlabTriggerToken());
        if (!stored.isBlank()) {
            return Optional.of(stored);
        }
        return optionalEnv("GITLAB_TRIGGER_TOKEN");
    }

    public Optional<String> resolveUploadToken(PortalSettingsEntity settings) {
        String stored = nullToEmpty(settings.getGitlabUploadToken());
        if (!stored.isBlank()) {
            return Optional.of(stored);
        }
        return optionalEnv("GITLAB_UPLOAD_TOKEN");
    }

    public Optional<String> resolveWebhookSecret(PortalSettingsEntity settings) {
        String stored = nullToEmpty(settings.getGitlabWebhookSecret());
        if (!stored.isBlank()) {
            return Optional.of(stored);
        }
        return optionalEnv("GITLAB_WEBHOOK_SECRET");
    }

    private static GitLabSettingsDto toDto(PortalSettingsEntity e) {
        return new GitLabSettingsDto(
                e.getGitlabBaseUrl(),
                e.getGitlabProjectId(),
                e.getGitlabRepository(),
                e.getGitlabTriggerToken(),
                e.getGitlabUploadToken(),
                e.getGitlabWebhookSecret(),
                e.getGrafanaBaseUrl(),
                e.getGrafanaDashboardTemplate());
    }

    private static Optional<String> optionalEnv(String name) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) {
            return Optional.empty();
        }
        return Optional.of(v.trim());
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
