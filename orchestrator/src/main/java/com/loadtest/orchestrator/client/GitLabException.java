package com.loadtest.orchestrator.client;

import org.springframework.http.HttpStatus;

/** Ошибка вызова GitLab API (сеть / 4xx–5xx), не ошибка валидации запроса. */
public class GitLabException extends RuntimeException {

    private final HttpStatus status;

    public GitLabException(HttpStatus status, String message) {
        super(message);
        this.status = status != null ? status : HttpStatus.BAD_GATEWAY;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
