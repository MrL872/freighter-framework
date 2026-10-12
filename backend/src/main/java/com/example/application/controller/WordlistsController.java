package com.example.application.controller;

import com.example.application.service.WordlistService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.AccessDeniedException;
import java.util.Map;

/**
 * REST endpoint used by frontend/public/js/wordlistBrowser.js to walk data/wordlists, and by the [ file ]
 * menu's "Upload Wordlists" folder picker (menu.js/folderUpload.js) to add files to it.
 */
@RestController
public class WordlistsController {
    private static final Logger log = LoggerFactory.getLogger(WordlistsController.class);
    /** One file per request (see folderUpload.js) -- generous enough for a large combined wordlist (rockyou.txt-sized). */
    private static final long MAX_UPLOAD_BYTES = 300L * 1024 * 1024;

    private final WordlistService wordlists;

    public WordlistsController(WordlistService wordlists) {
        this.wordlists = wordlists;
    }

    @GetMapping("/wordlists")
    public ResponseEntity<?> list(@RequestParam(defaultValue = "") String path) {
        try {
            return ResponseEntity.ok(wordlists.list(path));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * path is the file's path relative to the folder the user picked on the host (preserving any subfolders),
     * not just its bare name -- see folderUpload.js, which sends one request per file in that folder.
     * Overwrites an existing file at the same path.
     */
    @PostMapping("/wordlists/upload")
    public ResponseEntity<?> upload(@RequestParam String path, @RequestPart("file") MultipartFile file) {
        if (file.isEmpty()) return ResponseEntity.badRequest().body(Map.of("error", "Empty file"));
        if (file.getSize() > MAX_UPLOAD_BYTES) {
            return ResponseEntity.badRequest().body(Map.of("error", path + ": too large (max " + (MAX_UPLOAD_BYTES / (1024 * 1024)) + "MB)"));
        }
        try {
            wordlists.upload(path, file.getInputStream());
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (AccessDeniedException e) {
            // Most often a pre-existing subfolder owned by a different
            // container's UID (e.g. nuclei-worker's own UID, if this were the
            // templates directory instead) rather than anything wrong with
            // this upload itself -- logged so an admin can actually diagnose
            // it instead of just seeing a bare 500 with no server-side trace.
            log.warn("wordlist-upload-permission-denied path={}", path);
            return ResponseEntity.internalServerError().body(Map.of("error", path + ": permission denied writing to this path on the server"));
        } catch (IOException e) {
            log.error("wordlist-upload-failed path={} message={}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", "Failed to save " + path));
        }
    }
}
