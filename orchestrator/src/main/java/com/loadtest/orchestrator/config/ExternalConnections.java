package com.loadtest.orchestrator.config;

import com.loadtest.orchestrator.secrets.SecretResolver;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * Несекреты S3 и GitLab: Consul KV, иначе yaml/env, иначе значение из БД.
 * Секреты: Vault, иначе env (см. {@code EnvSecretResolver}), иначе вызывающий читает БД.
 */
@Component
public class ExternalConnections {

    private final ConsulKv consul;
    private final SecretResolver secrets;
    private final Environment env;

    public ExternalConnections(ConsulKv consul, SecretResolver secrets, Environment env) {
        this.consul = consul;
        this.secrets = secrets;
        this.env = env;
    }

    public String s3Endpoint() {
        return pick("s3/endpoint", "loadtest.s3.endpoint", "");
    }

    /** Хост в presigned URL. Пусто = тот же, что endpoint (runner видит кластерный адрес). */
    public String s3PublicEndpoint() {
        String pub = pick("s3/public-endpoint", "loadtest.s3.public-endpoint", "");
        return pub.isBlank() ? s3Endpoint() : pub;
    }

    public String s3Bucket() {
        return pick("s3/bucket", "loadtest.s3.bucket", "");
    }

    public String s3Region() {
        String region = pick("s3/region", "loadtest.s3.region", "");
        return region.isBlank() ? "us-east-1" : region;
    }

    public Optional<String> s3AccessKey() {
        return secrets.resolve("loadtest/s3/access-key");
    }

    public Optional<String> s3SecretKey() {
        return secrets.resolve("loadtest/s3/secret-key");
    }

    public boolean s3Ready() {
        return !s3Endpoint().isBlank()
                && !s3Bucket().isBlank()
                && s3AccessKey().isPresent()
                && s3SecretKey().isPresent();
    }

    public String gitlabBaseUrl(String fromDb) {
        return pick("gitlab/base-url", "loadtest.gitlab.base-url", fromDb);
    }

    public String gitlabProjectId(String fromDb) {
        return pick("gitlab/project-id", "loadtest.gitlab.project-id", fromDb);
    }

    public String gitlabRepository(String fromDb) {
        return pick("gitlab/repository", "loadtest.gitlab.repository", fromDb);
    }

    public String gitlabRef(String fromDb) {
        String ref = pick("gitlab/ref", "loadtest.gitlab.ref", fromDb);
        return ref.isBlank() ? "master" : ref;
    }

    /** Личный токен для GET /projects. Trigger token для этого API не подходит. */
    public Optional<String> gitlabApiToken() {
        return secrets.resolve("loadtest/gitlab/api-token");
    }

    private String pick(String consulKey, String property, String fallback) {
        Optional<String> fromConsul = consul.get(consulKey).filter(s -> !s.isBlank());
        if (fromConsul.isPresent()) {
            return fromConsul.get().trim();
        }
        String configured = env.getProperty(property, "");
        if (!configured.isBlank()) {
            return configured.trim();
        }
        return fallback == null ? "" : fallback.trim();
    }
}
