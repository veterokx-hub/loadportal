package com.loadtest.constructor.job;

import com.loadtest.constructor.service.BuildHistoryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Ежедневная чистка сборок старше retention-days (и связанных portal_build скриптов). */
@Component
@ConditionalOnProperty(name = "loadtest.builds.cleanup-enabled", havingValue = "true", matchIfMissing = true)
public class BuildRetentionJob {

    private static final Logger log = LoggerFactory.getLogger(BuildRetentionJob.class);

    private final BuildHistoryService buildHistoryService;

    public BuildRetentionJob(BuildHistoryService buildHistoryService) {
        this.buildHistoryService = buildHistoryService;
    }

    @Scheduled(cron = "${loadtest.builds.cleanup-cron:0 15 3 * * *}")
    public void purgeExpiredBuilds() {
        try {
            int removed = buildHistoryService.purgeExpired();
            if (removed == 0) {
                log.debug("Build retention: nothing to purge ({} days)", buildHistoryService.retentionDays());
            }
        } catch (Exception ex) {
            log.warn("Build retention job failed: {}", ex.getMessage());
        }
    }
}
