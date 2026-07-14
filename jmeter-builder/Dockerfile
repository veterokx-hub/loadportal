FROM gradle:8.10-jdk17 AS build
WORKDIR /app
COPY settings.gradle build.gradle ./
RUN gradle --no-daemon dependencies || true
COPY src ./src
RUN gradle --no-daemon clean bootJar

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "app.jar"]
