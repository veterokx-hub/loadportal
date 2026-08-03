package com.loadtest.constructor.web.dto;

public record GitLabSettingsDto(
        String gitlabBaseUrl,
        String gitlabProjectId,
        String gitlabTriggerRef,
        String gitlabJmeterVariable,
        String gitlabK6Variable,
        String gitlabTriggerTokenVaultPath,
        String gitlabWebhookSecretVaultPath,
        String grafanaBaseUrl,
        String grafanaDashboardTemplate
) {
}
