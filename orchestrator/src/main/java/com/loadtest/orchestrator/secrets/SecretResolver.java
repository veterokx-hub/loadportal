package com.loadtest.orchestrator.secrets;

import java.util.Optional;

public interface SecretResolver {

    Optional<String> resolve(String vaultPath);
}
