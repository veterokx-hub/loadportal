package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.client.GitLabClient;
import com.loadtest.orchestrator.persistence.PortalSettingsEntity;
import com.loadtest.orchestrator.web.dto.GitLabRunDefaultsDto;
import com.loadtest.orchestrator.web.dto.GitLabSettingsDto;
import com.loadtest.orchestrator.web.dto.GitLabTestConnectionResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

@Service
public class GitLabSettingsService {

    private static final Logger log = LoggerFactory.getLogger(GitLabSettingsService.class);
    private static final String DEFAULT_REPOSITORY = "lt-ump";

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
        PortalSettingsEntity settings = portalSettingsService.loadEntity();
        String repo = TextSupport.firstNonBlank(settings.getGitlabRepository(), DEFAULT_REPOSITORY);
        boolean configured = hasText(settings.getGitlabBaseUrl())
                && hasText(settings.getGitlabProjectId())
                && resolveTriggerToken(settings).isPresent()
                && resolveUploadToken(settings).isPresent();
        return new GitLabRunDefaultsDto(repo, configured);
    }

    @Transactional
    public GitLabSettingsDto saveGitLab(GitLabSettingsDto dto) {
        PortalSettingsEntity entity = portalSettingsService.loadEntity();
        entity.setGitlabBaseUrl(TextSupport.nullToEmpty(dto.gitlabBaseUrl()));
        entity.setGitlabProjectId(TextSupport.nullToEmpty(dto.gitlabProjectId()));
        entity.setGitlabRepository(TextSupport.firstNonBlank(dto.gitlabRepository(), DEFAULT_REPOSITORY));
        entity.setGitlabTriggerRef("master");
        if (dto.gitlabTriggerToken() != null) {
            entity.setGitlabTriggerToken(dto.gitlabTriggerToken().trim());
        }
        if (dto.gitlabUploadToken() != null) {
            entity.setGitlabUploadToken(dto.gitlabUploadToken().trim());
        }
        if (dto.gitlabWebhookSecret() != null) {
            entity.setGitlabWebhookSecret(dto.gitlabWebhookSecret().trim());
        }
        entity.setGrafanaBaseUrl(TextSupport.nullToEmpty(dto.grafanaBaseUrl()));
        entity.setGrafanaDashboardTemplate(TextSupport.nullToEmpty(dto.grafanaDashboardTemplate()));
        portalSettingsService.saveEntity(entity);
        return toDto(entity);
    }

    public GitLabTestConnectionResult testConnection() {
        PortalSettingsEntity settings = portalSettingsService.loadEntity();
        if (!hasText(settings.getGitlabBaseUrl())) {
            return failure("Укажите GitLab base URL");
        }
        if (!hasText(settings.getGitlabProjectId())) {
            return failure("Укажите Project ID или path");
        }

        Optional<String> token = resolveUploadToken(settings).or(() -> resolveTriggerToken(settings));
        if (token.isEmpty()) {
            String msg = "Задайте upload token или trigger token в настройках "
                    + "(или GITLAB_UPLOAD_TOKEN / GITLAB_TRIGGER_TOKEN)";
            log.warn("GitLab connection test failed: {}", msg);
            return failure(msg);
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
            return failure(ex.getMessage());
        }
    }

    public Optional<String> resolveTriggerToken(PortalSettingsEntity settings) {
        return resolveSecret(settings.getGitlabTriggerToken(), "GITLAB_TRIGGER_TOKEN");
    }

    public Optional<String> resolveUploadToken(PortalSettingsEntity settings) {
        return resolveSecret(settings.getGitlabUploadToken(), "GITLAB_UPLOAD_TOKEN");
    }

    public Optional<String> resolveWebhookSecret(PortalSettingsEntity settings) {
        return resolveSecret(settings.getGitlabWebhookSecret(), "GITLAB_WEBHOOK_SECRET");
    }

    private static Optional<String> resolveSecret(String stored, String envName) {
        String value = TextSupport.nullToEmpty(stored).trim();
        if (!value.isEmpty()) {
            return Optional.of(value);
        }
        return optionalEnv(envName);
    }

    private static GitLabSettingsDto toDto(PortalSettingsEntity entity) {
        return new GitLabSettingsDto(
                entity.getGitlabBaseUrl(),
                entity.getGitlabProjectId(),
                entity.getGitlabRepository(),
                entity.getGitlabTriggerToken(),
                entity.getGitlabUploadToken(),
                entity.getGitlabWebhookSecret(),
                entity.getGrafanaBaseUrl(),
                entity.getGrafanaDashboardTemplate());
    }

    private static Optional<String> optionalEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        return Optional.of(value.trim());
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static GitLabTestConnectionResult failure(String message) {
        return new GitLabTestConnectionResult(false, message, null, null);
    }
}
