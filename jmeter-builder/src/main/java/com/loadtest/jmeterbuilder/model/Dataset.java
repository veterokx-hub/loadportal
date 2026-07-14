package com.loadtest.jmeterbuilder.model;

import java.util.List;

/** CSV-датасет уровня сценария (инлайн rows или загруженный CSV). */
public record Dataset(
        String id,
        String name,
        String fileName,
        List<String> columns,
        List<List<String>> rows,
        boolean random
) {
    public List<String> columns() {
        return columns != null ? columns : List.of();
    }

    public List<List<String>> rows() {
        return rows != null ? rows : List.of();
    }
}
