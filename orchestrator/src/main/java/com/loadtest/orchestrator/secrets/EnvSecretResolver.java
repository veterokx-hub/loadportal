package com.loadtest.orchestrator.secrets;

import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * Локальная разработка: секреты из env (GITLAB_TRIGGER_TOKEN, GITLAB_WEBHOOK_SECRET).
 */
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
        String lower = vaultPath.toLowerCase();
        if (lower.contains("trigger") || lower.contains("token")) {
            return optionalEnv("GITLAB_TRIGGER_TOKEN");
        }
        if (lower.contains("webhook") || lower.contains("secret")) {
            return optionalEnv("GITLAB_WEBHOOK_SECRET");
        }
        return Optional.empty();
    }

    private static Optional<String> optionalEnv(String name) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) {
            return Optional.empty();
        }
        return Optional.of(v.trim());
    }
}
