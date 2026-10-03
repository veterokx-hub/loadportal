package com.loadtest.orchestrator.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TestRunStatusTest {

    @Test
    void mapsGitLabStatuses() {
        assertEquals(TestRunStatus.QUEUED, TestRunStatus.fromGitLab(null));
        assertEquals(TestRunStatus.QUEUED, TestRunStatus.fromGitLab("scheduled"));
        assertEquals(TestRunStatus.RUNNING, TestRunStatus.fromGitLab("running"));
        assertEquals(TestRunStatus.SUCCEEDED, TestRunStatus.fromGitLab("success"));
        assertEquals(TestRunStatus.FAILED, TestRunStatus.fromGitLab("failed"));
        assertEquals(TestRunStatus.CANCELED, TestRunStatus.fromGitLab("canceled"));
        assertEquals(TestRunStatus.QUEUED, TestRunStatus.fromGitLab("unknown"));
    }

    @Test
    void terminalStatuses() {
        assertTrue(TestRunStatus.SUCCEEDED.isTerminal());
        assertTrue(TestRunStatus.FAILED.isTerminal());
        assertTrue(TestRunStatus.CANCELED.isTerminal());
        assertFalse(TestRunStatus.QUEUED.isTerminal());
        assertFalse(TestRunStatus.RUNNING.isTerminal());
    }
}
