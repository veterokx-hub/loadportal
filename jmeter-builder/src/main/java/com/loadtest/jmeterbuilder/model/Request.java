package com.loadtest.jmeterbuilder.model;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record Request(
        String id,
        int order,
        String name,
        String method,
        String path,
        List<KeyValue> headers,
        List<Param> queryParams,
        Body body,
        List<Param> params,
        List<Extraction> extractions,
        Intensity intensity,
        Validation validation,
        String datasetId,
        int repeat
) {
    /** Число повторов запроса за одну итерацию потока (Loop Controller). */
    public int repeatOrOne() {
        return repeat > 0 ? repeat : 1;
    }

    public List<KeyValue> headers() {
        return headers != null ? headers : List.of();
    }

    public List<Param> params() {
        return params != null ? params : List.of();
    }

    public List<Extraction> extractions() {
        return extractions != null ? extractions : List.of();
    }

    public List<Param> queryParams() {
        return queryParams != null ? queryParams : List.of();
    }

    public Intensity intensity() {
        return intensity != null ? intensity : Intensity.defaults();
    }

    public Validation validation() {
        return validation != null ? validation : Validation.defaults();
    }

    public Body body() {
        return body != null ? body : Body.none();
    }
}
