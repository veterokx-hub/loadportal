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
 * Аутентификация через корпоративный LDAP / Active Directory (JNDI).
 * Поддерживает userDnPattern или поиск через service bind.
 */
@Service
public class LdapAuthService {

    private static final Logger log = LoggerFactory.getLogger(LdapAuthService.class);

    public boolean authenticate(String username, String password, PortalSettingsEntity settings) {
        if (!settings.isLdapEnabled() || username == null || username.isBlank()) {
            return false;
        }
        if (password == null) {
            return false;
        }
        String url = settings.getLdapUrl();
        if (url == null || url.isBlank()) {
            return false;
        }
        try {
            String userDn = resolveUserDn(username, settings);
            if (userDn == null || userDn.isBlank()) {
                return false;
            }
            Hashtable<String, String> env = baseEnv(url);
            env.put(Context.SECURITY_PRINCIPAL, userDn);
            env.put(Context.SECURITY_CREDENTIALS, password);
            DirContext ctx = new InitialDirContext(env);
            ctx.close();
            return true;
        } catch (Exception e) {
            log.debug("LDAP auth failed for {}: {}", username, e.getMessage());
            return false;
        }
    }

    private String resolveUserDn(String username, PortalSettingsEntity s) throws Exception {
        String pattern = s.getLdapUserDnPattern();
        if (pattern != null && !pattern.isBlank()) {
            return pattern.replace("{0}", username);
        }
        String searchBase = s.getLdapUserSearchBase();
        String filter = s.getLdapUserSearchFilter();
        if (searchBase == null || searchBase.isBlank() || filter == null || filter.isBlank()) {
            return null;
        }
        String bindDn = s.getLdapBindDn();
        String bindPw = s.getLdapBindPassword();
        if (bindDn == null || bindDn.isBlank()) {
            return null;
        }
        Hashtable<String, String> env = baseEnv(s.getLdapUrl());
        env.put(Context.SECURITY_PRINCIPAL, bindDn);
        env.put(Context.SECURITY_CREDENTIALS, bindPw == null ? "" : bindPw);
        DirContext ctx = new InitialDirContext(env);
        try {
            SearchControls sc = new SearchControls();
            sc.setSearchScope(SearchControls.SUBTREE_SCOPE);
            sc.setReturningAttributes(new String[]{"dn"});
            NamingEnumeration<SearchResult> results = ctx.search(searchBase, filter.replace("{0}", username), sc);
            if (results.hasMore()) {
                SearchResult sr = results.next();
                return sr.getNameInNamespace();
            }
            return null;
        } finally {
            ctx.close();
        }
    }

    private static Hashtable<String, String> baseEnv(String url) {
        Hashtable<String, String> env = new Hashtable<>();
        env.put(Context.INITIAL_CONTEXT_FACTORY, "com.sun.jndi.ldap.LdapCtxFactory");
        env.put(Context.PROVIDER_URL, url);
        env.put(Context.SECURITY_AUTHENTICATION, "simple");
        return env;
    }
}
