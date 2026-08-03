package com.loadtest.constructor.config;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Режим init-job для Argo/k8s: применить Liquibase и завершить процесс.
 * <pre>
 * java -jar app.jar --spring.main.web-application-type=none --loadtest.db-init-exit=true
 * </pre>
 */
@Component
@ConditionalOnProperty(name = "loadtest.db-init-exit", havingValue = "true")
public class DbInitExitRunner implements ApplicationRunner {

    @Override
    public void run(ApplicationArguments args) {
        // Liquibase уже отработал при старте Spring context.
        System.exit(0);
    }
}
