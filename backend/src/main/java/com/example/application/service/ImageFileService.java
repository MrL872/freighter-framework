package com.example.application.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Filesystem-backed storage for Image Storage (frontend imageFolder.js),
 * scoped per company profile and, within that, per scanned target. Each
 * image is a real file under
 * "<image-storage.directory>/<profileId>/<targetSlug>/<id>.<format>" --
 * or, for an entry with no resolved target (every entry saved before
 * per-target folders existed, plus any future screenshot whose target
 * genuinely can't be resolved), directly under
 * "<image-storage.directory>/<profileId>/<id>.<format>", same as before
 * this split existed; the UI groups those under an "Unsorted" bucket. Files
 * are stored on disk rather than in the database, so they are not limited
 * by PreferencesController's 64KB-per-value cap.
 *
 * Per-profile metadata (id, name, format, kind, target, endpoint,
 * timestamps) lives in one ".index.json" sidecar directly under the
 * profile directory (not per-target), same convention as
 * ProjectFileService -- target/endpoint on each entry is what decides its
 * actual on-disk subfolder (see imagePath()), not the index's own location.
 * Raw image bytes are served to the browser through ImagesController's
 * content endpoint, not embedded in this service's list() response. The
 * frontend points an <img> tag straight at that endpoint instead of
 * decoding a data: URL.
 */
@Service
public class ImageFileService {
    private static final int MAX_FILES = 200; // mirrors imageFolder.js's own cap
    private static final String INDEX_FILE = ".index.json";

    private final Path root;
    private final ObjectMapper mapper = new ObjectMapper();

    public ImageFileService(@Value("${image-storage.directory:../data/image-storage}") String directory) {
        this.root = Path.of(directory).toAbsolutePath().normalize();
    }

    public record Entry(String id, String name, String format, String kind, String target, String endpoint, String savedAt) {}

    public List<Map<String, Object>> list(String profileId) {
        List<Entry> index = readIndex(profileDir(profileId));
        List<Map<String, Object>> result = new ArrayList<>();
        for (Entry entry : index) result.add(toMap(entry));
        return result;
    }

    /**
     * Writes rawBytes to disk under target's own subfolder (gowitness-worker resolves target from its
     * own --write-jsonl report -- see GowitnessRelayHandler) and appends a matching entry. target may be
     * null/blank when gowitness couldn't resolve the screenshot's real URL; the entry then has no target
     * (surfaces as "Unsorted" in the UI) and its file sits directly under the profile directory, same as
     * every entry saved before per-target folders existed. Returns the new entry's metadata (no content).
     */
    public Map<String, Object> save(String profileId, String target, String endpoint, String name, String format, byte[] rawBytes) {
        Path profileDir = profileDir(profileId);
        List<Entry> index = readIndex(profileDir);
        String safeFormat = (format == null || format.isBlank()) ? "png" : format.toLowerCase();
        if (safeFormat.contains("/") || safeFormat.contains("\\") || safeFormat.contains("..")) {
            throw new IllegalArgumentException("Invalid image format");
        }
        String id = UUID.randomUUID().toString();
        String slug = targetSlug(target);
        Entry entry = new Entry(id, (name == null || name.isBlank()) ? "screenshot" : name, safeFormat, "gowitness",
            slug, blankToNull(endpoint), Instant.now().toString());
        Path dir = targetDir(profileDir, slug);
        try {
            Files.createDirectories(dir);
            Files.write(dir.resolve(id + "." + safeFormat), rawBytes);
        } catch (IOException e) {
            throw new IllegalStateException("Could not save image: " + e.getMessage(), e);
        }
        index.add(entry);
        evictOldest(profileDir, index);
        writeIndex(profileDir, index);
        return toMap(entry);
    }

    public Map<String, Object> rename(String profileId, String id, String newName) {
        String safeName = requireNonBlank(newName, "file name");
        Path dir = profileDir(profileId);
        List<Entry> index = readIndex(dir);
        int i = indexOf(index, id);
        Entry entry = index.get(i);
        Entry renamed = new Entry(entry.id(), safeName, entry.format(), entry.kind(), entry.target(), entry.endpoint(), entry.savedAt());
        index.set(i, renamed);
        writeIndex(dir, index);
        return toMap(renamed);
    }

    public void remove(String profileId, String id) {
        Path profileDir = profileDir(profileId);
        List<Entry> index = readIndex(profileDir);
        int i = indexOf(index, id);
        Entry entry = index.remove(i);
        try {
            Files.deleteIfExists(imagePath(profileDir, entry));
        } catch (IOException e) {
            throw new IllegalStateException("Could not delete the image: " + e.getMessage(), e);
        }
        writeIndex(profileDir, index);
    }

    /**
     * Deletes a whole profile's Image Storage directory (every screenshot
     * plus its index) -- called when a company profile itself is deleted,
     * same reasoning as ProjectFileService.deleteProfile. A no-op if the
     * profile never had any screenshots saved here.
     */
    public void deleteProfile(String profileId) {
        String safe = requireNonBlank(profileId, "profileId");
        if (safe.contains("/") || safe.contains("\\") || safe.contains("..") || safe.contains("\0")) {
            throw new IllegalArgumentException("Invalid profileId");
        }
        Path dir = root.resolve(safe).normalize();
        if (!dir.startsWith(root)) {
            throw new IllegalArgumentException("Invalid profile id");
        }
        if (!Files.isDirectory(dir)) return;
        try (var stream = Files.walk(dir)) {
            stream.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try { Files.delete(p); } catch (IOException ignored) { /* best-effort */ }
            });
        } catch (IOException e) {
            throw new IllegalStateException("Could not delete profile storage: " + e.getMessage(), e);
        }
    }

    /** Raw bytes + format for ImagesController's content endpoint, or null if the id doesn't exist. */
    public byte[] readContent(String profileId, String id) {
        Path profileDir = profileDir(profileId);
        Entry entry = readIndex(profileDir).stream().filter(e -> e.id().equals(id)).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Image not found: " + id));
        try {
            return Files.readAllBytes(imagePath(profileDir, entry));
        } catch (IOException e) {
            throw new IllegalStateException("Could not read image: " + e.getMessage(), e);
        }
    }

    public String formatOf(String profileId, String id) {
        Path dir = profileDir(profileId);
        return readIndex(dir).stream().filter(e -> e.id().equals(id)).findFirst()
            .map(Entry::format)
            .orElseThrow(() -> new IllegalArgumentException("Image not found: " + id));
    }

    // ---- internals ----

    private Path profileDir(String profileId) {
        String safe = requireNonBlank(profileId, "profileId");
        if (safe.contains("/") || safe.contains("\\") || safe.contains("..") || safe.contains("\0")) {
            throw new IllegalArgumentException("Invalid profileId");
        }
        Path dir = root.resolve(safe).normalize();
        if (!dir.startsWith(root)) {
            throw new IllegalArgumentException("Invalid profile id");
        }
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new IllegalStateException("Could not create Image Storage: " + e.getMessage(), e);
        }
        return dir;
    }

    private List<Entry> readIndex(Path dir) {
        Path indexPath = dir.resolve(INDEX_FILE);
        if (!Files.exists(indexPath)) return new ArrayList<>();
        try {
            String raw = Files.readString(indexPath, StandardCharsets.UTF_8);
            return new ArrayList<>(mapper.readValue(raw, new TypeReference<List<Entry>>() {}));
        } catch (IOException | JacksonException e) {
            throw new IllegalStateException("Image Storage index is corrupted: " + e.getMessage(), e);
        }
    }

    private void writeIndex(Path dir, List<Entry> index) {
        try {
            Files.writeString(dir.resolve(INDEX_FILE), mapper.writeValueAsString(index), StandardCharsets.UTF_8);
        } catch (IOException | JacksonException e) {
            throw new IllegalStateException("Could not save Image Storage index: " + e.getMessage(), e);
        }
    }

    private void evictOldest(Path profileDir, List<Entry> index) {
        while (index.size() > MAX_FILES) {
            Entry oldest = index.remove(0);
            try {
                Files.deleteIfExists(imagePath(profileDir, oldest));
            } catch (IOException ignored) {
                // best-effort eviction
            }
        }
    }

    private static int indexOf(List<Entry> index, String id) {
        for (int i = 0; i < index.size(); i++) {
            if (index.get(i).id().equals(id)) return i;
        }
        throw new IllegalArgumentException("Image not found: " + id);
    }

    private static Map<String, Object> toMap(Entry entry) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", entry.id());
        row.put("name", entry.name());
        row.put("format", entry.format());
        row.put("kind", entry.kind());
        row.put("target", entry.target());
        row.put("endpoint", entry.endpoint());
        row.put("savedAt", entry.savedAt());
        return row;
    }

    private static String requireNonBlank(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value;
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value;
    }

    /**
     * Turns a screenshot's resolved target (gowitness-worker's own
     * "target" field, a bare host like "vulnlab" -- see
     * GowitnessRelayHandler) into a filesystem-safe folder name, or null
     * when there's nothing usable to slug: a blank/missing target (the
     * worker couldn't resolve the screenshot's real URL), or one that
     * collapses to nothing once unsafe characters are stripped. null here
     * is what keeps an entry's file directly under the profile directory
     * (see imagePath()) and groups it under the UI's "Unsorted" bucket,
     * the same place every entry saved before per-target folders existed
     * already lives.
     */
    private static String targetSlug(String target) {
        if (target == null) return null;
        String slug = target.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9._-]+", "-");
        slug = slug.replaceAll("-{2,}", "-").replaceAll("^-+|-+$", "");
        if (slug.isBlank() || slug.equals(".") || slug.equals("..")) return null;
        return slug;
    }

    /** The directory a screenshot's own file lives in: profileDir itself when slug is null, else its slug subfolder. */
    private Path targetDir(Path profileDir, String slug) {
        return slug == null ? profileDir : profileDir.resolve(slug);
    }

    /** Resolves an entry's actual on-disk file path, in its own target subfolder or directly under profileDir -- see targetSlug(). */
    private Path imagePath(Path profileDir, Entry entry) {
        return targetDir(profileDir, entry.target()).resolve(entry.id() + "." + entry.format());
    }
}
