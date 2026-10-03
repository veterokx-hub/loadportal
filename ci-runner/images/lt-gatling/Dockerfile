# syntax=docker/dockerfile:1.7
# lt-gatling: JDK 17 + Maven + прогретый локальный репозиторий под pom.xml портала.
# В рантайме Maven работает офлайн (-o): сборка проекта не зависит от Nexus,
# а версия Gatling жёстко привязана к образу (lt-run проверяет pom заранее).
ARG JDK_IMAGE
ARG MAVEN_IMAGE
ARG LT_BASE_IMAGE
FROM ${JDK_IMAGE} AS jdk
FROM ${MAVEN_IMAGE} AS maven

# Прогрев в отдельной стадии: settings.xml с зеркалом остаётся здесь и не попадает
# в слои финального образа. Kaniko не умеет BuildKit --mount=type=secret.
FROM ${LT_BASE_IMAGE} AS warm

ARG GATLING_VERSION
ARG GATLING_MAVEN_PLUGIN_VERSION

USER root

COPY --from=jdk /opt/java/openjdk /opt/java/openjdk
COPY --from=maven /usr/share/maven /opt/maven
ENV JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:/opt/maven/bin:$PATH

COPY selftest /opt/lt/selftest
COPY maven-settings.xml /tmp/maven-settings.xml
RUN settings=""; \
    if grep -Eq '<mirrors>|<servers>|<proxies>|<profiles>' /tmp/maven-settings.xml; then settings="-s /tmp/maven-settings.xml"; fi; \
    mvn -B -q $settings -f /opt/lt/selftest/pom.xml -Dmaven.repo.local=/opt/m2 \
        -Dgatling.version="$GATLING_VERSION" -Dgatling-maven-plugin.version="$GATLING_MAVEN_PLUGIN_VERSION" \
        -Dgatling.noReports=true gatling:test \
 && rm -f /tmp/maven-settings.xml \
 && rm -rf /opt/lt/selftest/target

FROM ${LT_BASE_IMAGE}

ARG GATLING_VERSION
ARG GATLING_MAVEN_PLUGIN_VERSION

USER root

COPY --from=jdk /opt/java/openjdk /opt/java/openjdk
COPY --from=maven /usr/share/maven /opt/maven
COPY --from=warm /opt/m2 /opt/m2
COPY selftest /opt/lt/selftest

# Две JVM в поде: Maven (сборка) и форк Gatling (нагрузка). JAVA_TOOL_OPTIONS
# действует на обе, а флаги из MAVEN_OPTS идут позже и перекрывают его для Maven.
ENV JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:/opt/maven/bin:$PATH \
    LT_MAVEN_REPO=/opt/m2 \
    GATLING_VERSION=${GATLING_VERSION} \
    GATLING_MAVEN_PLUGIN_VERSION=${GATLING_MAVEN_PLUGIN_VERSION} \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=65 -XX:+ExitOnOutOfMemoryError" \
    MAVEN_OPTS="-XX:MaxRAMPercentage=10"

RUN chown -R 10001:0 /opt/m2 /opt/lt/selftest && chmod -R g=u /opt/m2 /opt/lt/selftest

USER 10001
