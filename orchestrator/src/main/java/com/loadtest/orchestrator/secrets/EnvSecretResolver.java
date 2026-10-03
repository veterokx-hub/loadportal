package com.loadtest.orchestrator.secrets;

import org.springframework.stereotype.Component;

import java.util.Optional;

/** Локальный fallback: известный Vault-path → env. Чужие пути не угадываются. */
@Component
public class EnvSecretResolver implements SecretResolver {

    @Override
    public Optional<String> resolve(String vaultPath) {
        if (vaultPath == null || vaultPath.isBlank()) {
            return Optional.empty();
        }
        String direct = System.getenv(vaultPath);
        if (direct != null && !direct.isBlank()) {
            return Optional.of(direct.trim());
        }
        String envName = switch (vaultPath) {
            case "loadtest/s3/access-key" -> "S3_ACCESS_KEY";
            case "loadtest/s3/secret-key" -> "S3_SECRET_KEY";
            case "loadtest/gitlab/trigger-token" -> "GITLAB_TRIGGER_TOKEN";
            case "loadtest/gitlab/webhook-secret" -> "GITLAB_WEBHOOK_SECRET";
            case "loadtest/gitlab/upload-token" -> "GITLAB_UPLOAD_TOKEN";
            case "loadtest/gitlab/api-token" -> "GITLAB_API_TOKEN";
            case "loadtest/victoriametrics/bearer-token" -> "VICTORIAMETRICS_BEARER";
            case "loadtest/internal-token" -> "LOADTEST_INTERNAL_TOKEN";
            default -> null;
        };
        return envName == null ? Optional.empty() : optionalEnv(envName);
    }

    private static Optional<String> optionalEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        return Optional.of(value.trim());
    }
}
