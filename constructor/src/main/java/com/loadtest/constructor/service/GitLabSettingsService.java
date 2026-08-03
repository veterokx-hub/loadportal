package com.loadtest.constructor.service;

import com.loadtest.constructor.client.GitLabClient;
import com.loadtest.constructor.config.DiscoveryConfig;
import com.loadtest.constructor.persistence.PortalSettingsEntity;
import com.loadtest.constructor.secrets.SecretResolver;
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
    private final SecretResolver secretResolver;
    private final GitLabClient gitLabClient;
    private final DiscoveryConfig discoveryConfig;

    public GitLabSettingsService(
            PortalSettingsService portalSettingsService,
            SecretResolver secretResolver,
            GitLabClient gitLabClient,
            DiscoveryConfig discoveryConfig) {
        this.portalSettingsService = portalSettingsService;
        this.secretResolver = secretResolver;
        this.gitLabClient = gitLabClient;
        this.discoveryConfig = discoveryConfig;
    }

    public GitLabSettingsDto getGitLab() {
        return toDto(portalSettingsService.loadEntity());
    }

    @Transactional
    public GitLabSettingsDto saveGitLab(GitLabSettingsDto dto) {
        PortalSettingsEntity e = portalSettingsService.loadEntity();
        e.setGitlabBaseUrl(nullToEmpty(dto.gitlabBaseUrl()));
        e.setGitlabProjectId(nullToEmpty(dto.gitlabProjectId()));
        e.setGitlabTriggerRef(nullToEmpty(dto.gitlabTriggerRef()).isBlank() ? "main" : dto.gitlabTriggerRef());
        e.setGitlabJmeterVariable(nullToEmpty(dto.gitlabJmeterVariable()));
        e.setGitlabK6Variable(nullToEmpty(dto.gitlabK6Variable()));
        e.setGitlabTriggerTokenVaultPath(nullToEmpty(dto.gitlabTriggerTokenVaultPath()));
        e.setGitlabWebhookSecretVaultPath(nullToEmpty(dto.gitlabWebhookSecretVaultPath()));
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
        Optional<String> token = resolveTriggerToken(settings);
        if (token.isEmpty()) {
            String msg = discoveryConfig.getVault().isEnabled()
                    ? "Trigger token не найден в Vault по пути: " + settings.getGitlabTriggerTokenVaultPath()
                    : "Trigger token пуст — задайте GITLAB_TRIGGER_TOKEN или путь Vault";
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
        return secretResolver.resolve(settings.getGitlabTriggerTokenVaultPath());
    }

    public Optional<String> resolveWebhookSecret(PortalSettingsEntity settings) {
        return secretResolver.resolve(settings.getGitlabWebhookSecretVaultPath());
    }

    private static GitLabSettingsDto toDto(PortalSettingsEntity e) {
        return new GitLabSettingsDto(
                e.getGitlabBaseUrl(),
                e.getGitlabProjectId(),
                e.getGitlabTriggerRef(),
                e.getGitlabJmeterVariable(),
                e.getGitlabK6Variable(),
                e.getGitlabTriggerTokenVaultPath(),
                e.getGitlabWebhookSecretVaultPath(),
                e.getGrafanaBaseUrl(),
                e.getGrafanaDashboardTemplate());
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
