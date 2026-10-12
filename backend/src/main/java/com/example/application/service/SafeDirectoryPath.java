package com.example.application.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Lexical + real-path containment check shared by every service that resolves a caller-supplied relative
 * path against a fixed root directory (WordlistService, NucleiTemplatesService): traversal ("..", a leading
 * "/", a drive letter, a dot-segment) is rejected before the path is even resolved, and the resolved path's
 * real path must still land under the root's real path, so a symlink inside the root cannot point a caller
 * outside it either.
 *
 * Originally WordlistService's own private resolveInside/isInsideRoot, pulled out here once a second service
 * (NucleiTemplatesService) needed the identical check -- this is security-sensitive logic, so it has exactly
 * one implementation rather than two copies that could drift out of sync.
 */
public final class SafeDirectoryPath {
    private final Path root;

    public SafeDirectoryPath(Path root) {
        this.root = root.toAbsolutePath().normalize();
    }

    public Path root() {
        return root;
    }

    /** Resolves relativePath against the root. allowRoot=false also rejects the root path itself (e.g. "no name given"). */
    public Path resolveInside(String relativePath, boolean allowRoot) {
        String rel = relativePath == null ? "" : relativePath.replace('\\', '/');
        if (rel.contains("\0") || rel.startsWith("/") || rel.contains(":")) {
            throw new IllegalArgumentException("Invalid path");
        }
        for (String segment : rel.split("/")) {
            if (segment.equals("..") || segment.startsWith(".")) {
                throw new IllegalArgumentException("Invalid path");
            }
        }
        if (rel.isEmpty() && !allowRoot) {
            throw new IllegalArgumentException("A name is required");
        }
        Path target = root.resolve(rel).normalize();
        if (!target.startsWith(root) || (!allowRoot && target.equals(root))) {
            throw new IllegalArgumentException("Invalid path");
        }
        if (Files.exists(target) && !isInsideRoot(target)) {
            throw new IllegalArgumentException("Invalid path");
        }
        return target;
    }

    public boolean isInsideRoot(Path p) {
        try {
            return p.toRealPath().startsWith(root.toRealPath());
        } catch (IOException e) {
            return false;
        }
    }
}
