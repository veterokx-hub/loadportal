package com.loadtest.constructor.service;

import com.loadtest.constructor.model.UserRole;
import com.loadtest.constructor.persistence.*;
import com.loadtest.constructor.security.AuthContext;
import com.loadtest.constructor.web.dto.LoginResponse;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;

@Service
public class AuthService {

    private static final int SESSION_HOURS = 24;

    private final UserRepository userRepository;
    private final AuthSessionRepository sessionRepository;
    private final PortalSettingsRepository settingsRepository;
    private final LdapAuthService ldapAuthService;
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    public AuthService(UserRepository userRepository,
                       AuthSessionRepository sessionRepository,
                       PortalSettingsRepository settingsRepository,
                       LdapAuthService ldapAuthService) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.settingsRepository = settingsRepository;
        this.ldapAuthService = ldapAuthService;
    }

    @Transactional
    public LoginResponse login(String username, String password) {
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("Укажите логин");
        }
        String user = username.trim();
        PortalSettingsEntity ldap = settingsRepository.findById(1L).orElse(PortalSettingsEntity.defaults());
        boolean ldapOk = ldap.isLdapEnabled() && ldapAuthService.authenticate(user, password, ldap);

        Optional<UserEntity> local = userRepository.findByUsernameIgnoreCase(user);
        if (local.isPresent()) {
            UserEntity u = local.get();
            if (!u.isEnabled()) {
                throw new IllegalArgumentException("Пользователь отключён");
            }
            if (u.isLdapOnly()) {
                if (!ldapOk) {
                    throw new IllegalArgumentException("Неверный логин или пароль");
                }
            } else if (passwordEncoder.matches(password, u.getPasswordHash())) {
                return createSession(u);
            } else if (!ldapOk) {
                throw new IllegalArgumentException("Неверный логин или пароль");
            }
            // LDAP успешен для локальной учётки — вход по доменному паролю
            return createSession(u);
        }

        if (ldapOk) {
            UserEntity created = new UserEntity(user, null, UserRole.USER, true);
            userRepository.save(created);
            return createSession(created);
        }

        throw new IllegalArgumentException("Неверный логин или пароль");
    }

    @Transactional
    public void changeOwnPassword(String username, String currentPassword, String newPassword) {
        UserEntity u = userRepository.findByUsernameIgnoreCase(username)
                .orElseThrow(() -> new IllegalArgumentException("Пользователь не найден"));
        if (u.isLdapOnly()) {
            throw new IllegalArgumentException("LDAP-пользователь не может задать локальный пароль");
        }
        if (newPassword == null || newPassword.length() < 8) {
            throw new IllegalArgumentException("Новый пароль — минимум 8 символов");
        }
        if (!passwordEncoder.matches(currentPassword, u.getPasswordHash())) {
            throw new IllegalArgumentException("Текущий пароль неверен");
        }
        if (passwordEncoder.matches(newPassword, u.getPasswordHash())) {
            throw new IllegalArgumentException("Новый пароль должен отличаться от текущего");
        }
        u.setPasswordHash(passwordEncoder.encode(newPassword));
        u.setMustChangePassword(false);
        userRepository.save(u);
    }

    @Transactional
    public void logout(String token) {
        if (token == null || token.isBlank()) return;
        sessionRepository.findByTokenAndExpiresAtAfter(token, Instant.now())
                .ifPresent(sessionRepository::delete);
    }

    public Optional<AuthContext> resolve(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        return sessionRepository.findByTokenAndExpiresAtAfter(token, Instant.now())
                .flatMap(s -> userRepository.findByUsernameIgnoreCase(s.getUsername()))
                .filter(UserEntity::isEnabled)
                .map(u -> new AuthContext(u.getUsername(), u.getRole(), u.isMustChangePassword()));
    }

    public PasswordEncoder passwordEncoder() {
        return passwordEncoder;
    }

    private LoginResponse createSession(UserEntity user) {
        String token = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        sessionRepository.save(new AuthSessionEntity(token, user.getUsername(), Instant.now().plus(SESSION_HOURS, ChronoUnit.HOURS)));
        return new LoginResponse(token, user.getUsername(), user.getRole(), user.isMustChangePassword());
    }
}
