package com.loadtest.constructor.config;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/** Чтение Consul KV. Один ключ — {@code ?raw}. Дерево префикса — recurse, кеш на минуту. */
@Component
public class ConsulKv {

    private static final Logger log = LoggerFactory.getLogger(ConsulKv.class);
    private static final long TREE_TTL_NANOS = TimeUnit.SECONDS.toNanos(60);

    private final DiscoveryConfig discovery;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final Set<String> missed = ConcurrentHashMap.newKeySet();
    private volatile Map<String, String> tree;
    private volatile long treeLoadedAt;

    public ConsulKv(
            DiscoveryConfig discovery,
            @Qualifier("probeRestClient") RestClient restClient,
            ObjectMapper objectMapper) {
        this.discovery = discovery;
        this.restClient = restClient;
        this.objectMapper = objectMapper;
    }

    /**
     * Ключ относительно префикса, например {@code ad/enabled}. Если отдельного ключа нет —
     * то же свойство в дереве префикса: {@code ad.enabled} или {@code loadtest.ad.enabled}
     * в YAML-документе либо под {@code application/}.
     */
    public Optional<String> get(String key) {
        DiscoveryConfig.Consul consul = discovery.getConsul();
        if (!consul.isEnabled() || key == null || key.isBlank()) {
            return Optional.empty();
        }
        Optional<String> exact = exact(consul, key);
        if (exact.isPresent()) {
            return exact;
        }
        String dotted = key.replace('/', '.');
        Map<String, String> entries = tree();
        Optional<String> found = ConsulDocuments.property(entries, dotted);
        if (found.isEmpty() && !dotted.startsWith("loadtest.")) {
            found = ConsulDocuments.property(entries, "loadtest." + dotted);
        }
        if (found.isEmpty()) {
            missOnce(key);
        }
        return found;
    }

    /** Свойство вида {@code loadtest.postgres.url}: дерево префикса, затем точный ключ. */
    public Optional<String> property(String dotted) {
        if (dotted == null || dotted.isBlank()) {
            return Optional.empty();
        }
        DiscoveryConfig.Consul consul = discovery.getConsul();
        if (!consul.isEnabled()) {
            return Optional.empty();
        }
        Optional<String> found = ConsulDocuments.property(tree(), dotted);
        if (found.isPresent()) {
            return found;
        }
        Optional<String> direct = exact(consul, dotted.replace('.', '/'));
        if (direct.isEmpty()) {
            missOnce(dotted);
        }
        return direct;
    }

    private Optional<String> exact(DiscoveryConfig.Consul consul, String key) {
        String body = raw(consul, prefix(consul) + key);
        if (body == null || body.isBlank()) {
            return Optional.empty();
        }
        return Optional.of(body.trim());
    }

    private void missOnce(String key) {
        if (missed.add(key)) {
            log.warn("Consul: {} нет в префиксе {}", key, prefix(discovery.getConsul()));
        }
    }

    private Map<String, String> tree() {
        long now = System.nanoTime();
        Map<String, String> cached = tree;
        if (cached != null && now - treeLoadedAt < TREE_TTL_NANOS) {
            return cached;
        }
        synchronized (this) {
            if (tree == null || now - treeLoadedAt >= TREE_TTL_NANOS) {
                Map<String, String> loaded = loadTree(tree == null);
                if (loaded != null) {
                    tree = loaded;
                } else if (tree == null) {
                    tree = Map.of();
                }
                treeLoadedAt = System.nanoTime();
            }
            return tree;
        }
    }

