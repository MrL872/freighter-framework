CREATE TABLE workers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL,
    container_id VARCHAR(255),
    worker_type VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT workers_job_fk FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX workers_job_idx ON workers(job_id);