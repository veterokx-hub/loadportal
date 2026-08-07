package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.persistence.PortalSettingsEntity;
import com.loadtest.orchestrator.persistence.PortalSettingsRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PortalSettingsService {

    private final PortalSettingsRepository repository;

    public PortalSettingsService(PortalSettingsRepository repository) {
        this.repository = repository;
    }

    public PortalSettingsEntity loadEntity() {
        return repository.findById(1L).orElseGet(() -> repository.save(PortalSettingsEntity.defaults()));
    }

    @Transactional
    public PortalSettingsEntity saveEntity(PortalSettingsEntity entity) {
        return repository.save(entity);
    }
}
