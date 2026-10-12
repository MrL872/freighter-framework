CREATE TABLE jobs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT jobs_session_fk FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX jobs_session_idx ON jobs(session_id);
CREATE INDEX jobs_status_idx ON jobs(status);