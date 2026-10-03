package com.loadtest.orchestrator.web.dto;

import java.util.List;

/** Сводка results/verdict.json. Полный документ остаётся в test_runs.verdict_json. */
public record RunVerdictDto(
        String status,
        Long samples,
        Double p95Ms,
        Double p99Ms,
        Double errorRatePct,
        Double rps,
        List<String> reasons
) {
}
