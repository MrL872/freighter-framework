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
import java.util.Set;
import java.util.UUID;
import java.util.LinkedHashSet;
import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * Filesystem-backed storage for Project Folder (frontend projectFolder.js),
 * scoped per company profile. Each file is stored at
 * "<project-storage.directory>/<profileId>/<name>". ProjectFileStager resolves
 * worker input files against the same directory, so workers read the saved
 * files directly.
 *
 * Per-profile metadata (id, format, kind, worker, timestamps -- everything
 * that isn't the file's own bytes) lives in a ".index.json" sidecar file
 * alongside the real files in that profile's directory. A file's on-disk
 * name is its display name, so names must be unique per profile. save() and
 * rename() reject a collision rather than overwriting an existing entry. The
 * UI generates timestamp- or uid-based names, so collisions are rare.
 */
@Service
public class ProjectFileService {
    private static final int MAX_FILES = 200; // maximum number of files per profile
    private static final String INDEX_FILE = ".index.json";

    private final Path root;
    private final Set<String> allowedExtensions;
    private final long maxFileBytes;
    private final ObjectMapper mapper = new ObjectMapper();

    public ProjectFileService(@Value("${project-storage.directory:../data/project-storage}") String directory,
                              @Value("${project-storage.allowed-extensions:txt,md,json,jsonl,xml,csv,html,sqlite,sqlite3,db,yaml,yml,js,ini,log,sarif,har,nmap,gnmap}") String extensions,
                              @Value("${project-storage.max-file-bytes:1048576}") long maxFileBytes) {
        this.root = Path.of(directory).toAbsolutePath().normalize();
        this.allowedExtensions = Arrays.stream(extensions.split(","))
            .map(ext -> ext.trim().toLowerCase(Locale.ROOT))
            .filter(ext -> !ext.isEmpty())
            .collect(Collectors.toCollection(LinkedHashSet::new));
        this.maxFileBytes = maxFileBytes;
    }

    public record Entry(String id, String name, String format, String kind, String worker, String savedAt, String updatedAt) {}

