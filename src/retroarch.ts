import fs from "node:fs/promises";
import path from "node:path";
import type { LibraryEntry, LibraryPlaylist, LibrarySummary, RetroArchEntryInput, RetroArchPlaylist, RetroArchPlaylistItem, ThumbnailKind } from "./types";

const THUMBNAIL_KINDS: ThumbnailKind[] = ["Named_Boxarts", "Named_Snaps", "Named_Titles", "Named_Logos"];
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".bmp", ".tga", ".webp"];
const PLAYLIST_VERSION = "1.5";
const INVALID_FILE_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

function getPlaylistPathModule(): typeof path.posix | typeof path.win32 {
  return process.platform === "win32" ? path.win32 : path.posix;
}

function ensureSafeWithinRoot(targetPath: string, rootPath: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes root: ${targetPath}`);
  }

  return resolvedTarget;
}

function sanitizeFileNameSegment(value: string): string {
  const sanitized = value.replace(INVALID_FILE_CHARS, "_").trim().replace(/[. ]+$/g, "");

  if (!sanitized) {
    throw new Error("A valid file name is required.");
  }

  return sanitized;
}

function normalizePlaylistName(name: string): string {
  const trimmed = name.trim().replace(/\.lpl$/i, "");
  return sanitizeFileNameSegment(trimmed);
}

function getPlaylistFileName(name: string): string {
  return `${normalizePlaylistName(name)}.lpl`;
}

function getPlaylistFilePath(playlistsRoot: string, playlistName: string): string {
  return ensureSafeWithinRoot(path.join(playlistsRoot, getPlaylistFileName(playlistName)), playlistsRoot);
}

function normalizeRelativePlaylistPath(value: string): string {
  const pathModule = getPlaylistPathModule();
  const normalized = pathModule.normalize(value.trim()).replace(/^([./\\])+/, "");

  if (!normalized || normalized === ".") {
    throw new Error("A valid playlist path is required.");
  }

  if (pathModule.isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error("Playlist paths must stay within the configured ROM root.");
  }

  return normalized;
}

function normalizeUploadedFileName(fileName: string): string {
  return sanitizeFileNameSegment(path.basename(fileName));
}

function normalizeEntryInput(entry: RetroArchEntryInput, defaultDbName: string): RetroArchPlaylistItem {
  return normalizeItem({
    path: entry.path,
    label: entry.label,
    core_path: entry.core_path ?? "DETECT",
    core_name: entry.core_name ?? "DETECT",
    crc32: entry.crc32 ?? "DETECT",
    db_name: entry.db_name ?? defaultDbName
  });
}

function sanitizeThumbnailBaseName(name: string): string {
  return name.replace(/[&*\/:<>?\\|]/g, "_");
}

function shortenLabel(name: string): string {
  return name.replace(/\s*[[(].*$/, "").trim();
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listPlaylistFiles(playlistsRoot: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(playlistsRoot, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".lpl"))
      .map((entry) => path.join(playlistsRoot, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readPlaylist(filePath: string): Promise<RetroArchPlaylist> {
  const contents = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(contents) as Partial<RetroArchPlaylist>;

  return {
    version: parsed.version ?? "1.0",
    items: Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : []
  };
}

async function writePlaylist(filePath: string, playlist: RetroArchPlaylist): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(playlist, null, 2)}\n`, "utf8");
}

function normalizeItem(item: Partial<RetroArchPlaylistItem>): RetroArchPlaylistItem {
  return {
    path: item.path ?? "",
    label: item.label ?? path.basename(item.path ?? ""),
    core_path: item.core_path ?? "DETECT",
    core_name: item.core_name ?? "DETECT",
    crc32: item.crc32 ?? "DETECT",
    db_name: item.db_name ?? ""
  };
}

function makeEntryId(playlistName: string, romPath: string): string {
  return Buffer.from(`${playlistName}:${romPath}`).toString("base64url");
}

function resolveRomPath(rawRomPath: string, romsRoot: string | null, retroarchRoot: string): string {
  if (path.isAbsolute(rawRomPath) || !romsRoot) {
    return path.isAbsolute(rawRomPath)
      ? path.resolve(rawRomPath)
      : path.resolve(romsRoot ?? retroarchRoot, rawRomPath);
  }

  return path.resolve(romsRoot, rawRomPath);
}

function makeRomUrl(entryId: string): string {
  return `/api/roms/${entryId}`;
}

async function resolveThumbnailUrl(
  thumbnailsRoot: string,
  playlistName: string,
  item: RetroArchPlaylistItem,
  kind: ThumbnailKind
): Promise<string | undefined> {
  const candidates = [
    sanitizeThumbnailBaseName(path.parse(item.path).name),
    sanitizeThumbnailBaseName(item.label),
    sanitizeThumbnailBaseName(shortenLabel(item.label))
  ].filter(Boolean);

  for (const baseName of candidates) {
    for (const extension of IMAGE_EXTENSIONS) {
      const fullPath = path.join(thumbnailsRoot, playlistName, kind, `${baseName}${extension}`);

      if (await exists(fullPath)) {
        return `/api/thumbnails/${encodeURIComponent(playlistName)}/${kind}/${encodeURIComponent(`${baseName}${extension}`)}`;
      }
    }
  }

  return undefined;
}

