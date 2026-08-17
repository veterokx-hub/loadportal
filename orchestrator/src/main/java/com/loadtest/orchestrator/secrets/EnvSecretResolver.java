package com.loadtest.orchestrator.secrets;

import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * Локальная разработка / fallback: секреты из env.
 * {@code resolve(path)} сначала ищет env с именем {@code path}, затем известные GitLab-ключи.
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
        if (lower.contains("upload")) {
            return optionalEnv("GITLAB_UPLOAD_TOKEN");
        }
        if (lower.contains("webhook") || lower.contains("secret")) {
            return optionalEnv("GITLAB_WEBHOOK_SECRET");
        }
        if (lower.contains("trigger") || lower.contains("token")) {
            return optionalEnv("GITLAB_TRIGGER_TOKEN");
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
