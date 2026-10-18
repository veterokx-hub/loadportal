package com.loadtest.constructor.secrets;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.loadtest.constructor.config.DiscoveryConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Чтение секретов из Vault KV v2. Недоступность Vault не фатальна — вызывающий код идёт в env. */
@Component
public class VaultSecretResolver implements SecretResolver {

    private static final Logger log = LoggerFactory.getLogger(VaultSecretResolver.class);
    private static final long UNKNOWN_RETRY_MS = 60_000L;
    /** lookup-self вернул 401/403: токен мёртв, дальше AppRole. */
    private static final TokenLease DEAD = new TokenLease("", false, 0, 0);

    private final DiscoveryConfig discoveryConfig;
    private final ObjectMapper objectMapper;
    private final RestClient restClient;
    /** client_token AppRole. secret_id может не истекать, сам токен — истекает или требует renew. */
    private volatile TokenLease lease;
    private final Set<String> missed = ConcurrentHashMap.newKeySet();

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
        String token = vaultToken();
        if (token.isEmpty()) {
            log.warn("Vault включён, но нет VAULT_TOKEN и AppRole");
            return Optional.empty();
        }
        Optional<String> found = lookup(address, kvMount, vaultPath, token);
        if (found == null && relogin(token)) {
            token = vaultToken();
            found = token.isEmpty() ? null : lookup(address, kvMount, vaultPath, token);
        }
        return found == null ? Optional.empty() : found;
    }

    /** null — Vault отверг токен или недоступен. */
    private Optional<String> lookup(String address, String kvMount, String vaultPath, String token) {
        String normalizedPath = vaultPath.startsWith("/") ? vaultPath.substring(1) : vaultPath;
        String fullDotted = normalizedPath.replace('/', '.');
        String[] parts = normalizedPath.split("/");
        List<String> tried = new ArrayList<>();
        for (int i = parts.length; i >= 1; i--) {
            String secretPath = String.join("/", java.util.Arrays.copyOf(parts, i));
            String remainder = String.join(".", java.util.Arrays.copyOfRange(parts, i, parts.length));
            Optional<String> found = readField(address, kvMount, secretPath, remainder, fullDotted, token, tried);
            if (found == null) {
                return null;
            }
            if (found.isPresent()) {
                return found;
            }
        }
        String shortDotted = fullDotted.startsWith("loadtest.") ? fullDotted.substring("loadtest.".length()) : fullDotted;
        for (String context : List.of("application", "loadtest-portal")) {
            Optional<String> found = readField(address, kvMount, context, shortDotted, fullDotted, token, tried);
            if (found == null) {
                return null;
            }
            if (found.isPresent()) {
                return found;
            }
        }
        if (missed.add(normalizedPath)) {
            log.warn("Vault секрет {} не найден в {}, смотрели {}", normalizedPath, kvMount, String.join(", ", tried));
        }
        return Optional.empty();
    }

    /** Пустой Optional — секрета нет. null — Vault недоступен, дальше не ходим. */
    private Optional<String> readField(
            String address,
            String kvMount,
            String secretPath,
            String remainder,
            String fullDotted,
            String token,
            List<String> tried) {
        if (tried.contains(secretPath)) {
            return Optional.empty();
        }
        tried.add(secretPath);
        String url = address.replaceAll("/$", "") + "/v1/" + kvMount.replaceAll("^/|/$", "")
                + "/data/" + secretPath;
        try {
            String body = restClient.get().uri(url).header("X-Vault-Token", token).retrieve().body(String.class);
            if (body == null || body.isBlank()) {
                return Optional.empty();
            }
            JsonNode data = objectMapper.readTree(body).path("data").path("data");
            String value = VaultFields.fromSecret(data, remainder, fullDotted);
            if (value == null) {
                return Optional.empty();
            }
            log.info("Vault {} поле {}", secretPath, remainder == null || remainder.isEmpty() ? "value" : remainder);
            return Optional.of(value);
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().value() == 404) {
                return Optional.empty();
            }
            log.warn("Vault {} -> HTTP {}: {}", secretPath, ex.getStatusCode().value(), vaultError(ex));
            return null;
        } catch (RestClientException | JacksonException ex) {
            log.warn("Vault {} недоступен: {}", secretPath, ex.getMessage());
            return null;
        }
    }

    /** Кэш client_token. До середины TTL — renew-self, после отказа — новый логин AppRole. */
    private String vaultToken() {
        long now = System.currentTimeMillis();
        TokenLease cached = lease;
        if (cached != null && now < cached.renewAtMillis()) {
            return cached.token();
        }
        synchronized (this) {
            now = System.currentTimeMillis();
            cached = lease;
            if (cached != null && now < cached.renewAtMillis()) {
                return cached.token();
            }
            if (cached != null && cached.renewable() && now < cached.hardExpiryMillis()) {
                TokenLease renewed = renew(cached.token());
                if (renewed != null) {
                    lease = renewed;
                    return renewed.token();
                }
                lease = null;
                cached = null;
            }
            String env = envToken();
            if (!env.isEmpty() && (cached == null || env.equals(cached.token()))) {
                TokenLease self = lookupSelf(env);
                if (self == DEAD) {
                    log.warn("Vault: VAULT_TOKEN отклонён, логин AppRole");
                } else if (self == null) {
                    lease = new TokenLease(env, false, now + UNKNOWN_RETRY_MS, Long.MAX_VALUE);
                    return env;
                } else if (now < self.renewAtMillis()) {
                    lease = self;
                    return self.token();
                } else if (self.renewable() && now < self.hardExpiryMillis()) {
                    TokenLease renewed = renew(env);
                    if (renewed != null) {
                        lease = renewed;
                        return renewed.token();
                    }
                } else {
                    lease = self;
                    return self.token();
                }
            }
            TokenLease logged = login();
            lease = logged;
            return logged == null ? "" : logged.token();
        }
    }

    /** Сбрасывает отклонённый client_token. Следующий vaultToken() продлит его или залогинится. */
    private boolean relogin(String usedToken) {
        synchronized (this) {
            TokenLease cached = lease;
            if (cached != null && cached.token().equals(usedToken)) {
                lease = null;
            }
        }
        String fresh = vaultToken();
        boolean ok = !fresh.isBlank() && !fresh.equals(usedToken);
        if (ok) {
            log.info("Vault: новый client_token после HTTP 403");
        }
        return ok;
    }

    private static String envToken() {
        String env = System.getenv("VAULT_TOKEN");
        return env == null ? "" : env.trim();
    }

    private TokenLease login() {
        DiscoveryConfig.Vault vault = discoveryConfig.getVault();
        String role = vault.getRoleId();
        String secret = vault.getSecretId();
        String address = vault.getAddress();
        if (role == null || role.isBlank() || secret == null || secret.isBlank()
                || address == null || address.isBlank()) {
            return null;
        }
        String url = address.replaceAll("/$", "") + "/v1/auth/approle/login";
        try {
            String body = restClient.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("role_id", role.trim(), "secret_id", secret.trim()))
                    .retrieve()
                    .body(String.class);
            TokenLease parsed = parseAuth(body, objectMapper);
            if (parsed == null) {
                log.warn("Vault AppRole не вернул client_token");
            }
            return parsed;
        } catch (RestClientException | JacksonException ex) {
            log.warn("Vault AppRole login failed: {}", ex.getMessage());
            return null;
        }
    }

    private TokenLease renew(String token) {
        String address = discoveryConfig.getVault().getAddress();
        if (address == null || address.isBlank()) {
            return null;
        }
        String url = address.replaceAll("/$", "") + "/v1/auth/token/renew-self";
        try {
            String body = restClient.post()
                    .uri(url)
                    .header("X-Vault-Token", token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of())
                    .retrieve()
                    .body(String.class);
            TokenLease parsed = parseAuth(body, objectMapper);
            if (parsed == null) {
                log.warn("Vault renew-self не вернул client_token");
            }
            return parsed;
        } catch (RestClientException | JacksonException ex) {
            log.warn("Vault renew-self failed: {}", ex.getMessage());
            return null;
        }
    }

    /** null — lookup не удался. {@link #DEAD} — токен отвергнут. */
    private TokenLease lookupSelf(String token) {
        String address = discoveryConfig.getVault().getAddress();
        if (address == null || address.isBlank()) {
            return null;
        }
        String url = address.replaceAll("/$", "") + "/v1/auth/token/lookup-self";
        try {
            String body = restClient.get().uri(url).header("X-Vault-Token", token).retrieve().body(String.class);
            return parseLookup(body, token, objectMapper);
        } catch (RestClientResponseException ex) {
            int status = ex.getStatusCode().value();
            if (status == 401 || status == 403) {
                return DEAD;
            }
            log.warn("Vault lookup-self -> HTTP {}", status);
            return null;
        } catch (RestClientException | JacksonException ex) {
            log.warn("Vault lookup-self недоступен: {}", ex.getMessage());
            return null;
        }
    }

    static TokenLease parseLookup(String body, String token, ObjectMapper mapper) throws JacksonException {
        if (body == null || body.isBlank()) {
            return null;
        }
        JsonNode data = mapper.readTree(body).path("data");
        long ttl = data.path("ttl").asLong(0);
        long now = System.currentTimeMillis();
        return new TokenLease(token, data.path("renewable").asBoolean(false), renewAt(now, ttl), hardExpiry(now, ttl));
    }

    static TokenLease parseAuth(String body, ObjectMapper mapper) throws JacksonException {
        if (body == null || body.isBlank()) {
            return null;
        }
        JsonNode auth = mapper.readTree(body).path("auth");
        String token = auth.path("client_token").asString("").trim();
        if (token.isEmpty()) {
            return null;
        }
        long now = System.currentTimeMillis();
        long leaseSeconds = auth.path("lease_duration").asLong(0);
        return new TokenLease(
                token,
                auth.path("renewable").asBoolean(false),
                renewAt(now, leaseSeconds),
                hardExpiry(now, leaseSeconds));
    }

    /** Середина lease, но не позже чем за 30 с до конца. lease 0 — токен без срока. */
    static long renewAt(long nowMillis, long leaseSeconds) {
        if (leaseSeconds <= 0) {
            return Long.MAX_VALUE;
        }
        long ttl = leaseSeconds * 1000L;
        long half = nowMillis + ttl / 2;
        long latest = nowMillis + Math.max(0, ttl - 30_000L);
        return Math.min(half, latest);
    }

    static long hardExpiry(long nowMillis, long leaseSeconds) {
        if (leaseSeconds <= 0) {
            return Long.MAX_VALUE;
        }
        return nowMillis + leaseSeconds * 1000L;
    }

    private static String vaultError(RestClientResponseException ex) {
        String body = ex.getResponseBodyAsString();
        if (body == null || body.isBlank()) {
            return "";
        }
        String flat = body.replaceAll("\\s+", " ").trim();
        return flat.length() > 180 ? flat.substring(0, 180) : flat;
    }

    record TokenLease(String token, boolean renewable, long renewAtMillis, long hardExpiryMillis) {
    }
}
