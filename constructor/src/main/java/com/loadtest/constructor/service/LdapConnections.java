package com.loadtest.constructor.service;

import com.loadtest.constructor.config.ConsulKv;
import com.loadtest.constructor.persistence.PortalSettingsEntity;
import com.loadtest.constructor.secrets.SecretResolver;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * AD: несекреты из Consul, иначе yaml/env, иначе {@code portal_settings}.
 * Пароль bind: Vault {@code loadtest/ad/bind-password}, иначе env, иначе БД.
 * Возвращает отдельный объект — его нельзя сохранять.
 */
@Component
public class LdapConnections {

    private final ConsulKv consul;
    private final SecretResolver secrets;
    private final Environment env;

    public LdapConnections(ConsulKv consul, SecretResolver secrets, Environment env) {
        this.consul = consul;
        this.secrets = secrets;
        this.env = env;
    }

    public PortalSettingsEntity effective(PortalSettingsEntity db) {
        PortalSettingsEntity source = db == null ? PortalSettingsEntity.defaults() : db;
        PortalSettingsEntity out = PortalSettingsEntity.defaults();
        out.setLdapEnabled(enabled(source));
        out.setLdapUrl(pick("ad/url", "loadtest.ad.url", source.getLdapUrl()));
        out.setLdapBaseDn(pick("ad/base-dn", "loadtest.ad.base-dn", source.getLdapBaseDn()));
        out.setLdapUserDnPattern(pick("ad/user-dn-pattern", "loadtest.ad.user-dn-pattern", source.getLdapUserDnPattern()));
        out.setLdapUserSearchBase(pick("ad/user-search-base", "loadtest.ad.user-search-base", source.getLdapUserSearchBase()));
        out.setLdapUserSearchFilter(pick("ad/user-search-filter", "loadtest.ad.user-search-filter", source.getLdapUserSearchFilter()));
        out.setLdapBindDn(pick("ad/bind-dn", "loadtest.ad.bind-dn", source.getLdapBindDn()));
        out.setLdapBindPassword(secrets.resolve("loadtest/ad/bind-password")
                .orElse(source.getLdapBindPassword() == null ? "" : source.getLdapBindPassword()));
        return out;
    }

    private boolean enabled(PortalSettingsEntity db) {
        Optional<String> fromConsul = consul.get("ad/enabled").filter(s -> !s.isBlank());
        if (fromConsul.isPresent()) {
            return truth(fromConsul.get());
        }
        String configured = env.getProperty("loadtest.ad.enabled", "");
        if (!configured.isBlank()) {
            return truth(configured);
        }
        return db.isLdapEnabled();
    }

    private String pick(String consulKey, String property, String fallback) {
        Optional<String> fromConsul = consul.get(consulKey).filter(s -> !s.isBlank());
        if (fromConsul.isPresent()) {
            return fromConsul.get().trim();
        }
        String configured = env.getProperty(property, "");
        if (!configured.isBlank()) {
            return configured.trim();
        }
        return fallback == null ? "" : fallback.trim();
    }

    private static boolean truth(String value) {
        String v = value.trim().toLowerCase();
        return v.equals("1") || v.equals("true") || v.equals("yes") || v.equals("on");
    }
}
