package com.example.application.persistence;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Stores small, arbitrary UI preference values (e.g. sidebar link order) as
 * raw JSON text, keyed by a caller-chosen name. Backed by Derby on disk, so
 * a value written here survives page reloads, backend restarts and crashes
 * alike — unlike browser-only storage.
 */
@Repository
public class PreferenceRepository {
    private final JdbcTemplate jdbc;

    public PreferenceRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Optional<String> find(String key) {
        try {
            return Optional.ofNullable(jdbc.queryForObject(
                "SELECT pref_value FROM ui_preferences WHERE pref_key = ?", String.class, key));
        } catch (EmptyResultDataAccessException e) {
            return Optional.empty();
        }
    }

    public void save(String key, String value) {
        LocalDateTime now = LocalDateTime.now();
        int updated = jdbc.update(
            "UPDATE ui_preferences SET pref_value = ?, updated_at = ? WHERE pref_key = ?",
            value, Timestamp.valueOf(now), key);
        if (updated == 0) {
            jdbc.update(
                "INSERT INTO ui_preferences(pref_key, pref_value, updated_at) VALUES (?, ?, ?)",
                key, value, Timestamp.valueOf(now));
        }
    }

    public void delete(String key) {
        jdbc.update("DELETE FROM ui_preferences WHERE pref_key = ?", key);
    }

    /** Key + byte size of every stored value (not the values themselves) -- for auditing what's actually in this table. */
    public List<Map<String, Object>> listKeys() {
        return jdbc.queryForList(
            "SELECT pref_key AS \"key\", LENGTH(pref_value) AS \"size\", updated_at AS \"updatedAt\" FROM ui_preferences ORDER BY pref_key");
    }
}
