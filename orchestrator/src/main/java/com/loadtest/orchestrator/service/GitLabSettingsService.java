package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.client.GitLabClient;
import com.loadtest.orchestrator.client.GitLabException;
import com.loadtest.orchestrator.config.ExternalConnections;
import com.loadtest.orchestrator.persistence.PortalSettingsEntity;
import com.loadtest.orchestrator.secrets.SecretResolver;
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
    private static final String VAULT_UPLOAD_TOKEN = "loadtest/gitlab/upload-token";

    private final PortalSettingsService portalSettingsService;
    private final GitLabClient gitLabClient;
    private final SecretResolver secretResolver;
    private final ExternalConnections connections;

    public GitLabSettingsService(
            PortalSettingsService portalSettingsService,
            GitLabClient gitLabClient,
            SecretResolver secretResolver,
            ExternalConnections connections) {
        this.portalSettingsService = portalSettingsService;
        this.gitLabClient = gitLabClient;
        this.secretResolver = secretResolver;
        this.connections = connections;
    }

    public GitLabSettingsDto getGitLab() {
        return toDto(portalSettingsService.loadEntity());
    }

    public GitLabRunDefaultsDto getRunDefaults() {
        PortalSettingsEntity settings = portalSettingsService.loadEntity();
        String repo = TextSupport.firstNonBlank(
                connections.gitlabRepository(settings.getGitlabRepository()),
                DEFAULT_REPOSITORY);
        boolean configured = hasText(connections.gitlabBaseUrl(settings.getGitlabBaseUrl()))
                && hasText(connections.gitlabProjectId(settings.getGitlabProjectId()))
                && resolveTriggerToken(settings).isPresent()
                && connections.s3Ready();
        return new GitLabRunDefaultsDto(repo, configured);
    }

    @Transactional
    public GitLabSettingsDto saveGitLab(GitLabSettingsDto dto) {
        PortalSettingsEntity entity = portalSettingsService.loadEntity();
        entity.setGitlabBaseUrl(TextSupport.nullToEmpty(dto.gitlabBaseUrl()));
        entity.setGitlabProjectId(TextSupport.nullToEmpty(dto.gitlabProjectId()));
        entity.setGitlabRepository(TextSupport.firstNonBlank(dto.gitlabRepository(), DEFAULT_REPOSITORY));
        entity.setGitlabTriggerRef("master");
        if (isPlainSecret(dto.gitlabTriggerToken())) {
            entity.setGitlabTriggerToken(dto.gitlabTriggerToken().trim());
        }
        if (isPlainSecret(dto.gitlabUploadToken())) {
            entity.setGitlabUploadToken(dto.gitlabUploadToken().trim());
        }
        if (isPlainSecret(dto.gitlabWebhookSecret())) {
            entity.setGitlabWebhookSecret(dto.gitlabWebhookSecret().trim());
        }
        entity.setGrafanaBaseUrl(TextSupport.nullToEmpty(dto.grafanaBaseUrl()));
        entity.setGrafanaDashboardTemplate(TextSupport.nullToEmpty(dto.grafanaDashboardTemplate()));
        portalSettingsService.saveEntity(entity);
        return toDto(entity);
    }

    public GitLabTestConnectionResult testConnection() {
        PortalSettingsEntity settings = portalSettingsService.loadEntity();
        String baseUrl = connections.gitlabBaseUrl(settings.getGitlabBaseUrl());
        String projectId = connections.gitlabProjectId(settings.getGitlabProjectId());
        if (!hasText(baseUrl)) {
            return failure("Укажите GitLab base URL");
        }
        if (!hasText(projectId)) {
            return failure("Укажите Project ID или path");
        }

        Optional<String> readToken = connections.gitlabApiToken().or(() -> resolveUploadToken(settings));
        try {
            if (readToken.isPresent()) {
                GitLabClient.ProjectInfo project = gitLabClient.getProject(baseUrl, readToken.get(), projectId);
                log.info("GitLab connection test ok project={}", project.pathWithNamespace());
                return new GitLabTestConnectionResult(
                        true,
                        "Соединение с GitLab успешно",
                        project.id(),
                        project.pathWithNamespace());
            }
            String version = gitLabClient.version(baseUrl);
            log.info("GitLab version check ok version={}", version);
            return new GitLabTestConnectionResult(
                    true,
                    "GitLab доступен" + (version.isBlank() ? "" : " (" + version + ")")
                            + ". Проект не проверялся: нет API-токена (GITLAB_API_TOKEN)",
                    null,
                    null);
        } catch (GitLabException | IllegalArgumentException ex) {
            log.warn("GitLab connection test failed: {}", ex.getMessage());
            return failure(ex.getMessage());
        }
    }

    /**
     * Приоритет: Vault → env → значение в БД.
     */
    public Optional<String> resolveTriggerToken(PortalSettingsEntity settings) {
        return resolveSecret(
                settings.getGitlabTriggerToken(),
                TextSupport.firstNonBlank(
                        settings.getGitlabTriggerTokenVaultPath(),
                        "loadtest/gitlab/trigger-token"),
                "GITLAB_TRIGGER_TOKEN");
    }

    public Optional<String> resolveUploadToken(PortalSettingsEntity settings) {
        return resolveSecret(settings.getGitlabUploadToken(), VAULT_UPLOAD_TOKEN, "GITLAB_UPLOAD_TOKEN");
    }

    public Optional<String> resolveWebhookSecret(PortalSettingsEntity settings) {
        return resolveSecret(
                settings.getGitlabWebhookSecret(),
                TextSupport.firstNonBlank(
                        settings.getGitlabWebhookSecretVaultPath(),
                        "loadtest/gitlab/webhook-secret"),
                "GITLAB_WEBHOOK_SECRET");
    }

    private Optional<String> resolveSecret(String stored, String vaultPath, String envName) {
        Optional<String> external = secretResolver.resolve(vaultPath);
        if (external.isPresent()) {
            return external;
        }
        Optional<String> fromEnvName = secretResolver.resolve(envName);
        if (fromEnvName.isPresent()) {
            return fromEnvName;
        }
        String value = TextSupport.nullToEmpty(stored).trim();
        return value.isEmpty() ? Optional.empty() : Optional.of(value);
    }

    private static GitLabSettingsDto toDto(PortalSettingsEntity entity) {
        return new GitLabSettingsDto(
                entity.getGitlabBaseUrl(),
                entity.getGitlabProjectId(),
                entity.getGitlabRepository(),
                maskSecret(entity.getGitlabTriggerToken()),
                maskSecret(entity.getGitlabUploadToken()),
                maskSecret(entity.getGitlabWebhookSecret()),
                entity.getGrafanaBaseUrl(),
                entity.getGrafanaDashboardTemplate());
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static String maskSecret(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        if (value.length() <= 4) {
            return "****";
        }
        return "****" + value.substring(value.length() - 4);
    }

    private static boolean isPlainSecret(String value) {
        if (value == null) {
            return false;
        }
        String v = value.trim();
        return !v.isEmpty() && !v.startsWith("****") && !v.startsWith("••");
    }

    private static GitLabTestConnectionResult failure(String message) {
        return new GitLabTestConnectionResult(false, message, null, null);
    }
}