async function mapPlaylist(
  playlistFile: string,
  thumbnailsRoot: string,
  romsRoot: string | null,
  retroarchRoot: string
): Promise<LibraryPlaylist> {
  const fileName = path.basename(playlistFile);
  const playlistName = fileName.replace(/\.lpl$/i, "");
  const playlist = await readPlaylist(playlistFile);
  const entries: LibraryEntry[] = [];

  for (const item of playlist.items) {
    const thumbnailUrls: LibraryEntry["thumbnailUrls"] = {};

    for (const kind of THUMBNAIL_KINDS) {
      const thumbnailUrl = await resolveThumbnailUrl(thumbnailsRoot, playlistName, item, kind);

      if (thumbnailUrl) {
        thumbnailUrls[kind] = thumbnailUrl;
      }
    }

    const resolvedRomPath = resolveRomPath(item.path, romsRoot, retroarchRoot);

    entries.push({
      id: makeEntryId(playlistName, item.path),
      label: item.label,
      romPath: resolvedRomPath,
      relativeRomPath: item.path,
      playlistName,
      dbName: item.db_name || fileName,
      corePath: item.core_path,
      coreName: item.core_name,
      crc32: item.crc32,
      thumbnailUrls,
    });
  }

  entries.sort((left, right) => left.label.localeCompare(right.label));

  return {
    name: playlistName,
    fileName,
    filePath: playlistFile,
    version: playlist.version,
    entries
  };
}

async function loadOrCreatePlaylist(playlistsRoot: string, playlistName: string): Promise<{ filePath: string; fileName: string; playlist: RetroArchPlaylist }> {
  const fileName = getPlaylistFileName(playlistName);
  const filePath = getPlaylistFilePath(playlistsRoot, playlistName);

  if (await exists(filePath)) {
    return { filePath, fileName, playlist: await readPlaylist(filePath) };
  }

  return {
    filePath,
    fileName,
    playlist: {
      version: PLAYLIST_VERSION,
      items: []
    }
  };
}

export async function buildLibrarySummary(options: {
  retroarchRoot: string;
  playlistsRoot: string;
  thumbnailsRoot: string;
  romsRoot: string | null;
}): Promise<LibrarySummary> {
  const playlistFiles = await listPlaylistFiles(options.playlistsRoot);
  const playlists = await Promise.all(
    playlistFiles.map((playlistFile) => mapPlaylist(playlistFile, options.thumbnailsRoot, options.romsRoot, options.retroarchRoot))
  );

  const gameCount = playlists.reduce((count, playlist) => count + playlist.entries.length, 0);

  return {
    retroarchRoot: options.retroarchRoot,
    playlistsRoot: options.playlistsRoot,
    thumbnailsRoot: options.thumbnailsRoot,
    romsRoot: options.romsRoot,
    playlistCount: playlists.length,
    gameCount,
    playlists
  };
}

export function findEntryById(summary: LibrarySummary, entryId: string): LibraryEntry | undefined {
  for (const playlist of summary.playlists) {
    const match = playlist.entries.find((entry) => entry.id === entryId);

    if (match) {
      return match;
    }
  }

  return undefined;
}

export function makeLaunchCommand(entry: LibraryEntry, retroarchExecutable = "retroarch"): string {
  if (entry.corePath && entry.corePath !== "DETECT") {
    return `${retroarchExecutable} -L "${entry.corePath}" "${entry.romPath}"`;
  }

  return `${retroarchExecutable} "${entry.romPath}"`;
}

export async function ensureExampleLibrary(retroarchRoot: string): Promise<void> {
  const samplePlaylistPath = path.join(retroarchRoot, "playlists", "Nintendo - Game Boy.lpl");
  const sampleRomPath = path.join(retroarchRoot, "roms", "Nintendo - Game Boy", "Tetris.gb");

  await fs.mkdir(path.dirname(sampleRomPath), { recursive: true });

  if (!(await exists(sampleRomPath))) {
    await fs.writeFile(sampleRomPath, "Placeholder ROM file for local server smoke tests.\n", "utf8");
  }

  if (await exists(samplePlaylistPath)) {
    return;
  }

  await fs.mkdir(path.dirname(samplePlaylistPath), { recursive: true });
  await fs.mkdir(path.join(retroarchRoot, "thumbnails", "Nintendo - Game Boy", "Named_Boxarts"), { recursive: true });

  const samplePlaylist: RetroArchPlaylist = {
    version: PLAYLIST_VERSION,
    items: [
      {
        path: "roms/Nintendo - Game Boy/Tetris.gb",
        label: "Tetris (World)",
        core_path: "DETECT",
        core_name: "DETECT",
        crc32: "DETECT",
        db_name: "Nintendo - Game Boy.lpl"
      }
    ]
  };

  await fs.writeFile(samplePlaylistPath, `${JSON.stringify(samplePlaylist, null, 2)}\n`, "utf8");
}

