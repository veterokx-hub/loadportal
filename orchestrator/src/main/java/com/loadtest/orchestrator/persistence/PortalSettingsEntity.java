package com.loadtest.orchestrator.persistence;

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

    // --- GitLab CI / Grafana ---
    @Column(name = "gitlab_base_url", length = 512)
    private String gitlabBaseUrl = "";

    @Column(name = "gitlab_project_id", length = 256)
    private String gitlabProjectId = "";

    /** Legacy: ref всегда master в коде; колонка сохранена для совместимости. */
    @Column(name = "gitlab_trigger_ref", length = 256)
    private String gitlabTriggerRef = "master";

    /** Legacy: заменено на TOOL=jmeter|k6. */
    @Column(name = "gitlab_jmeter_variable", length = 128)
    private String gitlabJmeterVariable = "LOADTEST_ENGINE=jmeter";

    /** Legacy: заменено на TOOL=jmeter|k6. */
    @Column(name = "gitlab_k6_variable", length = 128)
    private String gitlabK6Variable = "LOADTEST_ENGINE=k6";

    /** Legacy Vault path; токен теперь в gitlab_trigger_token. */
    @Column(name = "gitlab_trigger_token_vault_path", length = 512)
    private String gitlabTriggerTokenVaultPath = "loadtest/gitlab/trigger-token";

    /** Legacy Vault path; секрет теперь в gitlab_webhook_secret. */
    @Column(name = "gitlab_webhook_secret_vault_path", length = 512)
    private String gitlabWebhookSecretVaultPath = "loadtest/gitlab/webhook-secret";

    @Column(name = "gitlab_repository", length = 256)
    private String gitlabRepository = "lt-ump";

    @Column(name = "gitlab_trigger_token", length = 512)
    private String gitlabTriggerToken = "";

    @Column(name = "gitlab_upload_token", length = 512)
    private String gitlabUploadToken = "";

    @Column(name = "gitlab_webhook_secret", length = 512)
    private String gitlabWebhookSecret = "";

    @Column(name = "grafana_base_url", length = 512)
    private String grafanaBaseUrl = "";

    @Column(name = "grafana_dashboard_template", length = 2048)
    private String grafanaDashboardTemplate = "";

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

    public String getGitlabBaseUrl() {
        return gitlabBaseUrl;
    }

    public void setGitlabBaseUrl(String gitlabBaseUrl) {
        this.gitlabBaseUrl = gitlabBaseUrl;
    }

    public String getGitlabProjectId() {
        return gitlabProjectId;
    }

    public void setGitlabProjectId(String gitlabProjectId) {
        this.gitlabProjectId = gitlabProjectId;
    }

    public String getGitlabTriggerRef() {
        return gitlabTriggerRef;
    }

    public void setGitlabTriggerRef(String gitlabTriggerRef) {
        this.gitlabTriggerRef = gitlabTriggerRef;
    }

    public String getGitlabJmeterVariable() {
        return gitlabJmeterVariable;
    }

    public void setGitlabJmeterVariable(String gitlabJmeterVariable) {
        this.gitlabJmeterVariable = gitlabJmeterVariable;
    }

    public String getGitlabK6Variable() {
        return gitlabK6Variable;
    }

    public void setGitlabK6Variable(String gitlabK6Variable) {
        this.gitlabK6Variable = gitlabK6Variable;
    }

    public String getGitlabTriggerTokenVaultPath() {
        return gitlabTriggerTokenVaultPath;
    }

    public void setGitlabTriggerTokenVaultPath(String gitlabTriggerTokenVaultPath) {
        this.gitlabTriggerTokenVaultPath = gitlabTriggerTokenVaultPath;
    }

    public String getGitlabWebhookSecretVaultPath() {
        return gitlabWebhookSecretVaultPath;
    }

    public void setGitlabWebhookSecretVaultPath(String gitlabWebhookSecretVaultPath) {
        this.gitlabWebhookSecretVaultPath = gitlabWebhookSecretVaultPath;
    }

    public String getGitlabRepository() {
        return gitlabRepository;
    }

    public void setGitlabRepository(String gitlabRepository) {
        this.gitlabRepository = gitlabRepository;
    }

    public String getGitlabTriggerToken() {
        return gitlabTriggerToken;
    }

    public void setGitlabTriggerToken(String gitlabTriggerToken) {
        this.gitlabTriggerToken = gitlabTriggerToken;
    }

    public String getGitlabUploadToken() {
        return gitlabUploadToken;
    }

    public void setGitlabUploadToken(String gitlabUploadToken) {
        this.gitlabUploadToken = gitlabUploadToken;
    }

    public String getGitlabWebhookSecret() {
        return gitlabWebhookSecret;
    }

    public void setGitlabWebhookSecret(String gitlabWebhookSecret) {
        this.gitlabWebhookSecret = gitlabWebhookSecret;
    }

    public String getGrafanaBaseUrl() {
        return grafanaBaseUrl;
    }

    public void setGrafanaBaseUrl(String grafanaBaseUrl) {
        this.grafanaBaseUrl = grafanaBaseUrl;
    }

    public String getGrafanaDashboardTemplate() {
        return grafanaDashboardTemplate;
    }

    public void setGrafanaDashboardTemplate(String grafanaDashboardTemplate) {
        this.grafanaDashboardTemplate = grafanaDashboardTemplate;
    }
}
