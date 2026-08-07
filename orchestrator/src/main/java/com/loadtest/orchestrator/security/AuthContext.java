package com.loadtest.orchestrator.security;

import com.loadtest.orchestrator.model.UserRole;

public record AuthContext(String username, UserRole role, boolean mustChangePassword) {
    public boolean isAdmin() {
        return role == UserRole.ADMIN;
    }
}
