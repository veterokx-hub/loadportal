package com.loadtest.orchestrator.web.dto;

/** Публичные для авторизованных пользователей значения, нужные на экране запуска. */
public record GitLabRunDefaultsDto(
        String gitlabRepository,
        boolean configured
) {
}
