CREATE TABLE expected_outputs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL UNIQUE,
    output_type VARCHAR(128) NOT NULL,
    definition CLOB NOT NULL,
    required_fields CLOB,
    allowed_status VARCHAR(32),
    max_size BIGINT NOT NULL CHECK (max_size > 0 AND max_size <= 10485760),
    created_at TIMESTAMP NOT NULL,
    CONSTRAINT expected_outputs_job_fk FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE job_results (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL,
    worker_id BIGINT,
    result CLOB NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    CONSTRAINT job_results_job_fk FOREIGN KEY (job_id) REFERENCES jobs(id),
    CONSTRAINT job_results_worker_fk FOREIGN KEY (worker_id) REFERENCES workers(id)
);

CREATE INDEX job_results_job_idx ON job_results(job_id);