    public List<Map<String, Object>> list(String profileId) {
        Path dir = profileDir(profileId);
        List<Entry> index = readIndex(dir);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Entry entry : index) {
            Map<String, Object> row = toMap(entry);
            row.put("content", readContentQuietly(dir, entry.name()));
            result.add(row);
        }
        return result;
    }

    public Map<String, Object> save(String profileId, String name, String content, String format, String kind, String worker) {
        String safeName = requireSafeSegment(name, "file name");
        requireAllowed(safeName, content);
        Path dir = profileDir(profileId);
        List<Entry> index = readIndex(dir);
        if (index.stream().anyMatch(e -> e.name().equals(safeName))) {
            throw new IllegalArgumentException("A file named \"" + name + "\" already exists in this profile's Project Folder");
        }
        String now = Instant.now().toString();
        Entry entry = new Entry(UUID.randomUUID().toString(), safeName, format, kind, worker, now, null);
        writeContent(dir, safeName, content);
        index.add(entry);
        evictOldest(dir, index);
        writeIndex(dir, index);
        Map<String, Object> row = toMap(entry);
        row.put("content", content);
        return row;
    }

    /**
     * Like save(), but for WorkerOutputStager's automatic staging path only: a run that
     * reuses the same -o-style filename as an earlier run overwrites that earlier file's
     * content in place (its id and original savedAt are kept; only updatedAt and content
     * change) instead of save()'s usual reject-on-collision -- the same behavior -o has on
     * a real filesystem, where re-running a tool with the same output path just overwrites
     * it. Manual Project Folder writes (the "Save to Project's Folder" button, imports,
     * renames) still go through save()/rename(), which keep rejecting a collision so a
     * user-named file is never silently clobbered by something else reusing its name.
     */
    public Map<String, Object> saveOrReplace(String profileId, String name, String content, String format, String kind, String worker) {
        String safeName = requireSafeSegment(name, "file name");
        requireAllowed(safeName, content);
        Path dir = profileDir(profileId);
        List<Entry> index = readIndex(dir);
        int i = indexOfName(index, safeName);
        writeContent(dir, safeName, content);
        Entry entry;
        if (i >= 0) {
            Entry existing = index.get(i);
            entry = new Entry(existing.id(), safeName, format, kind, worker, existing.savedAt(), Instant.now().toString());
            index.set(i, entry);
        } else {
            entry = new Entry(UUID.randomUUID().toString(), safeName, format, kind, worker, Instant.now().toString(), null);
            index.add(entry);
            evictOldest(dir, index);
        }
        writeIndex(dir, index);
        Map<String, Object> row = toMap(entry);
        row.put("content", content);
        return row;
    }

    public Map<String, Object> rename(String profileId, String id, String newName) {
        String safeNewName = requireSafeSegment(newName, "file name");
        requireAllowed(safeNewName, null);
        Path dir = profileDir(profileId);
        List<Entry> index = readIndex(dir);
        int i = indexOf(index, id);
        Entry entry = index.get(i);
        if (!entry.name().equals(safeNewName) && index.stream().anyMatch(e -> e.name().equals(safeNewName))) {
            throw new IllegalArgumentException("A file named \"" + newName + "\" already exists in this profile's Project Folder");
        }
        try {
            Files.move(dir.resolve(entry.name()), dir.resolve(safeNewName));
        } catch (IOException e) {
            throw new IllegalStateException("Could not rename the file: " + e.getMessage(), e);
        }
        Entry renamed = new Entry(entry.id(), safeNewName, entry.format(), entry.kind(), entry.worker(), entry.savedAt(), entry.updatedAt());
        index.set(i, renamed);
        writeIndex(dir, index);
        Map<String, Object> row = toMap(renamed);
        row.put("content", readContentQuietly(dir, safeNewName));
        return row;
    }

    public Map<String, Object> updateContent(String profileId, String id, String content) {
        Path dir = profileDir(profileId);
        List<Entry> index = readIndex(dir);
        int i = indexOf(index, id);
        Entry entry = index.get(i);
        requireAllowed(entry.name(), content);
        writeContent(dir, entry.name(), content);
        Entry updated = new Entry(entry.id(), entry.name(), entry.format(), entry.kind(), entry.worker(), entry.savedAt(), Instant.now().toString());
        index.set(i, updated);
        writeIndex(dir, index);
        Map<String, Object> row = toMap(updated);
        row.put("content", content);
        return row;
    }

    public void remove(String profileId, String id) {
        Path dir = profileDir(profileId);
        List<Entry> index = readIndex(dir);
        int i = indexOf(index, id);
        Entry entry = index.remove(i);
        try {
            Files.deleteIfExists(dir.resolve(entry.name()));
        } catch (IOException e) {
            throw new IllegalStateException("Could not delete the file: " + e.getMessage(), e);
        }
        writeIndex(dir, index);
    }

    /**
     * Deletes a whole profile's Project Folder directory (every saved file
     * plus its index) -- called when a company profile itself is deleted,
     * so its files don't linger on disk forever with no UI left that can
     * ever address them again. A no-op if the profile never saved anything
     * here (nothing to delete).
     */
    public void deleteProfile(String profileId) {
        String safe = requireSafeSegment(profileId, "profileId");
        Path dir = root.resolve(safe).normalize();
        if (!dir.startsWith(root)) {
            throw new IllegalArgumentException("Invalid profile id");
        }
        deleteRecursively(dir);
    }

    // ---- internals ----

    private static void deleteRecursively(Path dir) {
        if (!Files.isDirectory(dir)) return;
        try (var stream = Files.walk(dir)) {
            stream.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try { Files.delete(p); } catch (IOException ignored) { /* best-effort */ }
            });
        } catch (IOException e) {
            throw new IllegalStateException("Could not delete profile storage: " + e.getMessage(), e);
        }
    }

    private Path profileDir(String profileId) {
        String safe = requireSafeSegment(profileId, "profileId");
        Path dir = root.resolve(safe).normalize();
        if (!dir.startsWith(root)) {
            throw new IllegalArgumentException("Invalid profile id");
        }
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new IllegalStateException("Could not create Project Folder storage: " + e.getMessage(), e);
        }
        return dir;
    }

    private List<Entry> readIndex(Path dir) {
        Path indexPath = dir.resolve(INDEX_FILE);
        if (!Files.exists(indexPath)) return new ArrayList<>();
        try {
            String raw = Files.readString(indexPath, StandardCharsets.UTF_8);
            List<Entry> entries = mapper.readValue(raw, new TypeReference<List<Entry>>() {});
            return new ArrayList<>(entries);
        } catch (IOException | JacksonException e) {
            throw new IllegalStateException("Project Folder index is corrupted: " + e.getMessage(), e);
        }
    }

    private void writeIndex(Path dir, List<Entry> index) {
        try {
            Files.writeString(dir.resolve(INDEX_FILE), mapper.writeValueAsString(index), StandardCharsets.UTF_8);
        } catch (IOException | JacksonException e) {
            throw new IllegalStateException("Could not save Project Folder index: " + e.getMessage(), e);
        }
    }

    private void writeContent(Path dir, String name, String content) {
        try {
            Files.writeString(dir.resolve(name), content == null ? "" : content, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Could not write " + name + ": " + e.getMessage(), e);
        }
    }

    private String readContentQuietly(Path dir, String name) {
        try {
            return Files.readString(dir.resolve(name), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return ""; // file missing/unreadable -- surface an empty body rather than failing the whole list
        }
    }

    // Oldest-first eviction once past MAX_FILES, so a profile's Project Folder
    // can't grow without bound.
    private void evictOldest(Path dir, List<Entry> index) {
        while (index.size() > MAX_FILES) {
            Entry oldest = index.remove(0);
            try {
                Files.deleteIfExists(dir.resolve(oldest.name()));
            } catch (IOException ignored) {
                // best-effort eviction; a leftover file here isn't worth failing the save over
            }
        }
    }

    private static int indexOf(List<Entry> index, String id) {
        for (int i = 0; i < index.size(); i++) {
            if (index.get(i).id().equals(id)) return i;
        }
        throw new IllegalArgumentException("File not found: " + id);
    }

    /** -1 when no entry has this name, unlike indexOf(id) -- saveOrReplace() uses that to tell "overwrite" from "create new" apart. */
    private static int indexOfName(List<Entry> index, String name) {
        for (int i = 0; i < index.size(); i++) {
            if (index.get(i).name().equals(name)) return i;
        }
        return -1;
    }

    private static Map<String, Object> toMap(Entry entry) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", entry.id());
        row.put("name", entry.name());
        row.put("format", entry.format());
        row.put("kind", entry.kind());
        row.put("worker", entry.worker());
        row.put("savedAt", entry.savedAt());
        row.put("updatedAt", entry.updatedAt());
        return row;
    }

    // Project Folder keeps only the file types listed in project-storage.allowed-extensions,
    // and content no larger than project-storage.max-file-bytes (counted as UTF-8 bytes).
    private void requireAllowed(String name, String content) {
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
        if (!allowedExtensions.contains(ext)) {
            throw new IllegalArgumentException("Unsupported file type for \"" + name + "\" (allowed: "
                + String.join(", ", allowedExtensions) + ")");
        }
        long bytes = content == null ? 0 : content.getBytes(StandardCharsets.UTF_8).length;
        if (bytes > maxFileBytes) {
            throw new IllegalArgumentException("\"" + name + "\" is " + bytes + " bytes; the limit is "
                + maxFileBytes / 1024 + " KB");
        }
    }

    private static String requireSafeSegment(String value, String label) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(label + " is required");
        }
        if (value.contains("/") || value.contains("\\") || value.contains("..") || value.contains("\0")
            || value.equals(INDEX_FILE)) {
            throw new IllegalArgumentException("Invalid " + label);
        }
        return value;
    }
}
