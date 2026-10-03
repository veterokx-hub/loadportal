package com.loadtest.constructor.service;

import com.loadtest.constructor.model.UserRole;
import com.loadtest.constructor.persistence.UserEntity;
import com.loadtest.constructor.persistence.UserRepository;
import com.loadtest.constructor.web.dto.CreateUserRequest;
import com.loadtest.constructor.web.dto.UserDto;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final AuthService authService;

    public UserService(UserRepository userRepository, AuthService authService) {
        this.userRepository = userRepository;
        this.authService = authService;
    }

    public List<UserDto> list() {
        return userRepository.findAll().stream()
                .map(UserService::toDto)
                .toList();
    }

    @Transactional
    public UserDto create(CreateUserRequest req) {
        if (req.username() == null || req.username().isBlank()) {
            throw new IllegalArgumentException("Укажите логин");
        }
        String name = req.username().trim();
        if (userRepository.existsByUsernameIgnoreCase(name)) {
            throw new IllegalArgumentException("Пользователь уже существует: " + name);
        }
        if (!req.ldapOnly() && (req.password() == null || req.password().length() < 8)) {
            throw new IllegalArgumentException("Пароль минимум 8 символов");
        }
        UserRole role = req.role() != null ? req.role() : UserRole.USER;
        String hash = req.ldapOnly() ? null : authService.passwordEncoder().encode(req.password());
        UserEntity u = new UserEntity(name, hash, role, req.ldapOnly());
        userRepository.save(u);
        return toDto(u);
    }

    @Transactional
    public void setPassword(String username, String password) {
        UserEntity u = userRepository.findByUsernameIgnoreCase(username)
                .orElseThrow(() -> new IllegalArgumentException("Пользователь не найден"));
        if (u.isLdapOnly()) {
            throw new IllegalArgumentException("LDAP-пользователь — локальный пароль не задаётся");
        }
        if (password == null || password.length() < 8) {
            throw new IllegalArgumentException("Пароль минимум 8 символов");
        }
        u.setPasswordHash(authService.passwordEncoder().encode(password));
        u.setMustChangePassword(true);
        authService.revokeAllSessions(u.getUsername());
    }

    @Transactional
    public UserDto setRole(String username, UserRole role) {
        if (role == null) {
            throw new IllegalArgumentException("Укажите роль");
        }
        UserEntity u = userRepository.findByUsernameIgnoreCase(username)
                .orElseThrow(() -> new IllegalArgumentException("Пользователь не найден"));
        if ("admin".equalsIgnoreCase(u.getUsername()) && role != UserRole.ADMIN) {
            throw new IllegalArgumentException("Нельзя снять роль ADMIN у встроенного admin");
        }
        if (u.getRole() == UserRole.ADMIN && role != UserRole.ADMIN
                && userRepository.countByRole(UserRole.ADMIN) <= 1) {
            throw new IllegalArgumentException("Нельзя снять роль у последнего администратора");
        }
        u.setRole(role);
        return toDto(u);
    }

    @Transactional
    public void delete(String username) {
        if ("admin".equalsIgnoreCase(username)) {
            throw new IllegalArgumentException("Нельзя удалить встроенного admin");
        }
        userRepository.findByUsernameIgnoreCase(username).ifPresent(u -> {
            authService.revokeAllSessions(u.getUsername());
            userRepository.delete(u);
        });
    }

    private static UserDto toDto(UserEntity u) {
        return new UserDto(u.getUsername(), u.getRole(), u.isEnabled(), u.isLdapOnly());
    }
}
