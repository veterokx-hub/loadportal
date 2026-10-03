package com.loadtest.orchestrator.config;

import com.loadtest.orchestrator.secrets.SecretResolver;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Duration;

/**
 * Единая точка создания HTTP-клиентов модуля.
 *
 * <p>Каждый экземпляр {@link HttpClient} держит собственный пул соединений, поэтому клиент
 * создаётся один раз на приложение и переиспользуется всеми вызовами: соединения к
 * analyzer / k6-generator / jmeter-builder / Consul / Vault / GitLab живут между запросами
 * (keep-alive). Раньше каждый класс поднимал свой пул, а часть из них ещё и пересобирала
 * {@code RestClient} на каждый вызов.
 *
 * <p>Оба бина строятся из автоконфигурированного {@link RestClient.Builder} — он уже содержит
 * инструментацию Micrometer, благодаря чему исходящие вызовы попадают в метрику
 * {@code http_client_requests_seconds} с разбивкой по хосту и статусу.
 *
 * <p>Клиентов два: у рабочих вызовов и у health-проб принципиально разные требования к
 * таймаутам — первые должны дожидаться генерации артефакта, вторые обязаны быстро падать,
 * чтобы {@code /ready} не висел на недоступном соседе.
 */
@Configuration
public class HttpClientConfig {

    /**
     * Клиент для рабочих вызовов: анализ спеки, генерация артефактов, Consul, Vault, GitLab.
     * Базовый URL не задаётся: адреса резолвятся динамически (Consul / настройки портала),
     * поэтому вызывающий код передаёт абсолютный URL.
     */
    @Bean
    public RestClient sharedRestClient(
            RestClient.Builder builder,
            @Value("${loadtest.http.connect-timeout-ms:5000}") long connectTimeoutMs,
            @Value("${loadtest.http.read-timeout-ms:60000}") long readTimeoutMs) {
        return builder.clone()
                .requestFactory(requestFactory(connectTimeoutMs, readTimeoutMs))
                .build();
    }

    /**
     * Клиент для вызовов соседних модулей портала: добавляет общий внутренний токен,
     * чтобы каждый вызывающий класс не проставлял заголовок вручную и не забывал его.
     * Read-таймаут больше рабочего: анализ длинного теста ходит в источник метрик
     * десятки раз и укладывается в минуты, а не в секунды.
     */
    @Bean
    public RestClient internalRestClient(
            RestClient.Builder builder,
            SecretResolver secrets,
            @Value("${loadtest.internal-token:}") String internalToken,
            @Value("${loadtest.http.connect-timeout-ms:5000}") long connectTimeoutMs,
            @Value("${loadtest.http.internal-read-timeout-ms:180000}") long readTimeoutMs) {
        String token = secrets.resolve("loadtest/internal-token")
                .orElse(internalToken == null ? "" : internalToken.trim());
        RestClient.Builder configured = builder.clone()
                .requestFactory(requestFactory(connectTimeoutMs, readTimeoutMs));
        if (!token.isBlank()) {
            configured = configured.defaultHeader("X-Internal-Token", token);
        }
        return configured.build();
    }

    /**
     * Клиент для health-проб соседних модулей в {@code /ready}: недоступный сосед должен
     * определяться за секунды, а не блокировать probe до общего read-таймаута.
     */
    @Bean
    public RestClient probeRestClient(
            RestClient.Builder builder,
            @Value("${loadtest.http.probe-connect-timeout-ms:2000}") long connectTimeoutMs,
            @Value("${loadtest.http.probe-read-timeout-ms:2000}") long readTimeoutMs) {
        return builder.clone()
                .requestFactory(requestFactory(connectTimeoutMs, readTimeoutMs))
                .build();
    }

    /**
     * HTTP/1.1 выбран осознанно: соседние сервисы (uvicorn, встроенный Tomcat) не дают выигрыша
     * от HTTP/2, а согласование протокола добавляет задержку на первом запросе.
     */
    private static JdkClientHttpRequestFactory requestFactory(long connectTimeoutMs, long readTimeoutMs) {
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(connectTimeoutMs))
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
        return factory;
    }
}
