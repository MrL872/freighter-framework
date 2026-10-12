package com.example.application.service;

import org.springframework.stereotype.Service;

import java.util.Base64;

/**
 * Thin adapter between a WS relay's "screenshot" frame (which carries a
 * full "data:image/...;base64,..." URL, see GowitnessRelayHandler) and
 * ImageFileService, the actual filesystem-backed store -- decodes the data
 * URL into raw bytes once here, so GowitnessRelayHandler's call site only
 * deals with the frame and never with the file storage details.
 */
@Service
public class ImageStorageService {
    private final ImageFileService images;

    public ImageStorageService(ImageFileService images) {
        this.images = images;
    }

    /**
     * Saves one screenshot to profileId's Image Storage, under target's own subfolder (see
     * ImageFileService#save). target and endpoint come straight from gowitness-worker's "screenshot"
     * frame -- resolved from its own --write-jsonl report, blank when unresolved (see
     * GowitnessRelayHandler and emitScreenshots in gowitness-worker/main.go). contentDataUrl must
     * already be a full "data:image/...;base64,..." URL. Silently no-ops on a blank profileId or
     * content (there is nowhere to store the entry, or nothing to store) rather than throwing, since
     * callers (a WS relay loop) shouldn't have one failed screenshot abort a run.
     */
    public void save(String profileId, String target, String endpoint, String name, String format, String contentDataUrl) {
        if (profileId == null || profileId.isBlank() || contentDataUrl == null || contentDataUrl.isBlank()) {
            return;
        }
        int comma = contentDataUrl.indexOf(',');
        if (comma < 0) return; // not a well-formed data: URL -- nothing usable to decode
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(contentDataUrl.substring(comma + 1));
        } catch (IllegalArgumentException e) {
            return; // malformed base64 -- drop this one frame rather than fail the whole run
        }
        images.save(profileId, target, endpoint, name, format, bytes);
    }
}
