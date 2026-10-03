FROM gradle:8.14.2-jdk17@sha256:9ba82ad61f9e5729d14d43268b970b7f5007ab2300c1b0bbfa767a2c78dc1c7b AS build
WORKDIR /app
COPY settings.gradle build.gradle ./
RUN gradle --no-daemon dependencies || true
COPY src ./src
RUN gradle --no-daemon clean bootJar

FROM eclipse-temurin:17-jre@sha256:13cc28a6cc72a38ce1f00c906be3580c1a3e604b8984d694f369a96742abc93b
WORKDIR /app

RUN groupadd --system --gid 888 app \
    && useradd --system --uid 888 --gid 888 --no-create-home --home-dir /app --shell /usr/sbin/nologin app

# jar только на чтение; писать UID 888 некуда, кроме /tmp (JVM/Spring).
COPY --from=build --chown=root:root --chmod=0444 /app/build/libs/*.jar /app/app.jar

USER 888:888
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
