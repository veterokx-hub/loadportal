package com.loadtest.orchestrator.secrets;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.loadtest.orchestrator.config.DiscoveryConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.Map;
import java.util.Optional;

/** Чтение секретов из Vault KV v2. Недоступность Vault не фатальна — вызывающий код идёт в env. */
@Component
public class VaultSecretResolver implements SecretResolver {

    private static final Logger log = LoggerFactory.getLogger(VaultSecretResolver.class);

    private final DiscoveryConfig discoveryConfig;
    private final ObjectMapper objectMapper;
    private final RestClient restClient;

    /** RestClient общий на приложение (см. HttpClientConfig). */
    public VaultSecretResolver(
            DiscoveryConfig discoveryConfig,
            ObjectMapper objectMapper,
            @Qualifier("sharedRestClient") RestClient restClient) {
        this.discoveryConfig = discoveryConfig;
        this.objectMapper = objectMapper;
        this.restClient = restClient;
    }

    @Override
    public Optional<String> resolve(String vaultPath) {
        if (!discoveryConfig.getVault().isEnabled()) {
            return Optional.empty();
        }
        if (vaultPath == null || vaultPath.isBlank()) {
            return Optional.empty();
        }
        String address = discoveryConfig.getVault().getAddress();
        if (address == null || address.isBlank()) {
            log.warn("Vault enabled but address is empty");
            return Optional.empty();
        }
        String kvMount = discoveryConfig.getVault().getKvPath();
        if (kvMount == null || kvMount.isBlank()) {
            kvMount = "secret";
        }
        String normalizedPath = vaultPath.startsWith("/") ? vaultPath.substring(1) : vaultPath;
        String url = address.replaceAll("/$", "") + "/v1/" + kvMount.replaceAll("^/|/$", "")
                + "/data/" + normalizedPath;
        try {
            var request = restClient.get().uri(url);
            String token = System.getenv("VAULT_TOKEN");
            if (token != null && !token.isBlank()) {
                request = request.header("X-Vault-Token", token.trim());
            }
            String body = request.retrieve().body(String.class);
            if (body == null || body.isBlank()) {
                return Optional.empty();
            }
            JsonNode root = objectMapper.readTree(body);
            JsonNode data = root.path("data").path("data");
            if (data.isMissingNode() || !data.isObject()) {
                return Optional.empty();
            }
            JsonNode named = data.get("value");
            if (named != null && !named.asString("").isBlank()) {
                return Optional.of(named.asString().trim());
            }
            var props = data.properties();
            if (props.isEmpty()) {
                return Optional.empty();
            }
            Map.Entry<String, JsonNode> first = props.iterator().next();
            String value = first.getValue().asString("");
            return value.isBlank() ? Optional.empty() : Optional.of(value.trim());
        } catch (RestClientException | JacksonException ex) {
            log.warn("Vault resolve failed for path {}: {}", vaultPath, ex.getMessage());
            return Optional.empty();
        }
    }
}
