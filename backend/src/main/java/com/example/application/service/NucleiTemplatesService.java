package com.example.application.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * Write access to the shared nuclei-templates directory (data/nuclei-templates on the host, read-write on the
 * backend and on nuclei-worker -- see docker-compose.yml). Not per profile, same as WordlistService.
 *
 * Until now the only way to populate this directory was dropping files into it on the host directly (see
 * docker-compose.yml's own comment on nuclei-worker's volumes:); the [ file ] menu's "Upload Nuclei Templates"
 * folder picker (menu.js) is a second, in-app way to do the same thing, one call per file in the chosen
 * folder (see NucleiTemplatesController#upload). There is no read/list API here -- nothing in the app browses
 * this directory from the backend side; nuclei-worker reads it directly off disk.
 */
@Service
public class NucleiTemplatesService {
    private final SafeDirectoryPath safePath;

    public NucleiTemplatesService(@Value("${nuclei-templates.directory:../data/nuclei-templates}") String directory) {
        this.safePath = new SafeDirectoryPath(Path.of(directory));
    }

    /** Same contract as WordlistService#upload: overwrites an existing file at the same relative path. */
    public void upload(String relativePath, InputStream content) throws IOException {
        Path target = safePath.resolveInside(relativePath, false);
        Files.createDirectories(target.getParent());
        try (content) {
            Files.copy(content, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
