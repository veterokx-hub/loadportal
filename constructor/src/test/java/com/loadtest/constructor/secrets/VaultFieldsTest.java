package com.loadtest.constructor.secrets;

import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VaultFieldsTest {

    private static final JsonMapper JSON = JsonMapper.builderWithJackson2Defaults().build();

    @Test
    void passwordFieldOnParentSecret() throws Exception {
        var data = JSON.readTree("{\"username\":\"loadtest_adm\",\"password\":\"s3cret\"}");

        assertEquals("s3cret", VaultFields.fromSecret(data, "password", "loadtest.postgres.password"));
    }

    @Test
    void nestedDocumentAndDottedKey() throws Exception {
        var nested = JSON.readTree("{\"postgres\":{\"password\":\"s3cret\"}}");
        assertEquals("s3cret", VaultFields.fromSecret(nested, "postgres.password", "loadtest.postgres.password"));

        var dotted = JSON.readTree("{\"loadtest.postgres.password\":\"s3cret\"}");
        assertEquals("s3cret", VaultFields.fromSecret(dotted, "loadtest.postgres.password", "loadtest.postgres.password"));
    }

    @Test
    void exactPathKeepsValueField() throws Exception {
        var data = JSON.readTree("{\"value\":\"s3cret\",\"password\":\"other\"}");

        assertEquals("s3cret", VaultFields.fromSecret(data, "", "loadtest.postgres.password"));
    }

    @Test
    void parentSecretDoesNotReturnFirstUnrelatedField() throws Exception {
        var data = JSON.readTree("{\"username\":\"loadtest_adm\",\"token\":\"nope\"}");

        assertNull(VaultFields.fromSecret(data, "password", "loadtest.postgres.password"));
    }

    @Test
    void approleLeaseRenewsHalfway() throws Exception {
        var lease = VaultSecretResolver.parseAuth(
                "{\"auth\":{\"client_token\":\"hvs.x\",\"renewable\":true,\"lease_duration\":3600}}",
                JSON);
        assertEquals("hvs.x", lease.token());
        assertTrue(lease.renewable());
        assertEquals(1_800_000L, lease.hardExpiryMillis() - lease.renewAtMillis());
        assertEquals(Long.MAX_VALUE, VaultSecretResolver.renewAt(0, 0));
    }
}
