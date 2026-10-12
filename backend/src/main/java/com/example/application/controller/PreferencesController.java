package com.example.application.controller;

import com.example.application.persistence.PreferenceRepository;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Small key/value store for UI preferences (e.g. the sidebar's link order)
 * that must survive more than a browser's local storage — a page reload,
 * a backend restart, or a crash. The frontend is the only client; values
 * are opaque JSON blobs it defines and interprets. Delegates storage to PreferenceRepository.
 */
@RestController
public class PreferencesController {
    private static final long MAX_VALUE_BYTES = 65536;

    private final PreferenceRepository preferences;

    public PreferencesController(PreferenceRepository preferences) { this.preferences = preferences; }

    @GetMapping("/preferences/{key:[a-z0-9-]{1,64}}")
    public ResponseEntity<String> get(@PathVariable String key) {
        return preferences.find(key)
            .map(value -> ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(value))
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/preferences/{key:[a-z0-9-]{1,64}}")
    public ResponseEntity<Void> put(@PathVariable String key, @RequestBody String value) {
        if (value.getBytes().length > MAX_VALUE_BYTES) return ResponseEntity.badRequest().build();
        preferences.save(key, value);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/preferences/{key:[a-z0-9-]{1,64}}")
    public ResponseEntity<Void> delete(@PathVariable String key) {
        preferences.delete(key);
        return ResponseEntity.noContent().build();
    }

    /**
     * Diagnostic listing (key + byte size + last update, never the values
     * themselves) -- for auditing that this table only ever holds genuine
     * UI preference settings (link order, ledger column widths/order, ...)
     * rather than stray keys left behind by a feature that stores its data
     * elsewhere (Project Folder and Image Storage use filesystem-backed
     * storage through ProjectFileService and ImageFileService).
     */
    @GetMapping("/preferences")
    public ResponseEntity<?> list() {
        return ResponseEntity.ok(preferences.listKeys());
    }
}
