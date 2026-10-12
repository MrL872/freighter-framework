package com.example.application.controller;

import com.example.application.service.NucleiTemplatesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.AccessDeniedException;
import java.util.Map;

/**
 * REST endpoint for the [ file ] menu's "Upload Nuclei Templates" folder picker (menu.js/folderUpload.js).
 * Write-only: there is no listing endpoint here, since nothing in the app browses this directory from the
 * backend side (nuclei-worker reads it directly off disk) -- see NucleiTemplatesService.
 */
@RestController
public class NucleiTemplatesController {
    private static final Logger log = LoggerFactory.getLogger(NucleiTemplatesController.class);
    /** One file per request (see folderUpload.js) -- a single template is small, this just isn't a reason to fail one. */
    private static final long MAX_UPLOAD_BYTES = 300L * 1024 * 1024;

    private final NucleiTemplatesService templates;

    public NucleiTemplatesController(NucleiTemplatesService templates) {
        this.templates = templates;
    }

    /**
     * path is the file's path relative to the folder the user picked on the host (preserving any subfolders),
     * not just its bare name -- see folderUpload.js, which sends one request per file in that folder.
     * Overwrites an existing file at the same path.
     */
    @PostMapping("/nuclei-templates/upload")
    public ResponseEntity<?> upload(@RequestParam String path, @RequestPart("file") MultipartFile file) {
        if (file.isEmpty()) return ResponseEntity.badRequest().body(Map.of("error", "Empty file"));
        if (file.getSize() > MAX_UPLOAD_BYTES) {
            return ResponseEntity.badRequest().body(Map.of("error", path + ": too large (max " + (MAX_UPLOAD_BYTES / (1024 * 1024)) + "MB)"));
        }
        try {
            templates.upload(path, file.getInputStream());
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (AccessDeniedException e) {
            // Most often a pre-existing category subfolder (http/, dns/, ...)
            // left owned by nuclei-worker's own UID from an earlier run
            // (nuclei's own template auto-update writes there as that
            // container's user, not the backend's) rather than anything
            // wrong with this upload itself -- logged so an admin can
            // actually diagnose it instead of just seeing a bare 500 with no
            // server-side trace.
            log.warn("nuclei-template-upload-permission-denied path={}", path);
            return ResponseEntity.internalServerError().body(Map.of("error", path + ": permission denied writing to this path on the server"));
        } catch (IOException e) {
            log.error("nuclei-template-upload-failed path={} message={}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", "Failed to save " + path));
        }
    }
}
