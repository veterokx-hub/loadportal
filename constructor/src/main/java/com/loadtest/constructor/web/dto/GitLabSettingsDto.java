package com.loadtest.constructor.web.dto;

public record GitLabSettingsDto(
        String gitlabBaseUrl,
        String gitlabProjectId,
        String gitlabRepository,
        String gitlabTriggerToken,
        String gitlabUploadToken,
        String gitlabWebhookSecret,
        String grafanaBaseUrl,
        String grafanaDashboardTemplate
) {
}
