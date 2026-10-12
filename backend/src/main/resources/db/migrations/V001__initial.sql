CREATE TABLE schema_migrations (
    version INTEGER NOT NULL PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP NOT NULL
);