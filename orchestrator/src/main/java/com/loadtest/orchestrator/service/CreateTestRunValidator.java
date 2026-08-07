package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.web.dto.CreateTestRunRequest;
import org.springframework.stereotype.Component;

/** Входная валидация {@link CreateTestRunRequest} (без I/O). */
@Component
public class CreateTestRunValidator {

    public void validate(CreateTestRunRequest req) {
        if (req == null) {
            throw new IllegalArgumentException("Тело запроса обязательно");
        }
        if (req.testId() == null || req.testId().isBlank()) {
            throw new IllegalArgumentException("Укажите test_id (ключ задачичи в Jira)");
        }
        boolean hasBuild = req.buildId() != null && !req.buildId().isBlank();
        boolean hasScript = req.scriptId() != null && !req.scriptId().isBlank();
        if (!hasBuild && !hasScript) {
            throw new IllegalArgumentException("Выберите сборку или загрузите скрипт");
        }
        TextSupport.requireNonBlank(req.startTime(), "start_time");
        TextSupport.requireNonBlank(req.endTime(), "end_time");
    }
}
