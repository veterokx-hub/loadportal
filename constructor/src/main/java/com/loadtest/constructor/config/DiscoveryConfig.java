package com.loadtest.constructor.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Адреса модулей / Consul / Vault — из ConfigMap {@code consul-vault-config.yaml}.
 * Секреты (пароли) — только Vault, не в этом файле.
 */
@ConfigurationProperties(prefix = "loadtest.discovery")
public class DiscoveryConfig {

    private Consul consul = new Consul();
    private Modules modules = new Modules();
    private Vault vault = new Vault();

    public Consul getConsul() {
        return consul;
    }

    public void setConsul(Consul consul) {
        this.consul = consul != null ? consul : new Consul();
    }

    public Modules getModules() {
        return modules;
    }

    public void setModules(Modules modules) {
        this.modules = modules != null ? modules : new Modules();
    }

    public Vault getVault() {
        return vault;
    }

    public void setVault(Vault vault) {
        this.vault = vault != null ? vault : new Vault();
    }

    public static class Consul {
        private boolean enabled = false;
        private String host = "localhost";
        private int port = 8500;
        private String datacenter = "";
        private String kvPrefix = "loadtest/";
        private String serviceFrontend = "loadtest-frontend";
        private String serviceConstructor = "loadtest-constructor";
        private String serviceAnalyzer = "loadtest-analyzer";
        private String serviceK6 = "loadtest-k6-generator";
        private String serviceJmeter = "loadtest-jmeter-builder";
        private String serviceGatling = "loadtest-gatling-generator";
        private String servicePostgres = "loadtest-postgres";

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getHost() {
            return host;
        }

        public void setHost(String host) {
            this.host = host;
        }

        public int getPort() {
            return port;
        }

        public void setPort(int port) {
            this.port = port;
        }

        public String getDatacenter() {
            return datacenter;
        }

        public void setDatacenter(String datacenter) {
            this.datacenter = datacenter;
        }

        public String getKvPrefix() {
            return kvPrefix;
        }

        public void setKvPrefix(String kvPrefix) {
            this.kvPrefix = kvPrefix;
        }

        public String getServiceFrontend() {
            return serviceFrontend;
        }

        public void setServiceFrontend(String serviceFrontend) {
            this.serviceFrontend = serviceFrontend;
        }

        public String getServiceConstructor() {
            return serviceConstructor;
        }

        public void setServiceConstructor(String serviceConstructor) {
            this.serviceConstructor = serviceConstructor;
        }

        public String getServiceAnalyzer() {
            return serviceAnalyzer;
        }

        public void setServiceAnalyzer(String serviceAnalyzer) {
            this.serviceAnalyzer = serviceAnalyzer;
        }

        public String getServiceK6() {
            return serviceK6;
        }

        public void setServiceK6(String serviceK6) {
            this.serviceK6 = serviceK6;
        }

        public String getServiceJmeter() {
            return serviceJmeter;
        }

        public void setServiceJmeter(String serviceJmeter) {
            this.serviceJmeter = serviceJmeter;
        }

        public String getServiceGatling() {
            return serviceGatling;
        }

        public void setServiceGatling(String serviceGatling) {
            this.serviceGatling = serviceGatling;
        }

        public String getServicePostgres() {
            return servicePostgres;
        }

        public void setServicePostgres(String servicePostgres) {
            this.servicePostgres = servicePostgres;
        }
    }

    public static class Modules {
        /** Frontend → API. Пусто = same-origin (/api через Ingress). */
        private String frontendApiBaseUrl = "";
        private String constructorUrl = "";
        private String orchestratorUrl = "";
        private String analyzerUrl = "";
        private String k6GeneratorUrl = "";
        private String jmeterBuilderUrl = "";
        private String gatlingGeneratorUrl = "";
        private String postgresJdbcUrl = "";

        public String getFrontendApiBaseUrl() {
            return frontendApiBaseUrl;
        }

        public void setFrontendApiBaseUrl(String frontendApiBaseUrl) {
            this.frontendApiBaseUrl = frontendApiBaseUrl;
        }

        public String getConstructorUrl() {
            return constructorUrl;
        }

        public void setConstructorUrl(String constructorUrl) {
            this.constructorUrl = constructorUrl;
        }

        public String getOrchestratorUrl() {
            return orchestratorUrl;
        }

        public void setOrchestratorUrl(String orchestratorUrl) {
            this.orchestratorUrl = orchestratorUrl;
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

        public String getGatlingGeneratorUrl() {
            return gatlingGeneratorUrl;
        }

        public void setGatlingGeneratorUrl(String gatlingGeneratorUrl) {
            this.gatlingGeneratorUrl = gatlingGeneratorUrl;
        }

        public String getPostgresJdbcUrl() {
            return postgresJdbcUrl;
        }

        public void setPostgresJdbcUrl(String postgresJdbcUrl) {
            this.postgresJdbcUrl = postgresJdbcUrl;
        }
    }

    public static class Vault {
        private boolean enabled = false;
        private String address = "";
        private String kvPath = "";

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getAddress() {
            return address;
        }

        public void setAddress(String address) {
            this.address = address;
        }

        public String getKvPath() {
            return kvPath;
        }

        public void setKvPath(String kvPath) {
            this.kvPath = kvPath;
        }
    }
}
