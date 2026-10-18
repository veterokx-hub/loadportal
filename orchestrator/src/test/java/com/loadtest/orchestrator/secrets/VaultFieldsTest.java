package com.loadtest.orchestrator.secrets;

import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

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
}
