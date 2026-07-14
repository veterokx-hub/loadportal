package com.loadtest.constructor.web.dto;

public record LdapSettingsDto(
        boolean ldapEnabled,
        String ldapUrl,
        String ldapBaseDn,
        String ldapUserDnPattern,
        String ldapUserSearchBase,
        String ldapUserSearchFilter,
        String ldapBindDn,
        String ldapBindPassword
) {
}
