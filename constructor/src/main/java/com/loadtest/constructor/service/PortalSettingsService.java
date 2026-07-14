package com.loadtest.constructor.service;

import com.loadtest.constructor.persistence.PortalSettingsEntity;
import com.loadtest.constructor.persistence.PortalSettingsRepository;
import com.loadtest.constructor.web.dto.InfrastructureSettingsDto;
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

    public InfrastructureSettingsDto getInfrastructure(ModuleEndpoints.ResolvedEndpoints resolved) {
        PortalSettingsEntity e = loadEntity();
        return toInfraDto(e, resolved);
    }

    @Transactional
    public InfrastructureSettingsDto saveInfrastructure(InfrastructureSettingsDto dto,
                                                        ModuleEndpoints.ResolvedEndpoints resolved) {
        PortalSettingsEntity e = loadEntity();
        e.setConsulEnabled(dto.consulEnabled());
        e.setConsulHost(nullToEmpty(dto.consulHost()).isBlank() ? "localhost" : dto.consulHost().trim());
        e.setConsulPort(dto.consulPort() > 0 ? dto.consulPort() : 8500);
        e.setConsulDatacenter(nullToEmpty(dto.consulDatacenter()));
        e.setConsulKvPrefix(nullToEmpty(dto.consulKvPrefix()).isBlank() ? "loadtest/" : dto.consulKvPrefix().trim());
        e.setConsulServiceAnalyzer(nullToEmpty(dto.consulServiceAnalyzer()).isBlank()
                ? "loadtest-analyzer" : dto.consulServiceAnalyzer().trim());
        e.setConsulServiceK6(nullToEmpty(dto.consulServiceK6()).isBlank()
                ? "loadtest-k6-generator" : dto.consulServiceK6().trim());
        e.setConsulServiceJmeter(nullToEmpty(dto.consulServiceJmeter()).isBlank()
                ? "loadtest-jmeter-builder" : dto.consulServiceJmeter().trim());
        e.setAnalyzerUrl(nullToEmpty(dto.analyzerUrl()));
        e.setK6GeneratorUrl(nullToEmpty(dto.k6GeneratorUrl()));
        e.setJmeterBuilderUrl(nullToEmpty(dto.jmeterBuilderUrl()));
        repository.save(e);
        return toInfraDto(e, resolved);
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

    private static InfrastructureSettingsDto toInfraDto(PortalSettingsEntity e,
                                                        ModuleEndpoints.ResolvedEndpoints r) {
        return new InfrastructureSettingsDto(
                e.isConsulEnabled(),
                e.getConsulHost(),
                e.getConsulPort(),
                e.getConsulDatacenter(),
                e.getConsulKvPrefix(),
                e.getConsulServiceAnalyzer(),
                e.getConsulServiceK6(),
                e.getConsulServiceJmeter(),
                e.getAnalyzerUrl() == null ? "" : e.getAnalyzerUrl(),
                e.getK6GeneratorUrl() == null ? "" : e.getK6GeneratorUrl(),
                e.getJmeterBuilderUrl() == null ? "" : e.getJmeterBuilderUrl(),
                r.analyzerUrl(),
                r.k6GeneratorUrl(),
                r.jmeterBuilderUrl(),
                r.consulReachable()
        );
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
