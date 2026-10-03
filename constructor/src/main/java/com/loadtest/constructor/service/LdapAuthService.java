package com.loadtest.constructor.service;

import com.loadtest.constructor.persistence.PortalSettingsEntity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.naming.Context;
import javax.naming.NamingEnumeration;
import javax.naming.directory.DirContext;
import javax.naming.directory.InitialDirContext;
import javax.naming.directory.SearchControls;
import javax.naming.directory.SearchResult;
import java.util.Hashtable;

/**
 * LDAP / AD. Если заданы search base + filter + bind — ищем пользователя (sAMAccountName).
 * User DN pattern используется только когда search не настроен.
 */
@Service
public class LdapAuthService {

    private static final Logger log = LoggerFactory.getLogger(LdapAuthService.class);

    public boolean authenticate(String username, String password, PortalSettingsEntity settings) {
        if (!settings.isLdapEnabled() || username == null || username.isBlank()) {
            return false;
        }
        if (password == null || password.isBlank()) {
            log.warn("LDAP skipped: empty password");
            return false;
        }
        String url = settings.getLdapUrl();
        if (url == null || url.isBlank()) {
            log.warn("LDAP skipped: empty URL");
            return false;
        }
        try {
            String userDn = resolveUserDn(username.trim(), settings);
            if (userDn == null || userDn.isBlank()) {
                log.warn("LDAP: пользователь '{}' не найден (проверьте search base/filter и bind)", username);
                return false;
            }
            Hashtable<String, String> env = baseEnv(url);
            env.put(Context.SECURITY_PRINCIPAL, userDn);
            env.put(Context.SECURITY_CREDENTIALS, password);
            DirContext ctx = new InitialDirContext(env);
            ctx.close();
            return true;
        } catch (Exception e) {
            log.warn("LDAP auth failed for {}: {}", username, e.toString());
            return false;
        }
    }

    private String resolveUserDn(String username, PortalSettingsEntity s) throws Exception {
        if (searchConfigured(s)) {
            return searchUserDn(username, s);
        }
        String pattern = s.getLdapUserDnPattern();
        if (pattern != null && !pattern.isBlank()) {
            return pattern.replace("{0}", username);
        }
        log.warn("LDAP: не задан ни search (base+filter+bind), ни user DN pattern");
        return null;
    }

    private static boolean searchConfigured(PortalSettingsEntity s) {
        return hasText(s.getLdapUserSearchBase())
                && hasText(s.getLdapUserSearchFilter())
                && hasText(s.getLdapBindDn());
    }

    private String searchUserDn(String username, PortalSettingsEntity s) throws Exception {
        Hashtable<String, String> env = baseEnv(s.getLdapUrl());
        env.put(Context.SECURITY_PRINCIPAL, s.getLdapBindDn().trim());
        env.put(Context.SECURITY_CREDENTIALS, s.getLdapBindPassword() == null ? "" : s.getLdapBindPassword());
        DirContext ctx = new InitialDirContext(env);
        try {
            SearchControls sc = new SearchControls();
            sc.setSearchScope(SearchControls.SUBTREE_SCOPE);
            sc.setReturningAttributes(new String[0]);
            sc.setCountLimit(1);
            String filter = s.getLdapUserSearchFilter().replace("{0}", escapeFilter(username));
            NamingEnumeration<SearchResult> results = ctx.search(s.getLdapUserSearchBase().trim(), filter, sc);
            if (results.hasMore()) {
                return results.next().getNameInNamespace();
            }
            return null;
        } finally {
            ctx.close();
        }
    }

    private static Hashtable<String, String> baseEnv(String url) {
        Hashtable<String, String> env = new Hashtable<>();
        env.put(Context.INITIAL_CONTEXT_FACTORY, "com.sun.jndi.ldap.LdapCtxFactory");
        env.put(Context.PROVIDER_URL, url.trim());
        env.put(Context.SECURITY_AUTHENTICATION, "simple");
        env.put(Context.REFERRAL, "ignore");
        env.put("com.sun.jndi.ldap.connect.timeout", "5000");
        env.put("com.sun.jndi.ldap.read.timeout", "10000");
        return env;
    }

    private static boolean hasText(String v) {
        return v != null && !v.isBlank();
    }

    /** RFC 4515: *, (, ), \\, NUL в значении фильтра. */
    static String escapeFilter(String value) {
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '\\' -> out.append("\\5c");
                case '*' -> out.append("\\2a");
                case '(' -> out.append("\\28");
                case ')' -> out.append("\\29");
                case '\0' -> out.append("\\00");
                default -> out.append(c);
            }
        }
        return out.toString();
    }
}
