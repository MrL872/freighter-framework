package com.example.application.persistence;

import com.example.application.service.WorkerResultService;
import com.example.application.service.WorkerService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Verifies the Derby-backed persistence and worker-result workflows as a Spring integration.
 * It wires repositories and services together, then checks stored state, output validation, and worker replacement behavior.
 */
@SpringBootTest
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:derby:memory:freightertest;create=true",
    "spring.datasource.driver-class-name=org.apache.derby.jdbc.EmbeddedDriver"
})
class DerbyPersistenceIntegrationTest {

    @Autowired
    private SessionRepository sessions;

    @Autowired
    private JobRepository jobs;

    @Autowired
    private WorkerRepository workers;

    @Autowired
    private ExpectedOutputRepository expectedOutputs;

    @Autowired
    private WorkerResultService workerResults;

    @Autowired
    private WorkerService workerService;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void persistsAndValidatesApplicationState() {
        SessionRecord session = sessions.create();
        JobRecord job = jobs.create(session.id());
        WorkerRecord worker = workers.register(job.id(), "reporter", "temporary-container");
        expectedOutputs.store(job.id(), SupportedOutputType.JSON, "{\"required\":true}", "required", "OK", 100);

        JobResultRecord result = workerResults.accept(job.id(), worker.id(), SupportedOutputType.JSON, "OK", "{\"required\":true}");

        assertThat(result.jobId()).isEqualTo(job.id());
        assertThat(sessions.findById(session.id())).contains(session);
        assertThat(jobs.findById(job.id())).contains(job);
        assertThat(workers.findById(worker.id())).contains(worker);
        assertThatThrownBy(() -> workerResults.accept(job.id(), worker.id(), SupportedOutputType.JSON, "OK", "x".repeat(101)))
            .isInstanceOf(IllegalArgumentException.class);

        workers.updateStatus(worker.id(), WorkerStatus.FAILED);
        WorkerRecord replacement = workerService.replaceWorker(worker.id(), "reporter", "replacement-container");

        assertThat(replacement.jobId()).isEqualTo(job.id());
        assertThat(workers.findById(worker.id())).get().extracting(WorkerRecord::status)
            .isEqualTo(WorkerStatus.REPLACED);

        assertThatThrownBy(() -> jdbc.update(
            "INSERT INTO expected_outputs(job_id, output_type, definition, max_size, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
            job.id(), "XML", "<result/>", 100))
            .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    }
}