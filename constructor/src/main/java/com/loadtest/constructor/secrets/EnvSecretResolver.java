package com.loadtest.constructor.secrets;

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
            case "loadtest/ad/bind-password" -> "LDAP_BIND_PASSWORD";
            case "loadtest/gitlab/trigger-token" -> "GITLAB_TRIGGER_TOKEN";
            case "loadtest/gitlab/webhook-secret" -> "GITLAB_WEBHOOK_SECRET";
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
