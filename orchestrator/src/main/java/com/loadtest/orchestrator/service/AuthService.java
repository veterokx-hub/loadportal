package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.persistence.AuthSessionRepository;
import com.loadtest.orchestrator.persistence.UserRepository;
import com.loadtest.orchestrator.security.AuthContext;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Optional;

/**
 * Только проверка Bearer-сессий из общей БД (логин остаётся в constructor).
 */
@Service
public class AuthService {

    private final AuthSessionRepository sessionRepository;
    private final UserRepository userRepository;

    public AuthService(AuthSessionRepository sessionRepository, UserRepository userRepository) {
        this.sessionRepository = sessionRepository;
        this.userRepository = userRepository;
    }

    public Optional<AuthContext> resolve(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        return sessionRepository.findByTokenAndExpiresAtAfter(token, Instant.now())
                .flatMap(s -> userRepository.findByUsernameIgnoreCase(s.getUsername()))
                .filter(u -> u.isEnabled())
                .map(u -> new AuthContext(u.getUsername(), u.getRole(), u.isMustChangePassword()));
    }
}
