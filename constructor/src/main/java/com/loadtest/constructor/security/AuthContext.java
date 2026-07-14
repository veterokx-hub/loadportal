package com.loadtest.constructor.security;

import com.loadtest.constructor.model.UserRole;

public record AuthContext(String username, UserRole role, boolean mustChangePassword) {
    public boolean isAdmin() {
        return role == UserRole.ADMIN;
    }
}
