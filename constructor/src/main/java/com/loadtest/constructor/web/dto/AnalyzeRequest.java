package com.loadtest.constructor.web.dto;

import com.loadtest.constructor.model.SourceType;

public record AnalyzeRequest(
        SourceType sourceType,
        String url,
        String content,
        String name
) {}
