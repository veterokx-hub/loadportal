package com.loadtest.constructor.web.dto;

import com.loadtest.constructor.model.UserRole;

public record UserDto(String username, UserRole role, boolean enabled, boolean ldapOnly) {
}
