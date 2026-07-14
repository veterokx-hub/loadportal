package com.loadtest.constructor.persistence;

import jakarta.persistence.*;

@Entity
@Table(name = "portal_settings")
public class PortalSettingsEntity {

    @Id
    private Long id = 1L;

    // --- LDAP ---
    @Column(nullable = false)
    private boolean ldapEnabled = false;

    @Column(length = 512)
    private String ldapUrl = "";

    @Column(length = 512)
    private String ldapBaseDn = "";

    @Column(length = 512)
    private String ldapUserDnPattern = "";

    @Column(length = 512)
    private String ldapUserSearchBase = "";

    @Column(length = 512)
    private String ldapUserSearchFilter = "";

    @Column(length = 512)
    private String ldapBindDn = "";

    @Column(length = 512)
    private String ldapBindPassword = "";

    // --- Consul / service discovery ---
    // columnDefinition + default: Hibernate ddl-auto:update умеет добавить NOT NULL
    // к таблице с уже существующими строками (иначе ALTER падает на PostgreSQL).
    @Column(nullable = false, columnDefinition = "boolean not null default false")
    private boolean consulEnabled = false;

    @Column(length = 255)
    private String consulHost = "localhost";

    @Column(nullable = false, columnDefinition = "integer not null default 8500")
    private int consulPort = 8500;

    @Column(length = 128)
    private String consulDatacenter = "";

    @Column(length = 128)
    private String consulKvPrefix = "loadtest/";

    @Column(length = 128)
    private String consulServiceAnalyzer = "loadtest-analyzer";

    @Column(name = "consul_service_k6", length = 128)
    private String consulServiceK6 = "loadtest-k6-generator";

    @Column(length = 128)
    private String consulServiceJmeter = "loadtest-jmeter-builder";

    /** Пустые = брать из Consul (если вкл.) или localhost-defaults из env. */
    @Column(length = 512)
    private String analyzerUrl = "";

    @Column(name = "k6_generator_url", length = 512)
    private String k6GeneratorUrl = "";

    @Column(length = 512)
    private String jmeterBuilderUrl = "";

    protected PortalSettingsEntity() {
    }

    public static PortalSettingsEntity defaults() {
        return new PortalSettingsEntity();
    }

    public Long getId() {
        return id;
    }

    public boolean isLdapEnabled() {
        return ldapEnabled;
    }

    public void setLdapEnabled(boolean ldapEnabled) {
        this.ldapEnabled = ldapEnabled;
    }

    public String getLdapUrl() {
        return ldapUrl;
    }

    public void setLdapUrl(String ldapUrl) {
        this.ldapUrl = ldapUrl;
    }

    public String getLdapBaseDn() {
        return ldapBaseDn;
    }

    public void setLdapBaseDn(String ldapBaseDn) {
        this.ldapBaseDn = ldapBaseDn;
    }

    public String getLdapUserDnPattern() {
        return ldapUserDnPattern;
    }

    public void setLdapUserDnPattern(String ldapUserDnPattern) {
        this.ldapUserDnPattern = ldapUserDnPattern;
    }

    public String getLdapUserSearchBase() {
        return ldapUserSearchBase;
    }

    public void setLdapUserSearchBase(String ldapUserSearchBase) {
        this.ldapUserSearchBase = ldapUserSearchBase;
    }

    public String getLdapUserSearchFilter() {
        return ldapUserSearchFilter;
    }

    public void setLdapUserSearchFilter(String ldapUserSearchFilter) {
        this.ldapUserSearchFilter = ldapUserSearchFilter;
    }

    public String getLdapBindDn() {
        return ldapBindDn;
    }

    public void setLdapBindDn(String ldapBindDn) {
        this.ldapBindDn = ldapBindDn;
    }

    public String getLdapBindPassword() {
        return ldapBindPassword;
    }

    public void setLdapBindPassword(String ldapBindPassword) {
        this.ldapBindPassword = ldapBindPassword;
    }

    public boolean isConsulEnabled() {
        return consulEnabled;
    }

    public void setConsulEnabled(boolean consulEnabled) {
        this.consulEnabled = consulEnabled;
    }

    public String getConsulHost() {
        return consulHost;
    }

    public void setConsulHost(String consulHost) {
        this.consulHost = consulHost;
    }

    public int getConsulPort() {
        return consulPort;
    }

    public void setConsulPort(int consulPort) {
        this.consulPort = consulPort;
    }

    public String getConsulDatacenter() {
        return consulDatacenter;
    }

    public void setConsulDatacenter(String consulDatacenter) {
        this.consulDatacenter = consulDatacenter;
    }

    public String getConsulKvPrefix() {
        return consulKvPrefix;
    }

    public void setConsulKvPrefix(String consulKvPrefix) {
        this.consulKvPrefix = consulKvPrefix;
    }

    public String getConsulServiceAnalyzer() {
        return consulServiceAnalyzer;
    }

    public void setConsulServiceAnalyzer(String consulServiceAnalyzer) {
        this.consulServiceAnalyzer = consulServiceAnalyzer;
    }

    public String getConsulServiceK6() {
        return consulServiceK6;
    }

    public void setConsulServiceK6(String consulServiceK6) {
        this.consulServiceK6 = consulServiceK6;
    }

    public String getConsulServiceJmeter() {
        return consulServiceJmeter;
    }

    public void setConsulServiceJmeter(String consulServiceJmeter) {
        this.consulServiceJmeter = consulServiceJmeter;
    }

    public String getAnalyzerUrl() {
        return analyzerUrl;
    }

    public void setAnalyzerUrl(String analyzerUrl) {
        this.analyzerUrl = analyzerUrl;
    }

    public String getK6GeneratorUrl() {
        return k6GeneratorUrl;
    }

    public void setK6GeneratorUrl(String k6GeneratorUrl) {
        this.k6GeneratorUrl = k6GeneratorUrl;
    }

    public String getJmeterBuilderUrl() {
        return jmeterBuilderUrl;
    }

    public void setJmeterBuilderUrl(String jmeterBuilderUrl) {
        this.jmeterBuilderUrl = jmeterBuilderUrl;
    }
}
