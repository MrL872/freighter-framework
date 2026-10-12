CREATE TABLE ui_preferences (
    pref_key VARCHAR(128) PRIMARY KEY,
    pref_value CLOB NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
