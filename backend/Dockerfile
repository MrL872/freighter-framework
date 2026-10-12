# syntax=docker/dockerfile:1.7

# --------------------------------
# Build stage
# --------------------------------
FROM maven:3.9.9-eclipse-temurin-21 AS build

WORKDIR /build

COPY pom.xml .

# Download dependencies first to improve Docker layer caching.
RUN --mount=type=cache,target=/root/.m2 \
    mvn --batch-mode dependency:go-offline

COPY src src

# Build the executable Spring Boot JAR.
RUN --mount=type=cache,target=/root/.m2 \
    mvn --batch-mode clean package -DskipTests


# --------------------------------
# Runtime stage
# --------------------------------
FROM eclipse-temurin:21-jre-jammy

ARG APP_USER=appuser
ARG APP_GROUP=appgroup


ENV APP_HOME=/opt/application \
    SPRING_PROFILES_ACTIVE=docker \
    DERBY_DATABASE_DIR=/data/derby \
    JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"


RUN groupadd --system ${APP_GROUP} \
    && useradd --system \
        --gid ${APP_GROUP} \
        --home-dir ${APP_HOME} \
        --create-home \
        ${APP_USER}

WORKDIR ${APP_HOME}

RUN mkdir -p \
        ${APP_HOME}/config \
        /data/derby \
    && chown -R ${APP_USER}:${APP_GROUP} \
        ${APP_HOME} \
        /data/derby

COPY --from=build \
    --chown=${APP_USER}:${APP_GROUP} \
    /build/target/*.jar \
    ${APP_HOME}/application.jar

USER ${APP_USER}

EXPOSE 8080

# Persist embedded Derby files.
VOLUME ["/data/derby"]

ENTRYPOINT ["sh", "-c"]

CMD ["exec java $JAVA_OPTS -jar ${APP_HOME}/application.jar"]