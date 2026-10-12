package com.example.application.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

/**
 * Access to the shared wordlists directory (data/wordlists on the host, read-write on the backend, read-only
 * on every tool worker at /data/wordlists -- see docker-compose.yml). Unlike Project Folder, this directory is
 * not per profile and may contain subfolders, so the browser in the control panel (wordlistBrowser.js) can
 * walk it, and the [ file ] menu's "Upload Wordlists" option (menu.js) can add a whole folder to it at once.
 *
 * Every path is relative to the root. Traversal is rejected lexically, and the real path of each target must
 * still land under the root, so a symlink cannot point a caller outside the directory -- see SafeDirectoryPath.
 */
@Service
public class WordlistService {
    /** Prefix the frontend puts in front of a picked wordlist, so ProjectFileStager can tell it apart from a Project Folder name. */
    public static final String PREFIX = "wordlists/";

    public record Entry(String name, String type, long size) {}
    public record Listing(String path, List<Entry> entries) {}

    private final SafeDirectoryPath safePath;

    public WordlistService(@Value("${wordlists.directory:../data/wordlists}") String directory) {
        this.safePath = new SafeDirectoryPath(Path.of(directory));
    }

    /** Lists one folder below the root. An empty path means the root itself. Dot-files are hidden. */
    public Listing list(String relativePath) {
        Path dir = safePath.resolveInside(relativePath, true);
        if (!Files.isDirectory(dir)) {
            throw new IllegalArgumentException("Not a folder in wordlists: " + relativePath);
        }
        try (Stream<Path> children = Files.list(dir)) {
            List<Entry> entries = children
                .filter(p -> !p.getFileName().toString().startsWith("."))
                .filter(safePath::isInsideRoot)
                .filter(p -> Files.isDirectory(p) || Files.isRegularFile(p))
                .map(p -> new Entry(
                    p.getFileName().toString(),
                    Files.isDirectory(p) ? "dir" : "file",
                    Files.isDirectory(p) ? 0 : sizeOf(p)))
                .sorted(Comparator.comparing((Entry e) -> !e.type().equals("dir"))
                    .thenComparing(e -> e.name().toLowerCase()))
                .toList();
            return new Listing(safePath.root().relativize(dir).toString().replace('\\', '/'), entries);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /**
     * Returns the absolute path of a wordlist file, as the backend and workers see it. relativePath is the part
     * after the "wordlists/" prefix. The file must exist.
     */
    public String resolve(String relativePath) {
        Path file = safePath.resolveInside(relativePath, false);
        if (!Files.isRegularFile(file)) {
            throw new IllegalArgumentException("Wordlist not found: " + relativePath);
        }
        return file.toString();
    }

    /**
     * Writes one uploaded file under the wordlists root, creating any missing parent folders -- used by the
     * [ file ] menu's "Upload Wordlists" folder picker, one call per file in the chosen folder (see
     * WordlistsController#upload). relativePath is the file's path within that folder, preserving whatever
     * subfolder structure it had on the host. Overwrites an existing file at the same path.
     */
    public void upload(String relativePath, InputStream content) throws IOException {
        Path target = safePath.resolveInside(relativePath, false);
        Files.createDirectories(target.getParent());
        try (content) {
            Files.copy(content, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static long sizeOf(Path p) {
        try {
            return Files.size(p);
        } catch (IOException e) {
            return 0;
        }
    }
}
