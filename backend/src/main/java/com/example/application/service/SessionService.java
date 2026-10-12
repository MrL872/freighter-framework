package com.example.application.service;

import com.example.application.persistence.JobRecord;
import com.example.application.persistence.JobRepository;
import com.example.application.persistence.SessionRecord;
import com.example.application.persistence.SessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Coordinates creation and lookup of sessions and their jobs.
 * It calls SessionRepository and JobRepository so callers do not need to manage the Derby transaction boundary directly.
 */
@Service
public class SessionService {
    private final SessionRepository sessions;
    private final JobRepository jobs;

    public SessionService(SessionRepository sessions, JobRepository jobs) {
        this.sessions = sessions;
        this.jobs = jobs;
    }

    @Transactional
    public JobRecord createJobForNewSession() {
        SessionRecord session = sessions.create();
        return jobs.create(session.id());
    }

    /** Same as createJobForNewSession(), but tags the job with the frontend's profile id (see JobRepository#create). */
    @Transactional
    public JobRecord createJobForNewSession(String profileId) {
        SessionRecord session = sessions.create();
        return jobs.create(session.id(), profileId);
    }

    public SessionRecord loadSession(long id) {
        return sessions.findById(id).orElseThrow(() -> new IllegalArgumentException("Session not found: " + id));
    }

    public JobRecord loadJob(long id) {
        return jobs.findById(id).orElseThrow(() -> new IllegalArgumentException("Job not found: " + id));
    }
}