package com.loadtest.orchestrator.config;

import java.util.Optional;

/**
 * Подключение к PostgreSQL.
 * Адрес и пользователь: Consul KV, иначе env, иначе ConfigMap, иначе дефолт Spring.
 * Пароль уже свёрнут вызывающим: Vault, иначе env. Последний аргумент — дефолт для локального bootRun.
 */
record DbSettings(String url, String username, String password) {

    static DbSettings resolve(
            Optional<String> consulUrl,
            String envUrl,
            String configUrl,
            String springUrl,
            Optional<String> consulUsername,
            String envUsername,
            String configUsername,
            String springUsername,
            Optional<String> secretPassword,
            String springPassword) {
        return new DbSettings(
                pick(consulUrl, envUrl, configUrl, springUrl),
                pick(consulUsername, envUsername, configUsername, springUsername),
                pick(secretPassword, null, null, springPassword));
    }

    private static String pick(Optional<String> consul, String env, String config, String fallback) {
        if (consul != null && consul.filter(s -> !s.isBlank()).isPresent()) {
            return consul.get().trim();
        }
        if (env != null && !env.isBlank()) {
            return env.trim();
        }
        if (config != null && !config.isBlank()) {
            return config.trim();
        }
        return fallback == null ? "" : fallback.trim();
    }
}
