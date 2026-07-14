package com.loadtest.constructor.model;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;

/**
 * Стратегия заполнения значения параметра. Полиморфизм по полю "kind".
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.PROPERTY, property = "kind")
@JsonSubTypes({
        @JsonSubTypes.Type(value = ParamSource.Constant.class, name = "constant"),
        @JsonSubTypes.Type(value = ParamSource.GeneratorRef.class, name = "generator"),
        @JsonSubTypes.Type(value = ParamSource.Correlation.class, name = "correlation"),
        @JsonSubTypes.Type(value = ParamSource.Csv.class, name = "csv")
})
public sealed interface ParamSource {

    record Constant(String value) implements ParamSource {}

    record GeneratorRef(Generator generator) implements ParamSource {}

    record Correlation(String variable) implements ParamSource {}

    record Csv(String column) implements ParamSource {}
}
