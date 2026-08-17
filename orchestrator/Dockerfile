FROM gradle:8.10-jdk17 AS build
WORKDIR /app
COPY settings.gradle build.gradle ./
RUN gradle --no-daemon dependencies || true
COPY src ./src
RUN gradle --no-daemon clean bootJar

FROM eclipse-temurin:17-jre
WORKDIR /app

RUN groupadd --system --gid 888 app \
    && useradd --system --uid 888 --gid 888 --no-create-home --home-dir /app --shell /usr/sbin/nologin app

COPY --from=build --chown=root:root --chmod=0444 /app/build/libs/*.jar /app/app.jar

USER 888:888
EXPOSE 8082
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
