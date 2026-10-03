package com.loadtest.constructor.service;

import com.loadtest.constructor.metrics.PortalMetrics;
import com.loadtest.constructor.model.UserRole;
import com.loadtest.constructor.persistence.*;
import com.loadtest.constructor.security.AuthContext;
import com.loadtest.constructor.web.dto.LoginResponse;
import com.loadtest.constructor.web.dto.SessionDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private static final int SESSION_HOURS = 3;

    private final UserRepository userRepository;
    private final AuthSessionRepository sessionRepository;
    private final PortalSettingsRepository settingsRepository;
    private final LdapAuthService ldapAuthService;
    private final PortalMetrics metrics;
    private final AuditService auditService;
    private final LdapConnections ldapConnections;
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    public AuthService(UserRepository userRepository,
                       AuthSessionRepository sessionRepository,
                       PortalSettingsRepository settingsRepository,
                       LdapAuthService ldapAuthService,
                       PortalMetrics metrics,
                       AuditService auditService,
                       LdapConnections ldapConnections) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.settingsRepository = settingsRepository;
        this.ldapAuthService = ldapAuthService;
        this.metrics = metrics;
        this.auditService = auditService;
        this.ldapConnections = ldapConnections;
    }

    @Transactional
    public LoginResponse login(String username, String password) {
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("Укажите логин");
        }
        String user = username.trim();
        PortalSettingsEntity stored = settingsRepository.findById(1L).orElse(PortalSettingsEntity.defaults());
        PortalSettingsEntity ldap = ldapConnections.effective(stored);
        boolean ldapOk = ldap.isLdapEnabled() && ldapAuthService.authenticate(user, password, ldap);

        Optional<UserEntity> local = userRepository.findByUsernameIgnoreCase(user);
        if (local.isPresent()) {
            UserEntity u = local.get();
            if (!u.isEnabled()) {
                metrics.recordLogin("local", false);
                throw new IllegalArgumentException("Пользователь отключён");
            }
            if (u.isLdapOnly()) {
                if (!ldapOk) {
                    metrics.recordLogin("ldap", false);
                    reject(user, ldap, false, true);
                }
                return succeed("ldap", u);
            }
            if (passwordEncoder.matches(password, u.getPasswordHash())) {
                return succeed("local", u);
            }
            if (!ldapOk) {
                metrics.recordLogin("local", false);
                reject(user, ldap, false, true);
            }
            return succeed("ldap", u);
        }

        if (ldapOk) {
            UserEntity created = new UserEntity(user, null, UserRole.USER, true);
            userRepository.save(created);
            return succeed("ldap", created);
        }

        metrics.recordLogin("unknown", false);
        reject(user, ldap, false, false);
        throw new IllegalArgumentException("Неверный логин или пароль");
    }

    private void reject(String user, PortalSettingsEntity ldap, boolean ldapOk, boolean localPresent) {
        log.warn(
                "Login rejected user={} ldapEnabled={} ldapOk={} localUser={}",
                user,
                ldap.isLdapEnabled(),
                ldapOk,
                localPresent);
        throw new IllegalArgumentException("Неверный логин или пароль");
    }

    private LoginResponse succeed(String method, UserEntity user) {
        metrics.recordLogin(method, true);
        auditService.record(user.getUsername(), AuditService.LOGIN, method);
        return createSession(user);
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
        revokeAllSessions(u.getUsername());
    }

    @Transactional
    public void logout(String token) {
        if (token == null || token.isBlank()) {
            return;
        }
        sessionRepository.findByTokenAndExpiresAtAfter(token, Instant.now())
                .ifPresent(s -> revokeAllSessions(s.getUsername()));
    }

    @Transactional
    public int revokeAllSessions(String username) {
        if (username == null || username.isBlank()) {
            return 0;
        }
        return sessionRepository.deleteByUsernameIgnoreCase(username.trim());
    }

    public List<SessionDto> listSessions(String username, String currentToken) {
        return sessionRepository
                .findByUsernameIgnoreCaseAndExpiresAtAfterOrderByCreatedAtDesc(username, Instant.now())
                .stream()
                .map(s -> new SessionDto(
                        s.getId(),
                        s.getCreatedAt(),
                        s.getExpiresAt(),
                        currentToken != null && currentToken.equals(s.getToken())))
                .toList();
    }

    @Transactional
    public void revokeSession(String username, UUID id) {
        AuthSessionEntity session = sessionRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Сессия не найдена"));
        if (!session.getUsername().equalsIgnoreCase(username)) {
            throw new IllegalArgumentException("Нет доступа к этой сессии");
        }
        sessionRepository.delete(session);
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