export async function createPlaylist(playlistsRoot: string, playlistName: string): Promise<{ fileName: string; filePath: string }> {
  const { fileName, filePath, playlist } = await loadOrCreatePlaylist(playlistsRoot, playlistName);

  if (!(await exists(filePath))) {
    await writePlaylist(filePath, playlist);
  }

  return { fileName, filePath };
}

export async function upsertPlaylistEntry(
  playlistsRoot: string,
  playlistName: string,
  entry: RetroArchEntryInput,
  previousPath?: string
): Promise<RetroArchPlaylistItem> {
  const { fileName, filePath, playlist } = await loadOrCreatePlaylist(playlistsRoot, playlistName);
  const normalizedEntry = normalizeEntryInput(entry, fileName);
  const lookupPath = previousPath ?? normalizedEntry.path;
  const existingIndex = playlist.items.findIndex((item) => item.path === lookupPath);

  if (existingIndex >= 0) {
    playlist.items[existingIndex] = normalizedEntry;
  } else {
    playlist.items.push(normalizedEntry);
  }

  await writePlaylist(filePath, {
    version: playlist.version || PLAYLIST_VERSION,
    items: playlist.items
  });

  return normalizedEntry;
}

export async function removePlaylistEntry(playlistsRoot: string, playlistName: string, romPath: string): Promise<boolean> {
  const filePath = getPlaylistFilePath(playlistsRoot, playlistName);

  if (!(await exists(filePath))) {
    return false;
  }

  const playlist = await readPlaylist(filePath);
  const nextItems = playlist.items.filter((item) => item.path !== romPath);

  if (nextItems.length === playlist.items.length) {
    return false;
  }

  await writePlaylist(filePath, {
    version: playlist.version || PLAYLIST_VERSION,
    items: nextItems
  });

  return true;
}

export async function importPlaylistFile(
  playlistsRoot: string,
  originalName: string,
  contents: Buffer
): Promise<{ fileName: string; filePath: string; playlistName: string }> {
  const parsed = JSON.parse(contents.toString("utf8")) as Partial<RetroArchPlaylist>;
  const playlistName = normalizePlaylistName(originalName);
  const filePath = getPlaylistFilePath(playlistsRoot, playlistName);
  const playlist: RetroArchPlaylist = {
    version: parsed.version ?? PLAYLIST_VERSION,
    items: Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : []
  };

  await writePlaylist(filePath, playlist);

  return {
    fileName: path.basename(filePath),
    filePath,
    playlistName
  };
}

export async function importRomToPlaylist(options: {
  retroarchRoot: string;
  romsRoot: string | null;
  playlistsRoot: string;
  playlistName: string;
  uploadedFileName: string;
  fileBuffer: Buffer;
  label?: string;
  relativeDirectory?: string;
  corePath?: string;
  coreName?: string;
  crc32?: string;
}): Promise<{ romPath: string; relativeRomPath: string; playlistItem: RetroArchPlaylistItem }> {
  const playlistName = normalizePlaylistName(options.playlistName);
  const safeFileName = normalizeUploadedFileName(options.uploadedFileName);
  const pathModule = getPlaylistPathModule();
  const defaultDirectory = pathModule.join("roms", playlistName);
  const relativeDirectory = options.relativeDirectory
    ? normalizeRelativePlaylistPath(options.relativeDirectory)
    : defaultDirectory;
  const relativeRomPath = pathModule.join(relativeDirectory, safeFileName);
  const storageRoot = options.romsRoot ?? options.retroarchRoot;
  const absoluteRomPath = ensureSafeWithinRoot(path.resolve(storageRoot, relativeRomPath), storageRoot);

  await fs.mkdir(path.dirname(absoluteRomPath), { recursive: true });
  await fs.writeFile(absoluteRomPath, options.fileBuffer);

  const playlistItem = await upsertPlaylistEntry(options.playlistsRoot, playlistName, {
    path: relativeRomPath,
    label: options.label?.trim() || path.parse(safeFileName).name,
    core_path: options.corePath,
    core_name: options.coreName,
    crc32: options.crc32
  });

  return {
    romPath: absoluteRomPath,
    relativeRomPath,
    playlistItem
  };
}

export { makeRomUrl };
export { THUMBNAIL_KINDS, getPlaylistFileName, normalizePlaylistName, readPlaylist, sanitizeThumbnailBaseName };