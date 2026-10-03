package com.loadtest.constructor.config;

import com.loadtest.constructor.model.UserRole;
import com.loadtest.constructor.persistence.PortalSettingsEntity;
import com.loadtest.constructor.persistence.PortalSettingsRepository;
import com.loadtest.constructor.persistence.UserEntity;
import com.loadtest.constructor.persistence.UserRepository;
import com.loadtest.constructor.service.AuthService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.security.SecureRandom;

@Configuration
public class DataInitializer {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    @Bean
    CommandLineRunner seedUsers(
            UserRepository users,
            PortalSettingsRepository settings,
            AuthService authService,
            @Value("${loadtest.bootstrap.admin-username:admin}") String bootstrapUsername,
            @Value("${loadtest.bootstrap.admin-password:admin}") String bootstrapPassword) {
        return args -> {
            if (settings.findById(1L).isEmpty()) {
                settings.save(PortalSettingsEntity.defaults());
                log.info("Инициализированы настройки портала (LDAP)");
            }
            String adminName = bootstrapUsername == null || bootstrapUsername.isBlank()
                    ? "admin" : bootstrapUsername.trim();
            if (users.findByUsernameIgnoreCase(adminName).isEmpty()) {
                String pwd = bootstrapPassword;
                if (pwd == null || pwd.isBlank() || "admin".equals(pwd)) {
                    pwd = randomPassword();
                    log.warn("Сгенерирован пароль bootstrap-админа для '{}': {}", adminName, pwd);
                }
                String hash = authService.passwordEncoder().encode(pwd);
                UserEntity admin = new UserEntity(adminName, hash, UserRole.ADMIN, false);
                admin.setMustChangePassword(true);
                users.save(admin);
                log.info("Создан пользователь {} (требуется смена пароля при первом входе)", adminName);
            } else if ("admin".equalsIgnoreCase(adminName)) {
                users.findByUsernameIgnoreCase(adminName).ifPresent(admin -> {
                    if (!admin.isMustChangePassword()
                            && admin.getPasswordHash() != null
                            && authService.passwordEncoder().matches("admin", admin.getPasswordHash())) {
                        admin.setMustChangePassword(true);
                        users.save(admin);
                        log.info("admin всё ещё с паролем по умолчанию — включена обязательная смена");
                    }
                });
            }
        };
    }

    private static String randomPassword() {
        final String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
        SecureRandom rnd = new SecureRandom();
        StringBuilder sb = new StringBuilder(20);
        for (int i = 0; i < 20; i++) {
            sb.append(alphabet.charAt(rnd.nextInt(alphabet.length())));
        }
        return sb.toString();
    }
}
