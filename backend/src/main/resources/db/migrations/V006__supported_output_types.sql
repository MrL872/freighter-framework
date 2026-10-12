ALTER TABLE expected_outputs ADD CONSTRAINT expected_outputs_type_ck
    CHECK (output_type IN ('JSON', 'TEXT'));

ALTER TABLE expected_outputs ADD CONSTRAINT expected_outputs_size_ck
    CHECK (max_size > 0 AND max_size <= 10485760);

ALTER TABLE job_results ADD CONSTRAINT job_results_status_ck
    CHECK (status IS NOT NULL AND LENGTH(status) BETWEEN 1 AND 32);