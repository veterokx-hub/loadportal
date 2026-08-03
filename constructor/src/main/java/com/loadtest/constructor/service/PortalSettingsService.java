package com.loadtest.constructor.service;

import com.loadtest.constructor.persistence.PortalSettingsEntity;
import com.loadtest.constructor.persistence.PortalSettingsRepository;
import com.loadtest.constructor.web.dto.LdapSettingsDto;
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

    public LdapSettingsDto getLdap() {
        return toLdapDto(loadEntity());
    }

    @Transactional
    public LdapSettingsDto saveLdap(LdapSettingsDto dto) {
        PortalSettingsEntity e = loadEntity();
        e.setLdapEnabled(dto.ldapEnabled());
        e.setLdapUrl(nullToEmpty(dto.ldapUrl()));
        e.setLdapBaseDn(nullToEmpty(dto.ldapBaseDn()));
        e.setLdapUserDnPattern(nullToEmpty(dto.ldapUserDnPattern()));
        e.setLdapUserSearchBase(nullToEmpty(dto.ldapUserSearchBase()));
        e.setLdapUserSearchFilter(nullToEmpty(dto.ldapUserSearchFilter()));
        e.setLdapBindDn(nullToEmpty(dto.ldapBindDn()));
        if (dto.ldapBindPassword() != null && !dto.ldapBindPassword().isBlank()) {
            e.setLdapBindPassword(dto.ldapBindPassword());
        }
        repository.save(e);
        return toLdapDto(e);
    }

    private static LdapSettingsDto toLdapDto(PortalSettingsEntity e) {
        return new LdapSettingsDto(
                e.isLdapEnabled(),
                e.getLdapUrl(),
                e.getLdapBaseDn(),
                e.getLdapUserDnPattern(),
                e.getLdapUserSearchBase(),
                e.getLdapUserSearchFilter(),
                e.getLdapBindDn(),
                ""
        );
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
