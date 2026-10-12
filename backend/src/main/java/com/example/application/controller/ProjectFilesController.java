package com.example.application.controller;

import com.example.application.service.ProjectFileService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * REST endpoints used by frontend/public/js/projectFolder.js for Project Folder.
 * Files are stored as real files under project-storage.directory, managed by
 * ProjectFileService. The frontend reaches that storage only through this
 * controller, never by accessing the filesystem or volume directly.
 */
@RestController
public class ProjectFilesController {
    private final ProjectFileService files;

    public ProjectFilesController(ProjectFileService files) {
        this.files = files;
    }

    public record SaveRequest(String profileId, String name, String content, String format, String kind, String worker) {}
    public record RenameRequest(String profileId, String name) {}
    public record ContentRequest(String profileId, String content) {}

    @GetMapping("/project-files")
    public ResponseEntity<?> list(@RequestParam String profileId) {
        return ResponseEntity.ok(files.list(profileId));
    }

    @PostMapping("/project-files")
    public ResponseEntity<?> save(@RequestBody SaveRequest request) {
        try {
            return ResponseEntity.ok(files.save(request.profileId(), request.name(), request.content(),
                request.format(), request.kind(), request.worker()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PatchMapping("/project-files/{id}")
    public ResponseEntity<?> rename(@PathVariable String id, @RequestBody RenameRequest request) {
        try {
            return ResponseEntity.ok(files.rename(request.profileId(), id, request.name()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PatchMapping("/project-files/{id}/content")
    public ResponseEntity<?> updateContent(@PathVariable String id, @RequestBody ContentRequest request) {
        try {
            return ResponseEntity.ok(files.updateContent(request.profileId(), id, request.content()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/project-files/{id}")
    public ResponseEntity<?> remove(@PathVariable String id, @RequestParam String profileId) {
        try {
            files.remove(profileId, id);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Deletes every file a profile has saved -- called when the company profile itself is deleted. */
    @DeleteMapping("/project-files/profile/{profileId}")
    public ResponseEntity<?> removeProfile(@PathVariable String profileId) {
        try {
            files.deleteProfile(profileId);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
