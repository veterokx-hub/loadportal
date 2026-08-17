package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.client.GitLabClient;
import com.loadtest.orchestrator.client.GitLabException;
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

    public GitLabSettingsService(
            PortalSettingsService portalSettingsService,
            GitLabClient gitLabClient,
            SecretResolver secretResolver) {
        this.portalSettingsService = portalSettingsService;
        this.gitLabClient = gitLabClient;
        this.secretResolver = secretResolver;
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
            String msg = "Задайте upload/trigger token в настройках, Vault или env "
                    + "(GITLAB_UPLOAD_TOKEN / GITLAB_TRIGGER_TOKEN)";
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
        } catch (GitLabException | IllegalArgumentException ex) {
            log.warn("GitLab connection test failed: {}", ex.getMessage());
            return failure(ex.getMessage());
        }
    }

    /**
     * Приоритет: значение в БД → Vault (path) → env (через {@link SecretResolver}).
     * В перспективе токены живут только в Vault; БД/UI — временный fallback.
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
        String value = TextSupport.nullToEmpty(stored).trim();
        if (!value.isEmpty()) {
            return Optional.of(value);
        }
        Optional<String> fromVaultOrEnv = secretResolver.resolve(vaultPath);
        if (fromVaultOrEnv.isPresent()) {
            return fromVaultOrEnv;
        }
        return secretResolver.resolve(envName);
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

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static GitLabTestConnectionResult failure(String message) {
        return new GitLabTestConnectionResult(false, message, null, null);
    }
}
