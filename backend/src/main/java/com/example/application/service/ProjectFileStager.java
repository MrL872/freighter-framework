package com.example.application.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Bridges Project Folder (frontend/public/js/projectFolder.js) to the
 * worker containers: every *RunService that accepts an isFile-marked flag
 * calls resolve() here before building argv, turning a bare file name into
 * the absolute path a worker container can actually read.
 *
 * Project Folder's storage (see ProjectFileService) and the directory worker
 * containers mount read-only (see docker-compose.yml's project-storage volume)
 * are the same directory. A saved file is already at
 * "<project-storage.directory>/<profileId>/<name>", so this class does not copy
 * anything. It validates the requested name against path traversal and checks
 * that the file exists before returning its path.
 */
@Service
public class ProjectFileStager {
    private final Path storageRoot;
    private final WordlistService wordlists;
    private final ConfigsService configs;

    public ProjectFileStager(@Value("${project-storage.directory:../data/project-storage}") String storageDirectory,
                             WordlistService wordlists, ConfigsService configs) {
        this.storageRoot = Path.of(storageDirectory).toAbsolutePath().normalize();
        this.wordlists = wordlists;
        this.configs = configs;
    }

    /**
     * Returns the absolute path of the named Project Folder file, as a
     * worker container sees it. profileId and name are both
     * attacker-reachable -- both are validated against path traversal
     * before touching the filesystem, and the resolved path is verified to
     * still land under storageRoot.
     *
     * A name starting with "wordlists/" is a file picked from the shared
     * wordlists directory instead (see WordlistService), and one starting
     * with "configs/" is a file picked from the shared configs directory
     * (see ConfigsService). A Project Folder name can never contain "/", so
     * none of these forms can collide.
     *
     * A value may end in ":KEYWORD", as ffuf's -w takes it ("wordlists/list.txt:FUZZ").
     * The suffix is split off before the file is looked up and added back to the
     * resolved path, so the file check stays strict. Both forms accept it.
     */
    public String resolve(String profileId, String name) {
        if (name == null) {
            return resolvePath(profileId, null);
        }
        int colon = name.indexOf(':');
        if (colon < 0) {
            return resolvePath(profileId, name);
        }
        String keywordSuffix = name.substring(colon);
        if (!keywordSuffix.matches(":[A-Za-z0-9_]+")) {
            throw new IllegalArgumentException("Invalid keyword after file name");
        }
        return resolvePath(profileId, name.substring(0, colon)) + keywordSuffix;
    }

    private String resolvePath(String profileId, String name) {
        if (name != null && name.startsWith(WordlistService.PREFIX)) {
            return wordlists.resolve(name.substring(WordlistService.PREFIX.length()));
        }
        if (name != null && name.startsWith(ConfigsService.PREFIX)) {
            return configs.resolve(name.substring(ConfigsService.PREFIX.length()));
        }
        String safeProfileId = requireSafeSegment(profileId, "profileId");
        String safeName = requireSafeSegment(name, "file name");

        Path profileDir = storageRoot.resolve(safeProfileId).normalize();
        if (!profileDir.startsWith(storageRoot)) {
            throw new IllegalArgumentException("Invalid profile id");
        }
        Path target = profileDir.resolve(safeName).normalize();
        if (!target.startsWith(profileDir)) {
            throw new IllegalArgumentException("Invalid file name");
        }
        if (!Files.isRegularFile(target)) {
            throw new IllegalArgumentException("File not found in Project Folder: " + name);
        }
        return target.toString();
    }

    private static String requireSafeSegment(String value, String label) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(label + " is required");
        }
        if (value.contains("/") || value.contains("\\") || value.contains("..") || value.contains("\0")) {
            throw new IllegalArgumentException("Invalid " + label);
        }
        return value;
    }
}
