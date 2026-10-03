package com.loadtest.constructor.service;

import com.loadtest.constructor.persistence.AuditEventEntity;
import com.loadtest.constructor.persistence.AuditEventRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class AuditService {

    public static final String LOGIN = "LOGIN";
    public static final String BUILD_SAVE = "BUILD_SAVE";
    public static final String SCRIPT_EXPORT = "SCRIPT_EXPORT";
    public static final String RUN_START = "RUN_START";

    private static final int KEEP = 500;

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
        long extra = repository.count() - KEEP;
        if (extra > 0) {
            repository.deleteAllInBatch(
                    repository.findAllByOrderByCreatedAtAsc(PageRequest.of(0, (int) extra)));
        }
    }

    public List<AuditEventEntity> recent() {
        return repository.findAllByOrderByCreatedAtDesc(PageRequest.of(0, 200));
    }
}
