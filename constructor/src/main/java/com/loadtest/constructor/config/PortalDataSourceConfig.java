package com.loadtest.constructor.config;

import com.loadtest.constructor.secrets.SecretResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.jdbc.autoconfigure.DataSourceProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.util.Optional;

@Configuration
public class PortalDataSourceConfig {

    static final String PASSWORD_PATH = "loadtest/postgres/password";

    private static final Logger log = LoggerFactory.getLogger(PortalDataSourceConfig.class);

    @Bean
    public DataSource dataSource(
            DataSourceProperties properties,
            ConsulKv consul,
            DiscoveryConfig discovery,
            SecretResolver secrets) {
        Optional<String> consulUrl = consul.property("loadtest.postgres.url").or(() -> consul.get("postgres/url"));
        Optional<String> consulUser = consul.property("loadtest.postgres.username")
                .or(() -> consul.get("postgres/username"));
        DbSettings settings = DbSettings.resolve(
                consulUrl,
                System.getenv("SPRING_DATASOURCE_URL"),
                discovery.getModules().getPostgresJdbcUrl(),
                properties.getUrl(),
                consulUser,
                System.getenv("SPRING_DATASOURCE_USERNAME"),
                discovery.getModules().getPostgresUsername(),
                properties.getUsername(),
                secrets.resolve(PASSWORD_PATH),
                properties.getPassword());
        log.info("PostgreSQL url={} user={}", settings.url(), settings.username());
        if (settings.url().isBlank() || settings.username().isBlank() || settings.password().isBlank()) {
            throw new IllegalStateException("Не задано подключение к PostgreSQL: url, пользователь или пароль");
        }
        return properties.initializeDataSourceBuilder()
                .url(settings.url())
                .username(settings.username())
                .password(settings.password())
                .build();
    }
}
