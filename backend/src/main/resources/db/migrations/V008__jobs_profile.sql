-- Associates a job with the frontend's (client-generated, opaque) company
-- profile id, so persisted results can later be queried back out per
-- profile (see SubfinderController#findings). Profiles are not a backend
-- entity of their own (see store.js) -- this column just carries the
-- frontend's id through so job_results can be filtered by it.
ALTER TABLE jobs ADD COLUMN profile_id VARCHAR(64);

CREATE INDEX jobs_profile_idx ON jobs(profile_id);
