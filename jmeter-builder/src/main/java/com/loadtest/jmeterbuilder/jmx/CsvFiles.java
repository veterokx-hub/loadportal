package com.loadtest.jmeterbuilder.jmx;

import com.loadtest.jmeterbuilder.model.Dataset;

import java.util.List;

/**
 * CSV для JMeter. Обычный CSV Data Set понимает кавычки (quotedData).
 * Random CSV Data Set режет строку по разделителю и кавычки не читает,
 * поэтому для случайного порядка разделитель выбирается так, чтобы он
 * не встречался в данных, и поля пишутся без кавычек.
 */
public final class CsvFiles {

    private CsvFiles() {
    }

    public static String delimiter(Dataset ds) {
        if (!ds.random()) {
            return ",";
        }
        String blob = blob(ds);
        if (!blob.contains(",")) return ",";
        if (!blob.contains(";")) return ";";
        if (!blob.contains("\t")) return "\t";
        if (!blob.contains("|")) return "|";
        return "\u001f";
    }

    public static String render(Dataset ds) {
        String delimiter = delimiter(ds);
        boolean quote = !ds.random();
        StringBuilder sb = new StringBuilder();
        List<String> columns = ds.columns();
        if (!columns.isEmpty()) {
            sb.append(join(columns, delimiter, quote)).append('\n');
        }
        for (List<String> row : ds.rows()) {
            sb.append(join(row, delimiter, quote)).append('\n');
        }
        return sb.toString();
    }

    private static String blob(Dataset ds) {
        StringBuilder sb = new StringBuilder();
        for (String column : ds.columns()) {
            sb.append(column == null ? "" : column).append('\n');
        }
        for (List<String> row : ds.rows()) {
            for (String cell : row) {
                sb.append(cell == null ? "" : cell).append('\n');
            }
        }
        return sb.toString();
    }

    private static String join(List<String> cells, String delimiter, boolean quote) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cells.size(); i++) {
            if (i > 0) sb.append(delimiter);
            sb.append(quote ? escape(cells.get(i)) : cells.get(i) == null ? "" : cells.get(i));
        }
        return sb.toString();
    }

    private static String escape(String value) {
        if (value == null) return "";
        if (value.indexOf(',') >= 0 || value.indexOf('"') >= 0 || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }
}
