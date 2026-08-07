package com.loadtest.orchestrator.persistence;

import com.loadtest.orchestrator.model.UserRole;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "portal_users")
public class UserEntity {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, unique = true, length = 128)
    private String username;

    /** BCrypt-хэш; null для чисто LDAP-пользователей. */
    @Column(length = 255)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private UserRole role = UserRole.USER;

    @Column(nullable = false)
    private boolean enabled = true;

    /** true — пароль проверяется только через LDAP (локальный пароль не используется). */
    @Column(nullable = false)
    private boolean ldapOnly = false;

    /** true — при следующем входе требуется сменить локальный пароль. */
    @Column(nullable = false)
    private boolean mustChangePassword = false;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    protected UserEntity() {
    }

    public UserEntity(String username, String passwordHash, UserRole role, boolean ldapOnly) {
        this.username = username;
        this.passwordHash = passwordHash;
        this.role = role;
        this.ldapOnly = ldapOnly;
    }

    public UUID getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public UserRole getRole() {
        return role;
    }

    public void setRole(UserRole role) {
        this.role = role;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean isLdapOnly() {
        return ldapOnly;
    }

    public void setLdapOnly(boolean ldapOnly) {
        this.ldapOnly = ldapOnly;
    }

    public boolean isMustChangePassword() {
        return mustChangePassword;
    }

    public void setMustChangePassword(boolean mustChangePassword) {
        this.mustChangePassword = mustChangePassword;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
