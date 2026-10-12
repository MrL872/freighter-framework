package com.example.application.controller;

import com.example.application.service.ImageFileService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * REST endpoints used by frontend/public/js/imageFolder.js for Image Storage.
 * Image bytes are stored as real files under image-storage.directory, managed
 * by ImageFileService. The list response includes a "content" URL for each
 * image that points at /images/{profileId}/{id}, so the browser fetches the
 * bytes on demand rather than receiving every image inline as a data: URL.
 */
@RestController
public class ImagesController {
    private final ImageFileService images;

    public ImagesController(ImageFileService images) {
        this.images = images;
    }

    public record RenameRequest(String profileId, String name) {}

    // Deliberately no "content"/download-URL field here -- this controller's
    // own path ("/images/...") isn't what the browser needs to fetch
    // (frontend/server.js's proxy only forwards "/api/..."), so imageFolder.js
    // builds that URL itself instead of trusting one echoed back from here.
    @GetMapping("/images")
    public ResponseEntity<?> list(@RequestParam String profileId) {
        return ResponseEntity.ok(images.list(profileId));
    }

    @GetMapping("/images/{profileId}/{id}")
    public ResponseEntity<?> content(@PathVariable String profileId, @PathVariable String id) {
        try {
            byte[] bytes = images.readContent(profileId, id);
            String format = images.formatOf(profileId, id);
            MediaType type = switch (format) {
                case "jpg", "jpeg" -> MediaType.IMAGE_JPEG;
                case "gif" -> MediaType.IMAGE_GIF;
                default -> MediaType.IMAGE_PNG;
            };
            return ResponseEntity.ok().contentType(type)
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=31536000, immutable")
                .body(bytes);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PatchMapping("/images/{id}")
    public ResponseEntity<?> rename(@PathVariable String id, @RequestBody RenameRequest request) {
        try {
            return ResponseEntity.ok(images.rename(request.profileId(), id, request.name()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/images/{id}")
    public ResponseEntity<?> remove(@PathVariable String id, @RequestParam String profileId) {
        try {
            images.remove(profileId, id);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Deletes every screenshot a profile has saved -- called when the company profile itself is deleted. */
    @DeleteMapping("/images/profile/{profileId}")
    public ResponseEntity<?> removeProfile(@PathVariable String profileId) {
        try {
            images.deleteProfile(profileId);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
