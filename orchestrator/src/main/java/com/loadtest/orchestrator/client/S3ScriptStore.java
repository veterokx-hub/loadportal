package com.loadtest.orchestrator.client;

import com.loadtest.orchestrator.config.ExternalConnections;
import com.loadtest.orchestrator.util.ZipScripts;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedGetObjectRequest;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/**
 * Скрипт прогона в S3-совместимом хранилище (SeaweedFS).
 * В GitLab уходит только presigned URL манифеста, не ключи доступа.
 */
@Component
public class S3ScriptStore {

    private static final Duration PRESIGN_TTL = Duration.ofHours(12);

    private final ExternalConnections connections;

    public S3ScriptStore(ExternalConnections connections) {
        this.connections = connections;
    }

    public record Stored(String primaryKey, String checksum, String manifestUrl, String bucket, int files) {
    }

    public Stored putRun(String scenarioPath, byte[] content, String filename) {
        requireReady();
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("Пустое содержимое скрипта");
        }
        List<Item> items = new ArrayList<>();
        String primary;
        if (ZipScripts.isZip(content, filename != null ? filename : scenarioPath)) {
            String dir = parentDir(scenarioPath);
            List<ZipScripts.Entry> entries = ZipScripts.unpack(content);
            for (ZipScripts.Entry entry : entries) {
                items.add(new Item(dir + entry.path(), entry.content()));
            }
            primary = dir + ZipScripts.primaryScript(entries);
        } else {
            items.add(new Item(scenarioPath, content));
            primary = scenarioPath;
        }
        byte[] primaryBytes = items.stream()
                .filter(i -> i.key.equals(primary))
                .map(i -> i.body)
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("В архиве нет основного скрипта"));

        String endpoint = normalizeEndpoint(connections.s3Endpoint());
        String publicEndpoint = normalizeEndpoint(connections.s3PublicEndpoint());
        String bucket = connections.s3Bucket();
        String region = connections.s3Region();
        AwsBasicCredentials credentials = AwsBasicCredentials.create(
                connections.s3AccessKey().orElseThrow(),
                connections.s3SecretKey().orElseThrow());
        StaticCredentialsProvider provider = StaticCredentialsProvider.create(credentials);
        S3Configuration pathStyle = S3Configuration.builder().pathStyleAccessEnabled(true).build();

        try (S3Client s3 = S3Client.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.of(region))
                .credentialsProvider(provider)
                .serviceConfiguration(pathStyle)
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
                .build();
             S3Presigner presigner = S3Presigner.builder()
                     .endpointOverride(URI.create(publicEndpoint))
                     .region(Region.of(region))
                     .credentialsProvider(provider)
                     .serviceConfiguration(pathStyle)
                     .build()) {
            StringBuilder manifest = new StringBuilder();
            for (Item item : items) {
                put(s3, bucket, item.key, item.body);
                manifest.append(item.key).append('\t').append(presign(presigner, bucket, item.key)).append('\n');
            }
            String manifestKey = parentDir(primary) + "_s3-manifest.txt";
            if (!manifestKey.contains("/")) {
                manifestKey = "_s3-manifest.txt";
            }
            byte[] manifestBytes = manifest.toString().getBytes(StandardCharsets.UTF_8);
            put(s3, bucket, manifestKey, manifestBytes);
            return new Stored(
                    primary,
                    "sha256:" + sha256(primaryBytes),
                    presign(presigner, bucket, manifestKey),
                    bucket,
                    items.size());
        } catch (IllegalArgumentException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException("S3: не удалось записать скрипт: " + safe(ex.getMessage()));
        }
    }

    private void requireReady() {
        if (!connections.s3Ready()) {
            throw new IllegalArgumentException(
                    "S3 не настроен: нужны endpoint, bucket (Consul/env) и ключи (Vault или S3_ACCESS_KEY/S3_SECRET_KEY)");
        }
    }

    private static void put(S3Client s3, String bucket, String key, byte[] body) {
        s3.putObject(
                PutObjectRequest.builder().bucket(bucket).key(key).build(),
                RequestBody.fromBytes(body));
    }

    private static String presign(S3Presigner presigner, String bucket, String key) {
        PresignedGetObjectRequest signed = presigner.presignGetObject(GetObjectPresignRequest.builder()
                .signatureDuration(PRESIGN_TTL)
                .getObjectRequest(r -> r.bucket(bucket).key(key))
                .build());
        return signed.url().toString();
    }

    private static String parentDir(String path) {
        if (path == null || path.isBlank()) {
            return "";
        }
        int slash = path.replace('\\', '/').lastIndexOf('/');
        return slash < 0 ? "" : path.substring(0, slash + 1);
    }

    private static String normalizeEndpoint(String endpoint) {
        String value = endpoint.trim();
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://" + value;
        }
        return value.replaceAll("/$", "");
    }

    private static String sha256(byte[] body) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
        } catch (Exception ex) {
            throw new IllegalStateException("SHA-256", ex);
        }
    }

    private static String safe(String message) {
        if (message == null) {
            return "";
        }
        int query = message.indexOf('?');
        String cut = query > 0 ? message.substring(0, query) : message;
        return cut.length() > 240 ? cut.substring(0, 240) : cut;
    }

    private record Item(String key, byte[] body) {
    }
}
