package com.loadtest.constructor.secrets;

import com.loadtest.constructor.config.DiscoveryConfig;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
@Primary
public class CompositeSecretResolver implements SecretResolver {

    private final DiscoveryConfig discoveryConfig;
    private final VaultSecretResolver vaultSecretResolver;
    private final EnvSecretResolver envSecretResolver;

    public CompositeSecretResolver(
            DiscoveryConfig discoveryConfig,
            VaultSecretResolver vaultSecretResolver,
            EnvSecretResolver envSecretResolver) {
        this.discoveryConfig = discoveryConfig;
        this.vaultSecretResolver = vaultSecretResolver;
        this.envSecretResolver = envSecretResolver;
    }

    @Override
    public Optional<String> resolve(String vaultPath) {
        if (discoveryConfig.getVault().isEnabled()) {
            Optional<String> fromVault = vaultSecretResolver.resolve(vaultPath);
            if (fromVault.isPresent()) {
                return fromVault;
            }
        }
        return envSecretResolver.resolve(vaultPath);
    }
}