    /** null — Consul не ответил, вызывающий оставляет прежнее дерево. */
    private Map<String, String> loadTree(boolean first) {
        DiscoveryConfig.Consul consul = discovery.getConsul();
        String kvPrefix = prefix(consul);
        String folder = kvPrefix.replaceAll("/+$", "");
        String url = "http://" + host(consul) + ":" + port(consul) + "/v1/kv/" + folder + "/?recurse";
        try {
            var request = restClient.get().uri(url);
            String token = aclToken(consul);
            if (!token.isEmpty()) {
                request = request.header("X-Consul-Token", token);
            }
            String body = request.retrieve().body(String.class);
            Map<String, String> loaded = decodeTree(body, kvPrefix);
            if (first) {
                log.info("Consul KV {} -> ключи {}", url, loaded.keySet());
            }
            return loaded;
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().value() == 404) {
                if (first) {
                    log.warn("Consul KV {} -> 404, в префиксе нет ключей", url);
                }
                return Map.of();
            }
            log.warn("Consul KV {} -> HTTP {}", url, ex.getStatusCode().value());
            return null;
        } catch (RuntimeException ex) {
            log.warn("Consul KV {} недоступен: {}", url, ex.getMessage());
            return null;
        }
    }

    private Map<String, String> decodeTree(String body, String kvPrefix) {
        if (body == null || body.isBlank()) {
            return Map.of();
        }
        JsonNode root;
        try {
            root = objectMapper.readTree(body);
        } catch (JacksonException ex) {
            log.warn("Consul KV не JSON: {}", ex.getMessage());
            return Map.of();
        }
        if (!root.isArray()) {
            return Map.of();
        }
        Map<String, String> loaded = new LinkedHashMap<>();
        for (JsonNode item : root) {
            String relative = relative(item.path("Key").asString(""), kvPrefix);
            if (relative == null) {
                continue;
            }
            JsonNode raw = item.get("Value");
            if (raw == null || raw.isNull() || raw.asString("").isBlank()) {
                continue;
            }
            try {
                byte[] decoded = Base64.getDecoder().decode(raw.asString(""));
                String value = new String(decoded, StandardCharsets.UTF_8).trim();
                if (!value.isEmpty()) {
                    loaded.put(relative, value);
                }
            } catch (IllegalArgumentException ex) {
                log.warn("Consul KV {} не base64", item.path("Key").asString(""));
            }
        }
        return loaded;
    }

    private String raw(DiscoveryConfig.Consul consul, String fullKey) {
        String url = "http://" + host(consul) + ":" + port(consul) + "/v1/kv/" + fullKey + "?raw";
        try {
            var request = restClient.get().uri(url);
            String token = aclToken(consul);
            if (!token.isEmpty()) {
                request = request.header("X-Consul-Token", token);
            }
            return request.retrieve().body(String.class);
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().value() != 404) {
                log.warn("Consul KV {} -> HTTP {}", fullKey, ex.getStatusCode().value());
            }
            return null;
        } catch (RuntimeException ex) {
            log.warn("Consul KV {} недоступен: {}", fullKey, ex.getMessage());
            return null;
        }
    }

    static String relative(String fullKey, String kvPrefix) {
        if (fullKey == null || fullKey.isBlank()) {
            return null;
        }
        String key = fullKey.startsWith("/") ? fullKey.substring(1) : fullKey;
        String base = kvPrefix == null ? "" : kvPrefix.replaceAll("^/+", "").replaceAll("/+$", "");
        if (base.isEmpty()) {
            return key;
        }
        if (key.equals(base)) {
            return "";
        }
        String head = base + "/";
        if (!key.startsWith(head)) {
            return null;
        }
        return key.substring(head.length());
    }

    private static String host(DiscoveryConfig.Consul consul) {
        return consul.getHost() == null || consul.getHost().isBlank() ? "localhost" : consul.getHost().trim();
    }

    private static int port(DiscoveryConfig.Consul consul) {
        return consul.getPort() > 0 ? consul.getPort() : 8500;
    }

    private static String prefix(DiscoveryConfig.Consul consul) {
        String value = consul.getKvPrefix() == null || consul.getKvPrefix().isBlank() ? "loadtest/" : consul.getKvPrefix();
        return value.endsWith("/") ? value : value + "/";
    }

    /** Сначала env, затем acl-token из ConfigMap. */
    private static String aclToken(DiscoveryConfig.Consul consul) {
        String env = System.getenv("CONSUL_HTTP_TOKEN");
        if (env != null && !env.isBlank()) {
            return env.trim();
        }
        String configured = consul.getAclToken();
        if (configured == null || configured.isBlank()) {
            return "";
        }
        return configured.trim();
    }
}
