package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.persistence.AuditEventEntity;
import com.loadtest.orchestrator.persistence.AuditEventRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuditService {

    public static final String RUN_START = "RUN_START";
    public static final String RUN_CANCEL = "RUN_CANCEL";
    public static final String ANALYSIS_START = "ANALYSIS_START";

    private final AuditEventRepository repository;

    public AuditService(AuditEventRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public void record(String username, String action, String detail) {
        String user = username == null || username.isBlank() ? "?" : username.trim();
        String text = detail == null ? "" : detail;
        if (text.length() > 500) {
            text = text.substring(0, 500);
        }
        repository.save(new AuditEventEntity(user, action, text));
    }
}
