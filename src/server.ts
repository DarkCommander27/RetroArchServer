import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { FRONTEND_ASSET_PACKS, syncFrontendAssets, syncPlaylistThumbnails } from "./assetSync";
import { loadConfig } from "./config";
import {
  THUMBNAIL_KINDS,
  buildLibrarySummary,
  createPlaylist,
  ensureExampleLibrary,
  findEntryById,
  importPlaylistFile,
  importRomToPlaylist,
  makeLaunchCommand,
  removePlaylistEntry,
  upsertPlaylistEntry
} from "./retroarch";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function main(): Promise<void> {
  const config = loadConfig();
  await ensureExampleLibrary(config.retroarchRoot);

  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 1024 * 1024 * 1024
    }
  });

  app.use(express.json({ limit: "20mb" }));

  app.use(express.static(config.staticRoot));

  app.get("/api/options", async (_request, response, next) => {
    try {
      const library = await buildLibrarySummary(config);
      response.json({
        frontendAssetPacks: FRONTEND_ASSET_PACKS,
        thumbnailKinds: THUMBNAIL_KINDS,
        playlists: library.playlists.map((playlist) => playlist.name)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/library", async (_request, response, next) => {
    try {
      const summary = await buildLibrarySummary(config);
      response.json(summary);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/roms/:entryId", async (request, response, next) => {
    try {
      const summary = await buildLibrarySummary(config);
      const entry = findEntryById(summary, request.params.entryId);

      if (!entry) {
        response.status(404).json({ error: "ROM entry not found." });
        return;
      }

      response.download(entry.romPath, path.basename(entry.romPath));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/launch/:entryId", async (request, response, next) => {
    try {
      const summary = await buildLibrarySummary(config);
      const entry = findEntryById(summary, request.params.entryId);

      if (!entry) {
        response.status(404).json({ error: "ROM entry not found." });
        return;
      }

      response.json({ command: makeLaunchCommand(entry) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/thumbnails/:playlist/:kind/:fileName", async (request, response, next) => {
    try {
      const playlistName = decodeURIComponent(request.params.playlist);
      const kind = request.params.kind;
      const fileName = decodeURIComponent(request.params.fileName);
      const thumbnailPath = path.join(config.thumbnailsRoot, playlistName, kind, fileName);

      await fs.access(thumbnailPath);
      response.sendFile(thumbnailPath);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/playlists", async (request, response, next) => {
    try {
      const name = asString(request.body?.name);

      if (!name) {
        response.status(400).json({ error: "Playlist name is required." });
        return;
      }

      const result = await createPlaylist(config.playlistsRoot, name);
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/playlists/:playlistName/entries", async (request, response, next) => {
    try {
      const playlistName = request.params.playlistName;
      const pathValue = asString(request.body?.path);
      const label = asString(request.body?.label);

      if (!pathValue || !label) {
        response.status(400).json({ error: "Entry path and label are required." });
        return;
      }

      const item = await upsertPlaylistEntry(config.playlistsRoot, playlistName, {
        path: pathValue,
        label,
        core_path: asString(request.body?.corePath),
        core_name: asString(request.body?.coreName),
        crc32: asString(request.body?.crc32),
        db_name: asString(request.body?.dbName)
      });

      response.status(201).json(item);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/playlists/:playlistName/entries/:entryId", async (request, response, next) => {
    try {
      const summary = await buildLibrarySummary(config);
      const existingEntry = findEntryById(summary, request.params.entryId);

      if (!existingEntry) {
        response.status(404).json({ error: "Playlist entry not found." });
        return;
      }

      const pathValue = asString(request.body?.path);
      const label = asString(request.body?.label);

      if (!pathValue || !label) {
        response.status(400).json({ error: "Entry path and label are required." });
        return;
      }

      const item = await upsertPlaylistEntry(
        config.playlistsRoot,
        request.params.playlistName,
        {
          path: pathValue,
          label,
          core_path: asString(request.body?.corePath),
          core_name: asString(request.body?.coreName),
          crc32: asString(request.body?.crc32),
          db_name: asString(request.body?.dbName)
        },
        existingEntry.relativeRomPath
      );

      response.json(item);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/playlists/:playlistName/entries/:entryId", async (request, response, next) => {
    try {
      const summary = await buildLibrarySummary(config);
      const existingEntry = findEntryById(summary, request.params.entryId);

      if (!existingEntry) {
        response.status(404).json({ error: "Playlist entry not found." });
        return;
      }

      const removed = await removePlaylistEntry(config.playlistsRoot, request.params.playlistName, existingEntry.relativeRomPath);

      if (!removed) {
        response.status(404).json({ error: "Playlist entry not found." });
        return;
      }

      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/import/playlist", upload.single("playlist"), async (request, response, next) => {
    try {
      const file = request.file;

      if (!file) {
        response.status(400).json({ error: "A playlist file is required." });
        return;
      }

      const result = await importPlaylistFile(config.playlistsRoot, file.originalname, file.buffer);
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/import/rom", upload.single("rom"), async (request, response, next) => {
    try {
      const file = request.file;
      const playlistName = asString(request.body?.playlistName);

      if (!file || !playlistName) {
        response.status(400).json({ error: "A ROM file and playlist name are required." });
        return;
      }

      const result = await importRomToPlaylist({
        retroarchRoot: config.retroarchRoot,
        romsRoot: config.romsRoot,
        playlistsRoot: config.playlistsRoot,
        playlistName,
        uploadedFileName: file.originalname,
        fileBuffer: file.buffer,
        label: asString(request.body?.label),
        relativeDirectory: asString(request.body?.relativeDirectory),
        corePath: asString(request.body?.corePath),
        coreName: asString(request.body?.coreName),
        crc32: asString(request.body?.crc32)
      });

      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sync/frontend-assets", async (request, response, next) => {
    try {
      const packs = asStringArray(request.body?.packs);
      const result = await syncFrontendAssets({
        baseUrl: config.frontendAssetsBaseUrl,
        destinationRoot: config.retroarchRoot,
        packs
      });

      response.json({ syncedAt: new Date().toISOString(), result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sync/thumbnails", async (request, response, next) => {
    try {
      const library = await buildLibrarySummary(config);
      const playlistNames = asStringArray(request.body?.playlistNames);
      const kinds = asStringArray(request.body?.kinds).filter((value): value is (typeof THUMBNAIL_KINDS)[number] =>
        THUMBNAIL_KINDS.includes(value as (typeof THUMBNAIL_KINDS)[number])
      );
      const result = await syncPlaylistThumbnails({
        baseUrl: config.thumbnailsBaseUrl,
        destinationRoot: config.thumbnailsRoot,
        playlistNames: playlistNames.length > 0 ? playlistNames : library.playlists.map((playlist) => playlist.name),
        kinds: kinds.length > 0 ? kinds : ["Named_Boxarts", "Named_Snaps", "Named_Titles"]
      });

      response.json({ syncedAt: new Date().toISOString(), result });
    } catch (error) {
      next(error);
    }
  });

  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(config.staticRoot, "index.html"));
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unexpected error";
    response.status(500).json({ error: message });
  });

  app.listen(config.port, config.host, () => {
    console.log(`RetroArch server listening on http://${config.host}:${config.port}`);
    console.log(`Playlists root: ${config.playlistsRoot}`);
    console.log(`Thumbnails root: ${config.thumbnailsRoot}`);
  });
}

void main();