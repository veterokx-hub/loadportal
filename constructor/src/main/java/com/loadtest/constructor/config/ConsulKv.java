package com.loadtest.constructor.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.util.Optional;

/** Чтение одного ключа Consul KV (`?raw`). Выключенный Consul или 404 — пусто, не ошибка. */
@Component
public class ConsulKv {

    private static final Logger log = LoggerFactory.getLogger(ConsulKv.class);

    private final DiscoveryConfig discovery;
    private final RestClient restClient;

    public ConsulKv(DiscoveryConfig discovery, @Qualifier("probeRestClient") RestClient restClient) {
        this.discovery = discovery;
        this.restClient = restClient;
    }

    public Optional<String> get(String key) {
        DiscoveryConfig.Consul consul = discovery.getConsul();
        if (!consul.isEnabled() || key == null || key.isBlank()) {
            return Optional.empty();
        }
        String host = consul.getHost() == null || consul.getHost().isBlank() ? "localhost" : consul.getHost().trim();
        int port = consul.getPort() > 0 ? consul.getPort() : 8500;
        String prefix = consul.getKvPrefix() == null || consul.getKvPrefix().isBlank() ? "loadtest/" : consul.getKvPrefix();
        if (!prefix.endsWith("/")) {
            prefix = prefix + "/";
        }
        String url = "http://" + host + ":" + port + "/v1/kv/" + prefix + key + "?raw";
        try {
            var request = restClient.get().uri(url);
            String token = System.getenv("CONSUL_HTTP_TOKEN");
            if (token != null && !token.isBlank()) {
                request = request.header("X-Consul-Token", token.trim());
            }
            String body = request.retrieve().body(String.class);
            if (body == null || body.isBlank()) {
                return Optional.empty();
            }
            return Optional.of(body.trim());
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().value() != 404) {
                log.warn("Consul KV {} -> HTTP {}", key, ex.getStatusCode().value());
            }
            return Optional.empty();
        } catch (RuntimeException ex) {
            log.warn("Consul KV {} недоступен: {}", key, ex.getMessage());
            return Optional.empty();
        }
    }
}
